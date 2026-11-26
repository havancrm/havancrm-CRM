// Runs ONLY when REAL_DIR points at a folder with the private files (never committed):
//   real.json (export of the CRM sheet, read-only copy), bills.ttx, customers.ttx, slip-sample.html
// Nothing here talks to Google: all writes go to an in-memory copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as D from '../../public/js/shared/domain.js';
import * as T from '../../public/js/ttx.js';
import { rowsToObjects, SCHEMA, TABS } from '../../public/js/shared/schema.js';
import { MemoryStore } from '../../src/server/store.js';
import { execBatch } from '../../src/server/exec.js';
import { slipHtml } from '../../public/js/slip.js';

const DIR = process.env.REAL_DIR;
const skip = !DIR || !fs.existsSync(path.join(DIR, 'real.json'));
const NOW = Date.parse('2026-11-26T05:00:00Z');
const load = () => { const j = JSON.parse(fs.readFileSync(path.join(DIR, 'real.json'), 'utf8')); const raw = {}; for (const [t, v] of Object.entries(j)) raw[t] = rowsToObjects(v); return raw; };
const buf = f => { const b = fs.readFileSync(path.join(DIR, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const ctx = { now: NOW, user: 'real-test@local', deviceId: 'rt', isAdmin: true };

test('REAL sheet copy: row counts equal the delivery numbers; no duplicate keys; sales = SUM(bill_items.amount)', { skip }, () => {
  const raw = load(); const m = D.buildModel(raw, NOW);
  assert.deepEqual([m.customers.length, m.bills.length, raw.bill_items.length, m.products.length], [1383, 9922, 30811, 366]);
  const q = D.qualityReport(m);
  assert.equal(q.issues.filter(i => i.code === 'COUNT_DIFF').length, 0);
  for (const c of ['DUP_CUSTOMER_ID', 'DUP_BILL_NO', 'DUP_BILL_LINE', 'DUP_PRODUCT_CODE', 'ITEM_NO_BILL']) assert.equal(q.issues.filter(i => i.code === c).length, 0, c);
  let sum = 0; for (const i of raw.bill_items) sum += parseFloat(i.amount || 0);
  assert.ok(Math.abs(D.salesBetween(m, '', '').total - sum) < 0.01);
  const k = D.customerCounts(m);
  console.log('      REAL KPI', JSON.stringify(k), 'sales', D.money(sum), 'unregistered lines', D.unregisteredItems(m).length, 'issues', q.issues.length);
  assert.equal(k.all, 1383); assert.equal(k.closed, raw.customers.filter(c => ['0', 'false'].includes(String(c.activeFlag).toLowerCase())).length);
});

test('REAL bills TTX: parses fully, footer total matches, converts to what the CRM already holds', { skip }, () => {
  const raw = load(); const m = D.buildModel(raw, NOW);
  const p = T.parseBills(T.decodeBuffer(buf('bills.ttx')));
  assert.equal(p.bills.length, 9904);
  const rawSum = p.bills.reduce((s, b) => s + b.items.reduce((x, i) => x + i.amount, 0), 0);
  assert.ok(Math.abs(p.footer.grand - rawSum) < 0.01, `footer ${p.footer.grand} vs ${rawSum}`);
  assert.ok(p.bad.length <= 4, 'unreadable rows: ' + JSON.stringify(p.bad));
  const a = T.analyzeBills(m, p, { fileName: 'บิล 010169 - 261169.ttx' });
  console.log('      REAL bills: new', a.newBills.length, 'same', a.same.length, 'diff', a.diff.length, 'flags', a.flags.length, 'bad rows', p.bad.length);
  assert.ok(a.same.length >= 9890, 'existing bills should match the sheet');
  assert.ok(a.newBills.length <= 5);
  // header fields on bills that already exist: >=99% agree with what is stored
  let agree = 0, total = 0;
  for (const b of p.bills) { const ex = m.billByNo.get(b.no); if (!ex) continue; const c = T.toCrmBill(b, {}).bill; total++; if (['paymentTerm', 'openedBy', 'vatMode', 'date'].every(k => String(ex[k]).slice(0, 10) === String(c[k]).slice(0, 10))) agree++; }
  assert.ok(agree / total > 0.99, `header agreement ${agree}/${total}`);
});

test('REAL customers TTX: all customers already in the sheet, nothing is modified', { skip }, () => {
  const m = D.buildModel(load(), NOW); const p = T.parseCustomers(T.decodeBuffer(buf('customers.ttx')));
  assert.equal(p.bad.length, 0); const a = T.analyzeCustomers(m, p);
  assert.equal(a.fresh.length, 0); assert.ok(a.existing.length >= 1380);
});

test('REAL import round-trip (in memory): drop the newest bills from a copy, import the real TTX, get the same sales back; second run adds nothing', { skip }, async () => {
  const raw = load();
  const cut = '2026-11-01';
  const dropped = new Set(raw.bills.filter(b => b.date >= cut).map(b => b.no));
  const droppedTotal = raw.bill_items.filter(i => dropped.has(i.billNo)).reduce((s, i) => s + parseFloat(i.amount || 0), 0);
  const seed = { ...raw, bills: raw.bills.filter(b => !dropped.has(b.no)), bill_items: raw.bill_items.filter(i => !dropped.has(i.billNo)), IMPORT_BATCHES: [], IMPORT_REVIEW: [] };
  const store = new MemoryStore(seed); const m = D.buildModel(seed, NOW);
  const parsed = T.parseBills(T.decodeBuffer(buf('bills.ttx'))); const a = T.analyzeBills(m, parsed, { fileName: 'real.ttx' });
  assert.ok(a.newBills.length >= dropped.size - 25, `new ${a.newBills.length} vs dropped ${dropped.size}`);
  const batch = { batchId: 'TTX-BILL-RT-1', fileName: 'real.ttx', fileHash: 'sha256:rt', kind: 'bills' };
  const chunks = []; let cur = { bills: [], items: [] }, n = 0;
  for (const c of a.newBills) { if (n + c.items.length + 1 > 2800) { chunks.push(cur); cur = { bills: [], items: [] }; n = 0; } cur.bills.push(c.bill); cur.items.push(...c.items); n += c.items.length + 1; }
  chunks.push(cur); for (let i = 0; i < a.flags.length; i += 800) chunks.push({ reviews: a.flags.slice(i, i + 800) });
  for (let i = 0; i < chunks.length; i++) { const [r] = await execBatch(store, [{ type: 'import.commit', opId: `rt-op-${i}-aaaa`, payload: { first: i === 0, batch, ...chunks[i] } }], ctx); assert.equal(r.status, 'ok', JSON.stringify(r)); }
  const after = {}; for (const t of TABS) after[t] = rowsToObjects(store.tabs[t]);
  const m2 = D.buildModel(after, NOW);
  const importedTotal = [...dropped].filter(no => m2.billByNo.has(no)).reduce((s, no) => s + D.billTotal(m2, no), 0);
  console.log('      REAL round-trip: dropped', dropped.size, 'bills', D.money(droppedTotal), '-> re-imported', D.money(importedTotal), 'bills now', after.bills.length);
  assert.ok(Math.abs(importedTotal - droppedTotal) / droppedTotal < 0.02, 'sales after re-import ≈ original');
  assert.equal(new Set(after.bills.map(b => b.no)).size, after.bills.length, 'duplicate bill numbers');
  assert.equal(new Set(after.bill_items.map(i => `${i.billNo}|${i.line}`)).size, after.bill_items.length, 'duplicate bill lines');
  // VAT is never added: every imported bill total == sum of its non-VAT items
  for (const no of dropped) { const b = parsed.bills.find(x => x.no === no); if (!b || !m2.billByNo.has(no)) continue; assert.ok(Math.abs(D.billTotal(m2, no) - b.items.filter(i => !T.isVatLine(i)).reduce((s, i) => s + i.amount, 0)) < 0.01, no); }
  // second run: same file refused, chunks re-sent add nothing
  const [again] = await execBatch(store, [{ type: 'import.commit', opId: 'rt-op-x-bbbb', payload: { first: true, batch: { ...batch, batchId: 'TTX-BILL-RT-2' }, ...chunks[0] } }], ctx);
  assert.equal(again.code, 'duplicate_file');
  const n0 = store.tabs.bills.length; await execBatch(store, [{ type: 'import.commit', opId: 'rt-op-y-cccc', payload: { batch, ...chunks[0] } }], ctx); assert.equal(store.tabs.bills.length, n0);
});

test('REAL delivery slip: order 01121169 reproduces the supplied sample form field by field', { skip: skip || !fs.existsSync(path.join(DIR || '', 'slip-sample.html')) }, () => {
  const raw = load(); const m = D.buildModel(raw, NOW);
  const o = m.orders.find(x => x.no === '01121169'); const lines = m.orderItems.get(o.no).map(i => ({ code: i.code, name: i.name, qty: i.qty, price: i.price, unit: i.unit }));
  const c = m.custById.get(o.customerId);
  const units = JSON.parse(fs.readFileSync(new URL('../../public/data/units.json', import.meta.url), 'utf8'));
  const mine = slipHtml(o, lines, c, { showCode: true, salesperson: 'อาร์ต', phones: D.custPhones(m, c.id), units });
  const sample = fs.readFileSync(path.join(DIR, 'slip-sample.html'), 'utf8');
  const texts = h => [...h.matchAll(/<span class="f"[^>]*>([^<]*)<\/span>/g)].map(x => x[1].replace(/&amp;/g, '&'));
  const want = texts(sample), got = texts(mine);
  for (const t of ['ส. เมญ่า บิวตี้ ( ถ.กาญจนาภิเษก )', '61206', 'แชมพู ฮันนี่เลมอน สีขาวใส', 'ครีมนวด ฮันนี่เลมอน สีขาว', '6,250.00', '4,350.00', '10,600.00', '(หนึ่งหมื่นหกร้อยบาทถ้วน)', 'อาร์ต', '125.00', '145.00']) { assert.ok(want.includes(t), 'sample lacks ' + t); assert.ok(got.includes(t), 'mine lacks ' + t); }
  assert.ok(got.includes('50 แกลลอน') && got.includes('30 แกลลอน'));
  // same geometry: every position style used by the sample is also used by the renderer (except the fields that differ by design)
  const styles = h => new Set([...h.matchAll(/class="f"[^>]*style="([^"]*)"/g)].map(x => x[1].replace(/;?font-size:[^;]*/, '').replace(/;$/, '')));
  const sS = styles(sample), mS = styles(mine); const missing = [...sS].filter(s => !mS.has(s));
  assert.deepEqual(missing.filter(s => !/top:(12\.225|16\.209|19\.093|21\.497|23\.901|16\.484|19\.368|22\.115)/.test(s)), [], 'positions missing');
});
