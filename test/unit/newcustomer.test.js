import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { _resetMemory } from '../../src/server/index.js';
import { resetAccessCache } from '../../src/server/auth.js';
import { rowsToObjects } from '../../public/js/shared/schema.js';
import * as D from '../../public/js/shared/domain.js';
import { slipHtml } from '../../public/js/slip.js';

const env = { DATA_MODE: 'memory', AUTH_MODE: 'dev' };
let n = 0; const oid = () => `nc-op-${Date.now()}-${++n}`;
async function call(path, body, user = 'dev@local') {
  const r = await worker.fetch(new Request(`https://x.test${path}`, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { 'x-dev-user': user } }), env);
  return r.json();
}
const ops = (...o) => call('/api/ops', { ops: o }).then(r => r.results);
async function raw() { const r = await call('/api/bootstrap'); const o = {}; for (const v of r.valueRanges) o[v.range.split('!')[0]] = rowsToObjects(v.values); return o; }
const fresh = () => { _resetMemory(); resetAccessCache(); };

test('customer.create: temp code N-…, row + phone + activity "เพิ่มลูกค้า" + changes, retried op does not duplicate', async () => {
  fresh();
  const id = oid(); const op = { type: 'customer.create', opId: id, payload: { name: 'ร้านใหม่ทดสอบ ลาดพร้าว', type: 'ร้านเสริมสวย', phones: ['081-234-5678'], address: 'ซอย 9', labels: ['ลาดพร้าว'], lat: 13.8, lng: 100.6, paymentTerm: 'เงินสด' } };
  const [a] = await ops(op), [b] = await ops(op);
  assert.equal(a.status, 'ok'); assert.ok(D.isTempId(a.customerId)); assert.equal(a.customerId, D.tempCustomerId(id, Date.now()));
  assert.equal(b.status, 'duplicate');
  const r = await raw();
  assert.equal(r.customers.filter(c => c.id === a.customerId).length, 1);
  const c = r.customers.find(c => c.id === a.customerId);
  assert.equal(c.name, 'ร้านใหม่ทดสอบ ลาดพร้าว'); assert.equal(c.gpsLat, '13.8'); assert.ok(c.mapLink.includes('13.8,100.6'));
  assert.equal(r.customer_phones.filter(p => p.customerId === a.customerId).length, 1);
  assert.ok(r.activities.some(x => x.type === 'เพิ่มลูกค้า' && x.customerId === a.customerId));
  const ch = await call('/api/tab/changes'); assert.ok(rowsToObjects(ch.valueRanges[0].values).some(x => x.id === a.customerId && x.action === 'เพิ่มลูกค้า'));
});

test('customer.create refuses duplicate name or phone unless the salesperson confirms (force)', async () => {
  fresh();
  const r0 = await raw(); const ex = r0.customers[3]; const ph = r0.customer_phones.find(p => p.customerId === ex.id).phone;
  const [d1] = await ops({ type: 'customer.create', opId: oid(), payload: { name: ex.name } });
  assert.equal(d1.code, 'duplicate_customer'); assert.ok(d1.message.includes(ex.id));
  const [d2] = await ops({ type: 'customer.create', opId: oid(), payload: { name: 'ชื่ออื่นโดยสิ้นเชิง', phones: [ph] } });
  assert.equal(d2.code, 'duplicate_customer');
  const [d3] = await ops({ type: 'customer.create', opId: oid(), payload: { name: ex.name.toUpperCase().replace(/\s/g, '  '), } });
  assert.equal(d3.code, 'duplicate_customer');               // normalised comparison
  const [ok] = await ops({ type: 'customer.create', opId: oid(), payload: { name: ex.name, force: true } });
  assert.equal(ok.status, 'ok');
  assert.equal((await raw()).customers.length, r0.customers.length + 1);
});

test('two devices creating shops get different temp codes; the code is derived from the op id (retry-safe)', () => {
  assert.notEqual(D.tempCustomerId('aaaaaaaa-1'), D.tempCustomerId('aaaaaaaa-2'));
  assert.equal(D.tempCustomerId('same-op-id', 1700000000000), D.tempCustomerId('same-op-id', 1700000000000));
});

test('customer.assignCode rewrites the id in every tab, refuses an existing code, admin only', async () => {
  fresh();
  const [c] = await ops({ type: 'customer.create', opId: oid(), payload: { name: 'ร้านรอรหัส', phones: ['089-999-8888'], labels: ['VIP'] } });
  const tid = c.customerId;
  await ops({ type: 'visit.log', opId: oid(), payload: { customerId: tid, kind: 'visit', note: 'เข้าพบร้านใหม่', lat: 13.7, lng: 100.5 } },
    { type: 'order.save', opId: oid(), payload: { order: { no: '01261169', customerId: tid, status: 'รอส่ง' }, lines: [{ code: '4012', name: 'a', qty: 1, price: 10 }] } });
  const forbidden = await call('/api/ops', { ops: [{ type: 'customer.assignCode', opId: oid(), payload: { customerId: tid, newId: '98765' } }] }, 'sales@local');
  assert.equal(forbidden.results[0].code, 'forbidden');
  const taken = (await raw()).customers[0].id;
  assert.equal((await ops({ type: 'customer.assignCode', opId: oid(), payload: { customerId: tid, newId: taken } }))[0].code, 'already_exists');
  assert.equal((await ops({ type: 'customer.assignCode', opId: oid(), payload: { customerId: '57900', newId: '98765' } }))[0].status, 'error');   // not a temp shop
  const [r] = await ops({ type: 'customer.assignCode', opId: oid(), payload: { customerId: tid, newId: '98765' } });
  assert.equal(r.status, 'ok');
  const x = await raw();
  for (const t of ['customers', 'customer_phones', 'customer_labels', 'visits', 'orders', 'activities', 'gps']) assert.ok(x[t].some(row => (row.id || row.customerId) === '98765'), t);
  for (const t of ['customers', 'customer_phones', 'customer_labels', 'visits', 'orders', 'activities', 'gps']) assert.ok(!x[t].some(row => (row.id || row.customerId) === tid), t + ' still has temp id');
});

test('order number follows aCRM: NN + ddmmyy(BE); a number taken by another shop is renumbered on the server', async () => {
  fresh();
  const now = Date.parse('2026-11-26T05:00:00Z');
  assert.equal(D.newOrderNo([], now), '01261169'); assert.equal(D.newOrderNo([{ no: '01261169' }, { no: '02261169' }, { no: '01251169' }], now), '03261169');
  await ops({ type: 'order.save', opId: oid(), payload: { order: { no: '01261169', customerId: '57900', status: 'รอส่ง' }, lines: [{ name: 'a', qty: 1, price: 10 }] } });
  const [r] = await ops({ type: 'order.save', opId: oid(), payload: { order: { no: '01261169', customerId: '57901', status: 'รอส่ง' }, lines: [{ name: 'b', qty: 2, price: 5 }] } });
  assert.equal(r.status, 'ok'); assert.equal(r.renamedFrom, '01261169'); assert.equal(r.no, '02261169');
  const x = await raw();
  assert.equal(x.orders.find(o => o.no === '01261169').customerId, '57900'); assert.equal(x.orders.find(o => o.no === '02261169').customerId, '57901');
  assert.equal(x.order_items.filter(i => i.orderNo === '01261169').length, 1); assert.equal(x.order_items.filter(i => i.orderNo === '02261169').length, 1);
});

test('import.commit: customers + orderLinks (เชื่อมบิล) + review rows in aCRM wording', async () => {
  fresh();
  await ops({ type: 'order.save', opId: oid(), payload: { order: { no: '01261169', customerId: '57900', date: '2026-11-26', status: 'รอส่ง' }, lines: [{ code: '4012', name: 'a', qty: 5, price: 115 }] } });
  const batch = { batchId: 'TTX-BILL-20261126-101', fileName: 'x.ttx', fileHash: 'sha256:abcd', kind: 'bills' };
  const [r] = await ops({ type: 'import.commit', opId: oid(), payload: { first: true, batch, bills: [{ no: '909090', date: '2026-11-27', customerId: '57900', paymentTerm: 'เงินสด', openedBy: 'ฝน', salesperson: 'อาร์ต', vatMode: 'NONE' }], items: [{ billNo: '909090', line: '1', code: '4012', name: 'a', qty: '5', price: '115', amount: '575' }], orderLinks: [{ no: '01261169', billNo: '909090' }], reviews: [{ entityType: 'product', sourceKey: '9', issueCode: 'PRODUCT_NOT_IN_REGISTER' }] } });
  assert.equal(r.status, 'ok');
  const x = await raw(); const o = x.orders.find(o => o.no === '01261169');
  assert.equal(o.status, 'ส่งแล้ว'); assert.equal(o.billNo, '909090'); assert.equal(o.note, 'เชื่อมบิล 909090');
  const bt = rowsToObjects((await call('/api/tab/IMPORT_BATCHES')).valueRanges[0].values)[0];
  assert.equal(bt.format, 'TTX cp874'); assert.equal(bt.status, 'ok'); assert.equal(bt.source, 'TTX ในแอป');
  const rv = rowsToObjects((await call('/api/tab/IMPORT_REVIEW')).valueRanges[0].values)[0]; assert.equal(rv.status, 'pending'); assert.equal(rv.severity, 'low');
  const [c] = await ops({ type: 'import.commit', opId: oid(), payload: { batch: { ...batch, kind: 'customers' }, customers: [{ customer: { id: '88001', name: 'ร้านจาก TTX', address: 'x', contactName: '', paymentTerm: 'เงินสด', billClerk: 'ฝน', activeFlag: '' }, phones: ['081-111-2222'] }] } });
  assert.equal(c.status, 'ok');
  const y = await raw(); assert.ok(y.customers.some(z => z.id === '88001')); assert.ok(y.activities.some(a => a.type === 'เพิ่มลูกค้า' && a.customerId === '88001' && a.note.includes('นำเข้าจาก TTX')));
  assert.equal(y.customer_phones.filter(p => p.customerId === '88001').length, 1);
});

test('new customers: "first purchase" and "newly registered" are different groups', () => {
  const NOW = Date.parse('2026-11-26T05:00:00Z');
  const raw = { customers: [{ id: 'A', name: 'a' }, { id: 'B', name: 'b' }, { id: 'N-691120-ZZZZ', name: 'c' }, { id: 'D', name: 'd' }],
    bills: [{ no: '1', date: '2026-11-10', customerId: 'A' }, { no: '2', date: '2026-11-12', customerId: 'B' }, { no: '3', date: '2026-01-01', customerId: 'B' }],
    bill_items: [], activities: [{ activityId: 'x', customerId: 'N-691120-ZZZZ', type: 'เพิ่มลูกค้า', at: '2026-11-20T10:00:00+07:00' }, { activityId: 'y', customerId: 'B', type: 'เพิ่มลูกค้า', at: '2020-01-01T00:00:00Z' }], systemSettings: [] };
  const m = D.buildModel(raw, NOW);
  assert.deepEqual(m.customers.filter(c => D.isFirstPurchaseNew(m, c)).map(c => c.id), ['A']);          // B's first purchase was in January
  assert.deepEqual(m.customers.filter(c => D.isRecentlyRegistered(m, c)).map(c => c.id), ['N-691120-ZZZZ']);   // registered, never bought
  assert.deepEqual(D.customersBy(m, 'temp').map(c => c.id), ['N-691120-ZZZZ']);
});

test('slip: customer code and product codes shown, baht text, pagination at 15 rows', () => {
  const o = { no: '01261169', date: '2026-11-26', customerId: '57900', paymentTerm: 'เงินสด' };
  const lines = Array.from({ length: 17 }, (_, i) => ({ code: `C${i}`, name: `สินค้า ${i + 1}`, qty: 2, price: 100, unit: 'ชิ้น' }));
  const h = slipHtml(o, lines, { name: 'ร้านทดสอบ', address: 'ถนน ทดสอบ ซอย 1 กรุงเทพมหานคร', billClerk: 'ฝน' }, { salesperson: 'อาร์ต', phones: ['081-111-2222'] });
  assert.equal((h.match(/class="slip"/g) || []).length, 2);
  assert.ok(h.includes('57900') && h.includes('26/11/2569') && h.includes('เงินสด/ฝน') && h.includes('สินค้า 17'));
  assert.ok(/>C0</.test(h) && />C16</.test(h), 'product codes print by default (column kept)');
  assert.ok(!/>C\d+</.test(slipHtml(o, lines.slice(0, 2), null, { showCode: false })), 'showCode:false leaves the column blank');
  assert.ok(h.includes('3,400.00') && h.includes('สามพันสี่ร้อยบาทถ้วน'));
    assert.ok(slipHtml({ ...o, customerId: 'N-691126-AAAA' }, lines.slice(0, 1), null, { tempCode: true }).includes('รอรหัสบัญชี'));
  assert.equal(D.bahtText(10600), 'หนึ่งหมื่นหกร้อยบาทถ้วน');
});
