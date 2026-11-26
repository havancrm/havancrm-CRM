// Exercises the REAL SheetsStore + executor against a faithful in-memory fake of the Google APIs
// (token endpoint with RS256 JWT verification, values.get/batchGet/append/batchUpdate, deleteDimension,
// Google's habit of trimming trailing empty cells). No network, no real spreadsheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SheetsStore, SchemaError } from '../../src/server/store.js';
import { execBatch } from '../../src/server/exec.js';
import { SCHEMA, TABS, rowsToObjects } from '../../public/js/shared/schema.js';
import { buildFixtures } from '../../src/server/fixtures.js';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

function colIndex(L) { let n = 0; for (const ch of L) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
function makeSheet(seed, { reorder = false } = {}) {
  const tabs = {};
  for (const t of TABS) {
    let head = SCHEMA[t].slice();
    if (reorder) head = head.slice().reverse().concat(['zz_helper']);
    const rows = (seed[t] || []).map(o => head.map(h => (o[h] === undefined ? '' : String(o[h]))));
    tabs[t] = [head, ...rows];
  }
  const calls = []; let tokenCalls = 0;
  const trim = r => { const a = r.map(v => (v === undefined || v === null ? '' : v)); while (a.length && a[a.length - 1] === '') a.pop(); return a; };
  const ids = Object.fromEntries(TABS.map((t, i) => [t, 1000 + i]));
  const fakeFetch = async (url, init = {}) => {
    const u = new URL(url); const method = init.method || 'GET';
    calls.push(`${method} ${u.pathname}${u.search.slice(0, 60)}`);
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.host === 'oauth2.googleapis.com') {
      tokenCalls++;
      const jwt = new URLSearchParams(init.body).get('assertion').split('.');
      const ok = crypto.verify('RSA-SHA256', Buffer.from(`${jwt[0]}.${jwt[1]}`), publicKey, Buffer.from(jwt[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
      const claim = JSON.parse(Buffer.from(jwt[1], 'base64url').toString());
      if (!ok || claim.iss !== 'sa@test.iam' || !claim.scope.includes('spreadsheets')) return json({ error: 'bad jwt' }, 400);
      return json({ access_token: 'tok', expires_in: 3600 });
    }
    if (!(init.headers?.authorization || '').startsWith('Bearer tok')) return json({ error: 'unauth' }, 401);
    const path = decodeURIComponent(u.pathname.replace('/v4/spreadsheets/SID', ''));
    const body = init.body ? JSON.parse(init.body) : null;
    const rangeOf = r => { const m = /^'?([^'!]+)'?(?:!(.+))?$/.exec(r); return { tab: m[1], a1: m[2] || '' }; };
    const readRange = r => {
      const { tab, a1 } = rangeOf(r); const M = tabs[tab]; if (!M) throw new Error('no tab ' + tab);
      let m;
      if ((m = /^(\d+):(\d+)$/.exec(a1))) return [trim(M[+m[1] - 1] || [])];
      if ((m = /^([A-Z]+)(\d+):([A-Z]+)$/.exec(a1))) { const c = colIndex(m[1]); const out = []; for (let i = +m[2] - 1; i < M.length; i++) out.push(M[i][c] === undefined || M[i][c] === '' ? [] : [M[i][c]]); while (out.length && !out[out.length - 1].length) out.pop(); return init.__cols ? [out.map(x => x[0] ?? '')] : out; }
      if ((m = /^A(\d+):([A-Z]+)(\d+)$/.exec(a1))) return [trim(M[+m[1] - 1] || [])];
      throw new Error('range? ' + a1);
    };
    if (method === 'GET' && path === '') return json({ sheets: TABS.map(t => ({ properties: { sheetId: ids[t], title: t } })) });
    if (method === 'GET' && path === '/values:batchGet') {
      const ranges = u.searchParams.getAll('ranges');
      return json({ valueRanges: ranges.map(r => { const { tab } = rangeOf(r); const a1 = rangeOf(r).a1; const vals = a1 === '1:1' ? [trim(tabs[tab][0])] : tabs[tab].map(trim); return { range: r, majorDimension: 'ROWS', values: vals }; }) });
    }
    if (method === 'GET' && path.startsWith('/values/')) {
      const r = path.slice(8); const cols = u.searchParams.get('majorDimension') === 'COLUMNS';
      const { a1 } = rangeOf(r); let vals;
      if (/^[A-Z]+\d+:[A-Z]+$/.test(a1)) { const m = /^([A-Z]+)(\d+):/.exec(a1); const M = tabs[rangeOf(r).tab]; const c = colIndex(m[1]); const col = []; for (let i = +m[2] - 1; i < M.length; i++) col.push(M[i][c] ?? ''); while (col.length && col[col.length - 1] === '') col.pop(); vals = cols ? [col] : col.map(v => [v]); }
      else vals = readRange(r);
      return json({ range: r, values: vals });
    }
    if (method === 'POST' && /:append$/.test(path)) {
      const { tab } = rangeOf(path.slice(8).replace(/:append$/, '')); if (u.searchParams.get('valueInputOption') !== 'RAW') return json({ error: 'need RAW' }, 400);
      for (const row of body.values) tabs[tab].push(row.map(v => v)); return json({ updates: { updatedRows: body.values.length } });
    }
    if (method === 'POST' && path === '/values:batchUpdate') {
      if (body.valueInputOption !== 'RAW') return json({ error: 'need RAW' }, 400);
      for (const d of body.data) { const { tab, a1 } = rangeOf(d.range); const m = /^([A-Z]+)(\d+)$/.exec(a1); const c = colIndex(m[1]), r = +m[2] - 1; const row = tabs[tab][r]; while (row.length <= c) row.push(''); row[c] = d.values[0][0]; }
      return json({ totalUpdatedCells: body.data.length });
    }
    if (method === 'POST' && path === ':batchUpdate') {
      for (const rq of body.requests) { const { sheetId, startIndex } = rq.deleteDimension.range; const t = Object.keys(ids).find(k => ids[k] === sheetId); tabs[t].splice(startIndex, 1); }
      return json({});
    }
    return json({ error: 'unhandled ' + method + ' ' + path }, 404);
  };
  return { tabs, calls, fakeFetch, get tokenCalls() { return tokenCalls; } };
}
const ctx = { now: Date.now(), user: 'u@x', deviceId: 'dv', isAdmin: true };
const asObjs = (g, t) => rowsToObjects(g.tabs[t]);
async function withStore(opts, fn) {
  const g = makeSheet(buildFixtures({ customers: 12, now: Date.now() }), opts);
  const real = globalThis.fetch; globalThis.fetch = g.fakeFetch;
  try { await fn(new SheetsStore({ SPREADSHEET_ID: 'SID', GOOGLE_SA_EMAIL: 'sa@test.iam', GOOGLE_SA_KEY: PEM.replace(/\n/g, '\\n') }), g); } finally { globalThis.fetch = real; }
}
let n = 0; const oid = () => `sheets-op-${Date.now()}-${++n}`;

test('service-account JWT (RS256) is accepted and the token is cached', async () => {
  await withStore({}, async (s, g) => {
    await s.headers('visits'); await s.headers('bills'); await s.column('bills', 'no');
    assert.equal(g.tokenCalls, 1);
  });
});

test('visit.log through SheetsStore writes by header name, numeric lat/lng as numbers, ids as text', async () => {
  await withStore({}, async (s, g) => {
    const id = oid();
    const r = await execBatch(s, [{ type: 'visit.log', opId: id, payload: { customerId: '57900', kind: 'visit', note: 'n', lat: '13.75', lng: '100.5', accuracy: '9' } }], ctx);
    assert.equal(r[0].status, 'ok');
    const v = g.tabs.visits.at(-1), h = g.tabs.visits[0];
    assert.equal(v[h.indexOf('customerId')], '57900');           // text id
    assert.equal(typeof v[h.indexOf('lat')], 'number');          // numeric column
    assert.equal(v[h.indexOf('opId')], id);
    const again = await execBatch(s, [{ type: 'visit.log', opId: id, payload: { customerId: '57900', kind: 'visit', note: 'n', lat: '13.75', lng: '100.5' } }], ctx);
    assert.equal(again[0].status, 'duplicate');
    assert.equal(asObjs(g, 'visits').filter(x => x.opId === id).length, 1);
  });
});

test('works when the real sheet has re-ordered columns plus an extra helper column', async () => {
  await withStore({ reorder: true }, async (s, g) => {
    const id = oid();
    const r = await execBatch(s, [{ type: 'customer.update', opId: id, payload: { customerId: '57903', patch: { keepNote: 'จอดซอยข้าง', lineId: 'abc' } } }], ctx);
    assert.equal(r[0].status, 'ok', JSON.stringify(r));
    const h = g.tabs.customers[0]; const row = g.tabs.customers.find(x => x[h.indexOf('id')] === '57903');
    assert.equal(row[h.indexOf('keepNote')], 'จอดซอยข้าง'); assert.equal(row[h.indexOf('lineId')], 'abc');
    assert.equal(h.at(-1), 'zz_helper');
  });
});

test('order.save replaces items with row deletion (descending) and never leaves duplicates', async () => {
  await withStore({}, async (s, g) => {
    const base = { no: 'OD-S1', customerId: '57900', date: '2026-11-26', paymentTerm: 'เงินสด' };
    await execBatch(s, [{ type: 'order.save', opId: oid(), payload: { order: { ...base, status: 'ร่าง' }, lines: [{ code: '4012', name: 'a', qty: 1, price: 10 }, { code: '5029', name: 'b', qty: 2, price: 20 }, { code: '1001', name: 'c', qty: 3, price: 30 }] } }], ctx);
    assert.equal(asObjs(g, 'order_items').filter(i => i.orderNo === 'OD-S1').length, 3);
    await execBatch(s, [{ type: 'order.save', opId: oid(), payload: { order: { ...base, status: 'รอส่ง' }, lines: [{ code: '4012', name: 'a', qty: 5, price: 10 }] } }], ctx);
    const items = asObjs(g, 'order_items').filter(i => i.orderNo === 'OD-S1');
    assert.equal(items.length, 1); assert.equal(items[0].amount, '50');
    assert.equal(asObjs(g, 'orders').filter(o => o.no === 'OD-S1').length, 1);
    assert.equal(asObjs(g, 'orders').find(o => o.no === 'OD-S1').status, 'รอส่ง');
  });
});

test('trailing-empty trimming by Google does not break key lookup or updates', async () => {
  await withStore({}, async (s, g) => {
    const r = await execBatch(s, [{ type: 'customer.geo', opId: oid(), payload: { customerId: '57905', lat: 13.8, lng: 100.6, accuracy: 5 } }], ctx);
    assert.equal(r[0].status, 'ok');
    const c = asObjs(g, 'customers').find(x => x.id === '57905'); assert.ok(c.gpsLat.startsWith('13.8')); assert.ok(c.mapLink.includes('13.8'));
    assert.ok(asObjs(g, 'changes').some(x => x.entity === 'customers' && x.id === '57905'));
  });
});

test('import.commit via SheetsStore is idempotent per bill number / (bill,line) / file hash', async () => {
  await withStore({}, async (s, g) => {
    const p = { first: true, batch: { batchId: 'B', fileName: 'f.ttx', fileHash: 'h1' }, bills: [{ no: '777001', date: '2026-11-01', customerId: '57900' }], items: [{ billNo: '777001', line: '1', code: '4012', name: 'x', qty: '1', price: '10', amount: '10' }] };
    assert.equal((await execBatch(s, [{ type: 'import.commit', opId: oid(), payload: p }], ctx))[0].status, 'ok');
    assert.equal((await execBatch(s, [{ type: 'import.commit', opId: oid(), payload: p }], ctx))[0].code, 'duplicate_file');
    assert.equal((await execBatch(s, [{ type: 'import.commit', opId: oid(), payload: { ...p, first: false } }], ctx))[0].status, 'ok');
    assert.equal(asObjs(g, 'bills').filter(b => b.no === '777001').length, 1);
    assert.equal(asObjs(g, 'bill_items').filter(i => i.billNo === '777001').length, 1);
  });
});

test('missing header in the real sheet fails loudly with the tab and column name', async () => {
  const g = makeSheet(buildFixtures({ customers: 3, now: Date.now() })); g.tabs.gps[0] = g.tabs.gps[0].filter(h => h !== 'accuracy');
  const real = globalThis.fetch; globalThis.fetch = g.fakeFetch;
  try {
    const s = new SheetsStore({ SPREADSHEET_ID: 'SID', GOOGLE_SA_EMAIL: 'sa@test.iam', GOOGLE_SA_KEY: PEM.replace(/\n/g, '\\n') });
    await assert.rejects(() => s.headers('gps'), e => e instanceof SchemaError && /gps/.test(e.message) && /accuracy/.test(e.message));
  } finally { globalThis.fetch = real; }
});

test('bootstrap path is a raw passthrough of one batchGet call (no JSON parsing in the Worker)', async () => {
  await withStore({}, async (s, g) => {
    const r = await s.batchGetRaw(['customers', 'bills']);
    assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.valueRanges.length, 2);
    assert.equal(g.calls.filter(c => c.includes('batchGet')).length, 1);
  });
});
