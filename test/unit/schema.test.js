import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, TABS, TOTAL_COLUMNS, rowsToObjects, objectToRow, checkHeaders, OPID_TABS } from '../../public/js/shared/schema.js';

test('18 tabs / 178 columns exactly as delivered', () => {
  assert.equal(TABS.length, 18);
  assert.equal(TOTAL_COLUMNS, 178);
  const expected = { customers: 26, customer_phones: 3, customer_labels: 3, bills: 10, bill_items: 7, products: 2, orders: 13, order_items: 8, visits: 15, tasks: 13, activities: 10, gps: 12, photos: 14, ACCESS: 4, changes: 9, systemSettings: 3, IMPORT_BATCHES: 11, IMPORT_REVIEW: 15 };
  for (const [t, n] of Object.entries(expected)) assert.equal(SCHEMA[t].length, n, t);
});
test('header names unique within each tab', () => {
  for (const t of TABS) assert.equal(new Set(SCHEMA[t]).size, SCHEMA[t].length, t);
});
test('rows are mapped by header name, tolerate short rows, reordered and extra columns', () => {
  const m = [['name', 'id', 'zzExtra', 'type'], ['ร้าน A', '00123', 'x'], ['ร้าน B', '57926', 'y', 'นวด']];
  const o = rowsToObjects(m);
  assert.equal(o[0].id, '00123');           // text id keeps leading zeros
  assert.equal(o[0].type, '');              // trimmed trailing cell -> empty string
  assert.equal(o[1].type, 'นวด');
});
test('objectToRow follows the real sheet header order', () => {
  assert.deepEqual(objectToRow(['b', 'a', 'x'], { a: 1, b: 'q' }), ['q', '1', '']);
});
test('checkHeaders reports missing columns and ignores order', () => {
  const ok = checkHeaders('products', ['name', 'code']);
  assert.ok(ok.ok);
  const bad = checkHeaders('products', ['code']);
  assert.deepEqual(bad.missing, ['name']);
});
test('opId-bearing tabs support duplicate-save protection', () => {
  for (const t of ['orders', 'visits', 'tasks', 'activities', 'gps', 'photos']) assert.ok(OPID_TABS.includes(t), t);
});

import fs from 'node:fs';
test('SCHEMA equals the header rows captured from the REAL CRM spreadsheet (all 18 tabs, same order)', () => {
  const live = JSON.parse(fs.readFileSync(new URL('../fixtures/live-headers.json', import.meta.url), 'utf8')).tabs;
  assert.deepEqual(Object.keys(live), TABS);
  for (const t of TABS) assert.deepEqual(live[t], SCHEMA[t], t);
  assert.equal(Object.values(live).reduce((n, a) => n + a.length, 0), 178);
});
