import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { _resetMemory } from '../../src/server/index.js';
import { resetAccessCache } from '../../src/server/auth.js';
import { SCHEMA, TABS, CORE_TABS, rowsToObjects } from '../../public/js/shared/schema.js';
import * as D from '../../public/js/shared/domain.js';

const env = { DATA_MODE: 'memory', AUTH_MODE: 'dev' };
let n = 0;
const opId = () => `test-op-${Date.now()}-${++n}`;
async function call(path, { method = 'GET', body, user = 'dev@local', headers = {} } = {}) {
  const req = new Request(`https://x.test${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'x-dev-user': user, ...headers } });
  const r = await worker.fetch(req, env);
  return { status: r.status, body: await r.json() };
}
async function raw() {
  const r = await call('/api/bootstrap');
  const out = {};
  for (const vr of r.body.valueRanges) out[vr.range.split('!')[0]] = rowsToObjects(vr.values);
  return out;
}
const fresh = () => { _resetMemory(); resetAccessCache(); };
const ops = (...o) => call('/api/ops', { method: 'POST', body: { deviceId: 'dev1', ops: o } });

test('health is public; everything else needs auth + ACCESS', async () => {
  fresh();
  const h = await call('/api/health', { user: 'nobody@x' });
  assert.equal(h.status, 200);
  assert.equal((await call('/api/me', { user: 'nobody@x' })).status, 403);
  assert.equal((await call('/api/me', { user: 'off@local' })).status, 403);        // active = FALSE
  assert.equal((await call('/api/bootstrap', { user: 'off@local' })).status, 403);
  const me = await call('/api/me', { user: 'sales@local' });
  assert.equal(me.status, 200); assert.equal(me.body.isAdmin, false);
});

test('dev auth is refused against the real sheet (production can never run open)', async () => {
  fresh();
  const r = await worker.fetch(new Request('https://x.test/api/me'), { DATA_MODE: 'sheets', AUTH_MODE: 'dev', SPREADSHEET_ID: 'x' });
  assert.equal(r.status, 500);
  const r2 = await worker.fetch(new Request('https://x.test/api/me'), { DATA_MODE: 'sheets', AUTH_MODE: 'google', SPREADSHEET_ID: 'x', GOOGLE_CLIENT_ID: 'c' });
  assert.equal(r2.status, 401);
});

test('bootstrap returns every core tab with its real header row', async () => {
  fresh();
  const r = await call('/api/bootstrap');
  assert.equal(r.status, 200);
  const names = r.body.valueRanges.map(v => v.range.split('!')[0]);
  assert.deepEqual(names, CORE_TABS);
  for (const vr of r.body.valueRanges) assert.deepEqual(vr.values[0], SCHEMA[vr.range.split('!')[0]]);
});

test('diagnostics: all 18 tabs / 178 columns verified', async () => {
  fresh();
  const d = await call('/api/diagnostics');
  assert.equal(d.body.tabs, 18); assert.equal(d.body.expectedColumns, 178); assert.equal(d.body.ok, true);
  assert.equal((await call('/api/diagnostics', { user: 'sales@local' })).status, 403);
});

test('visit.log writes visit + activity + gps by header, and a repeat is a duplicate', async () => {
  fresh();
  const id = opId();
  const op = { type: 'visit.log', opId: id, payload: { customerId: '57900', kind: 'visit', note: 'ทดสอบ', lat: '13.75', lng: '100.5', accuracy: '12' } };
  const a = await ops(op), b = await ops(op);
  assert.equal(a.body.results[0].status, 'ok');
  assert.equal(b.body.results[0].status, 'duplicate');
  const r = await raw();
  assert.equal(r.visits.filter(v => v.opId === id).length, 1);
  assert.equal(r.activities.filter(v => v.opId === `${id}:a`).length, 1);
  assert.equal(r.gps.filter(v => v.opId === `${id}:g`).length, 1);
  const v = r.visits.find(v => v.opId === id);
  assert.equal(v.status, 'done'); assert.equal(v.lat, '13.75'); assert.equal(v.customerId, '57900');
  assert.ok(/^\d{4}-\d\d-\d\dT.*\+07:00$/.test(v.at));
});

test('appointment creates planned visit + open task; completing closes both', async () => {
  fresh();
  const id = opId();
  await ops({ type: 'visit.log', opId: id, payload: { customerId: '57901', kind: 'appointment', plannedAt: '2026-12-05', note: 'นัดส่งของ' } });
  let r = await raw();
  const v = r.visits.find(x => x.opId === id);
  assert.equal(v.status, 'planned'); assert.equal(v.plannedAt, '2026-12-05');
  assert.equal(r.tasks.find(t => t.opId === `${id}:t`).status, 'open');
  const c = await ops({ type: 'visit.complete', opId: opId(), payload: { visitId: v.visitId, customerId: '57901', note: 'เสร็จแล้ว' } });
  assert.equal(c.body.results[0].status, 'ok');
  r = await raw();
  assert.equal(r.visits.find(x => x.visitId === v.visitId).status, 'done');
  assert.equal(r.tasks.find(t => t.opId === `${id}:t`).status, 'done');
});

test('customer.geo updates only gps columns + mapLink, logs before/after, keeps other columns', async () => {
  fresh();
  const before = (await raw()).customers.find(c => c.id === '57900');
  const r = await ops({ type: 'customer.geo', opId: opId(), payload: { customerId: '57900', lat: 13.7563, lng: 100.5018, accuracy: 8 } });
  assert.equal(r.body.results[0].status, 'ok');
  const rr = await raw();
  const c = rr.customers.find(c => c.id === '57900');
  assert.equal(c.gpsLat, '13.7563'); assert.ok(c.mapLink.includes('13.7563,100.5018'));
  for (const k of Object.keys(before)) if (!['gpsLat', 'gpsLng', 'mapLink'].includes(k)) assert.equal(c[k], before[k], k);
  const log = (await call('/api/tab/changes')).body.valueRanges[0].values;
  assert.ok(log.length >= 2);
  const bad = await ops({ type: 'customer.geo', opId: opId(), payload: { customerId: '57900', lat: 999, lng: 1 } });
  assert.equal(bad.body.results[0].status, 'error');
});

test('customer.update only allows editable columns', async () => {
  fresh();
  const ok = await ops({ type: 'customer.update', opId: opId(), payload: { customerId: '57902', patch: { keepNote: 'ใหม่', birthday: '1990-01-02' } } });
  assert.equal(ok.body.results[0].status, 'ok');
  assert.equal((await raw()).customers.find(c => c.id === '57902').keepNote, 'ใหม่');
  const bad = await ops({ type: 'customer.update', opId: opId(), payload: { customerId: '57902', patch: { id: '1' } } });
  assert.equal(bad.body.results[0].status, 'error');
  const missing = await ops({ type: 'customer.update', opId: opId(), payload: { customerId: 'nope', patch: { keepNote: 'x' } } });
  assert.equal(missing.body.results[0].code, 'not_found');
});

test('order.save: draft -> edit lines -> confirm; items replaced not duplicated; amounts by qty*price', async () => {
  fresh();
  const no = 'OD-T1';
  const base = { no, customerId: '57900', date: '2026-11-26', paymentTerm: 'เงินสด' };
  await ops({ type: 'order.save', opId: opId(), payload: { order: { ...base, status: 'draft' }, lines: [{ code: '4012', name: 'แชมพูออยล์', qty: 5, price: 115 }, { code: '5029', name: 'ครีมนวดอโวคาโด้', qty: 2, price: 140 }] } });
  let r = await raw();
  assert.equal(r.order_items.filter(i => i.orderNo === no).length, 2);
  assert.equal(r.orders.find(o => o.no === no).status, 'draft');
  const id2 = opId();
  await ops({ type: 'order.save', opId: id2, payload: { order: { ...base, status: 'confirmed', note: 'ส่งเช้า' }, lines: [{ code: '4012', name: 'แชมพูออยล์', qty: 6, price: 110 }] } });
  r = await raw();
  const items = r.order_items.filter(i => i.orderNo === no);
  assert.equal(items.length, 1); assert.equal(items[0].amount, '660'); assert.equal(items[0].code, '4012');
  assert.equal(r.orders.filter(o => o.no === no).length, 1);
  assert.equal(r.orders.find(o => o.no === no).status, 'confirmed');
  assert.equal(r.orders.find(o => o.no === no).createdBy, 'dev@local');
  // double tap on the same op = no change
  const dup = await ops({ type: 'order.save', opId: id2, payload: { order: { ...base, status: 'confirmed', note: 'ส่งเช้า' }, lines: [{ code: '4012', name: 'แชมพูออยล์', qty: 6, price: 110 }] } });
  assert.equal(dup.body.results[0].status, 'duplicate');
  assert.equal((await raw()).order_items.filter(i => i.orderNo === no).length, 1);
  const empty = await ops({ type: 'order.save', opId: opId(), payload: { order: { ...base, no: 'OD-T2', status: 'confirmed' }, lines: [] } });
  assert.equal(empty.body.results[0].status, 'error');
  const neg = await ops({ type: 'order.save', opId: opId(), payload: { order: { ...base, no: 'OD-T3' }, lines: [{ name: 'x', qty: -1, price: 5 }] } });
  assert.equal(neg.body.results[0].status, 'error');
});

test('settings / labels / import need admin role', async () => {
  fresh();
  const s = await call('/api/ops', { method: 'POST', user: 'sales@local', body: { ops: [{ type: 'settings.save', opId: opId(), payload: { data: { lateDays: 120 } } }] } });
  assert.equal(s.body.results[0].code, 'forbidden');
  const a = await ops({ type: 'settings.save', opId: opId(), payload: { data: { lateDays: 120, visitDef: 21 } } });
  assert.equal(a.body.results[0].status, 'ok');
  const m = D.buildModel(await raw(), Date.now());
  assert.equal(m.settings.lateDays, 120); assert.equal(m.settings.visitDef, 21);
  assert.equal(m.settings.vatRate, 7);            // untouched keys survive
  const bad = await ops({ type: 'settings.save', opId: opId(), payload: { data: { hacker: 1 } } });
  assert.equal(bad.body.results[0].status, 'error');
});

test('label.rename merges duplicates; label.delete removes; customers keep other labels', async () => {
  fresh();
  let r = await raw();
  const lab = r.customer_labels[0].label;
  const target = 'ป้ายใหม่';
  const total = r.customer_labels.filter(l => l.label === lab).length;
  await ops({ type: 'label.rename', opId: opId(), payload: { from: lab, to: target } });
  r = await raw();
  assert.equal(r.customer_labels.filter(l => l.label === lab).length, 0);
  assert.equal(r.customer_labels.filter(l => l.label === target).length, total);
  await ops({ type: 'label.delete', opId: opId(), payload: { label: target } });
  assert.equal((await raw()).customer_labels.filter(l => l.label === target).length, 0);
});

test('import.commit is idempotent: same file hash blocked, bills/items never duplicated', async () => {
  fresh();
  const before = await raw();
  const batch = { batchId: 'B1', fileName: 'x.ttx', fileHash: 'hash-1', format: 'TTX' };
  const bills = [{ no: '999001', date: '2026-11-20', customerId: '57900', paymentTerm: 'เงินสด', openedBy: 'หยง', salesperson: 'อาร์ต' }];
  const items = [{ billNo: '999001', line: '1', code: '4012', name: 'แชมพูออยล์', qty: '5', price: '115', amount: '575' }];
  const r1 = await ops({ type: 'import.commit', opId: opId(), payload: { first: true, batch, bills, items, reviews: [{ entityType: 'item', sourceKey: '999001#1', issueCode: 'X', severity: 'info' }] } });
  assert.equal(r1.body.results[0].status, 'ok');
  const r2 = await ops({ type: 'import.commit', opId: opId(), payload: { first: true, batch: { ...batch, batchId: 'B2' }, bills, items } });
  assert.equal(r2.body.results[0].code, 'duplicate_file');
  const r3 = await ops({ type: 'import.commit', opId: opId(), payload: { batch, bills, items } });   // chunk re-sent
  assert.equal(r3.body.results[0].status, 'ok');
  const after = await raw();
  assert.equal(after.bills.length, before.bills.length + 1);
  assert.equal(after.bill_items.length, before.bill_items.length + 1);
  assert.equal(after.bills.at(-1).customerId, '57900');
});

test('data mapping survives re-ordered columns and extra columns in the real sheet', async () => {
  fresh();
  // simulate someone re-ordering columns and adding a helper column in `visits`
  const { MemoryStore } = await import('../../src/server/store.js');
  const { buildFixtures } = await import('../../src/server/fixtures.js');
  const s = new MemoryStore(buildFixtures({ customers: 5 }));
  s.tabs.visits = s.tabs.visits.map((row, i) => [...row].reverse().concat(i === 0 ? ['helper'] : ['']));
  const { execOp } = await import('../../src/server/exec.js');
  const res = await execOp(s, { type: 'visit.log', opId: opId(), payload: { customerId: '57900', kind: 'note', note: 'abc' } }, { now: Date.now(), user: 'u', deviceId: 'd', isAdmin: true });
  assert.equal(res.status, 'ok');
  const h = s.tabs.visits[0], last = s.tabs.visits.at(-1);
  assert.equal(last[h.indexOf('note')], 'abc');
  assert.equal(last[h.indexOf('customerId')], '57900');
  assert.equal(h.at(-1), 'helper');
});

test('missing required column is a clear schema error, not a silent misplaced write', async () => {
  fresh();
  const { MemoryStore, SchemaError } = await import('../../src/server/store.js');
  const s = new MemoryStore({});
  s.tabs.gps[0] = s.tabs.gps[0].filter(h => h !== 'lat');
  await assert.rejects(() => s.headers('gps'), SchemaError);
});

test('photo.add stores metadata; store photo id is appended to the customer', async () => {
  fresh();
  const r = await ops({ type: 'photo.add', opId: opId(), payload: { customerId: '57900', photoType: 'store', imageBase64: 'AAAA', mime: 'image/jpeg', lat: 13.7, lng: 100.5 } });
  assert.equal(r.body.results[0].status, 'ok');
  const rr = await raw();
  assert.equal(rr.photos.length, 1);
  assert.ok(rr.customers.find(c => c.id === '57900').storePhotoFileIds.includes('mem-'));
});

test('unknown op type and oversize batch (>4 ops, Free-plan subrequest cap) are rejected', async () => {
  fresh();
  assert.equal((await ops({ type: 'drop.table', opId: opId(), payload: {} })).body.results[0].status, 'error');
  const many = Array.from({ length: 5 }, () => ({ type: 'visit.log', opId: opId(), payload: {} }));
  assert.equal((await ops(...many)).status, 400);
});

test('all 18 tabs exist in the fixture store with exact headers', async () => {
  fresh();
  for (const t of TABS) {
    const r = t === 'ACCESS' || t === 'changes' || t === 'IMPORT_BATCHES' || t === 'IMPORT_REVIEW' ? (await call(`/api/tab/${t}`)).body.valueRanges[0] : null;
    if (r) assert.deepEqual(r.values[0], SCHEMA[t]);
  }
});
