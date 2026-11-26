import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../public/js/shared/domain.js';
import { buildFixtures } from '../../src/server/fixtures.js';

const NOW = Date.parse('2026-11-26T05:00:00Z');
const model = (o = {}) => D.buildModel(buildFixtures({ now: NOW, ...o }), NOW);

test('dates use Bangkok calendar day', () => {
  assert.equal(D.todayStr(Date.parse('2026-11-26T18:30:00Z')), '2026-11-27'); // 01:30 +07
  assert.equal(D.nowIso(Date.parse('2026-11-26T05:00:00Z')), '2026-11-26T12:00:00+07:00');
});

test('sales = SUM(bill_items.amount); VAT is never added on top', () => {
  const m = model();
  const raw = m.raw.bill_items.reduce((s, i) => s + D.num(i.amount), 0);
  const all = D.salesBetween(m, '', '');
  assert.equal(all.total, raw);
  assert.equal(all.billCount, m.bills.length);
  // a bill that carries its own VAT line is just the sum of its lines
  const vatBill = [...m.itemsByBill.entries()].find(([, it]) => it.some(i => /VAT/.test(i.name)));
  assert.ok(vatBill, 'fixture has a VAT bill');
  assert.equal(D.billTotal(m, vatBill[0]), vatBill[1].reduce((s, i) => s + D.num(i.amount), 0));
  const q = D.qualityReport(m).issues.filter(i => i.code === 'BILL_HAS_VAT_LINE');
  assert.ok(q.length >= 1);
});

test('number parsing handles commas, blanks and text', () => {
  assert.equal(D.num('1,234.50'), 1234.5); assert.equal(D.num(''), 0); assert.equal(D.num('abc'), 0); assert.equal(D.num(undefined), 0);
});

test('customer status: current / lapsed / closed follow settings', () => {
  const m = model();
  const k = D.customerCounts(m);
  assert.equal(k.all, m.customers.length);
  assert.equal(k.current + k.lapsed + k.closed, k.all);
  assert.ok(k.closed > 0 && k.lapsed > 0 && k.current > 0);
  for (const c of m.customers) {
    const st = D.customerStats(m, c.id);
    if (D.isClosedFlag(c.activeFlag)) assert.equal(st.status, 'closed');
    else if (st.lastDate && st.daysSince <= m.settings.lateDays) assert.equal(st.status, 'current');
    else assert.equal(st.status, 'lapsed');
  }
  // lowering the threshold moves customers out of "current"
  const m2 = model(); m2.settings.lateDays = 5; m2._stats.clear();
  assert.ok(D.customerCounts(m2).current < k.current);
});

test('buy cycle = median gap of distinct purchase dates, only with enough history', () => {
  const raw = { customers: [{ id: '1', name: 'a', activeFlag: 'TRUE' }], bills: [], bill_items: [], systemSettings: [] };
  const today = D.todayStr(NOW), t = D.dayNum(today);
  [t - 60, t - 40, t - 20].forEach((d, i) => { raw.bills.push({ no: 'B' + i, date: D.dayStr(d), customerId: '1' }); });
  const m = D.buildModel(raw, NOW);
  const st = D.customerStats(m, '1');
  assert.equal(st.cycle, 20);
  assert.equal(st.dueDate, D.dayStr(t));          // last + 20 days = today
  assert.equal(st.cycleState, 'soon');
  raw.bills.pop();                                 // only 2 dates -> no cycle claimed
  const m2 = D.buildModel(raw, NOW);
  assert.equal(D.customerStats(m2, '1').cycle, null);
  assert.equal(D.customerStats(m2, '1').cycleState, 'none');
});

test('overdue / soon / missed-visit suggestions are computed (never stored)', () => {
  const m = model();
  const s = D.suggestions(m);
  for (const x of s.overdue) assert.equal(x.st.cycleState, 'overdue');
  for (const x of s.soon) assert.ok(x.days >= 0 && x.days <= m.settings.soonDays);
  for (const x of s.missed) assert.ok(x.st.visitDue && x.st.status === 'current');
});

test('calendar counts planned appointments and computed due dates on their day', () => {
  const m = model();
  const ym = m.today.slice(0, 7);
  const cal = D.monthCalendar(m, ym);
  const planned = m.raw.visits.filter(v => v.status === 'planned' && v.plannedAt.startsWith(ym));
  for (const v of planned) assert.ok(cal.get(v.plannedAt)?.some(x => x.c.id === v.customerId && x.reason === 'นัดหมาย'));
});

test('legacy pairs: only user-confirmed pairs, and never when names conflict', () => {
  const m = model();
  const ok = D.resolveLegacy(m, '8217', 'สบู่เหลว 1,000 ml. กลิ่นมะลิ');
  assert.ok(ok.ok); assert.equal(ok.target.code, '8217*');
  assert.ok(D.resolveLegacy(m, '8741*', 'เจลอาบน้ำ 500 ml. กลิ่นลาเวนเดอร์').ok);
  const bad = D.resolveLegacy(m, '9833*', 'ทรีทเมนต์เคราติน 2,000 ml.');  // register 9841 is a face foam 250 ml
  assert.equal(bad.ok, false);
  assert.equal(D.resolveLegacy(m, '7777', 'x'), null);                      // unknown code: never guessed
  assert.deepEqual(D.LEGACY_PAIRS.map(p => `${p.old}>${p.next}`), ['8217>8217*', '8741*>9861', '9833*>9841', '9834*>9837', '9835*>9839']);
});

test('same product sold as different codes (promo/dozen) is NOT merged', () => {
  const m = model();
  assert.ok(m.prodByCode.has('9617') && m.prodByCode.has('9617-4'));
  assert.notEqual(m.prodByCode.get('9617').name, m.prodByCode.get('9617-4').name);
});

test('unregistered codes list keeps billed name/qty/price and explains, never calls them wrong', () => {
  const m = model({ customers: 120 });
  const rows = D.unregisteredItems(m);
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(!m.prodByCode.has(r.code));
    assert.ok(r.billNo && r.date && r.customerId && r.line);
    const bill = m.billByNo.get(r.billNo); assert.equal(r.clerk, bill.openedBy);
  }
  const sum = D.unregisteredSummary(rows);
  assert.ok(sum.find(s => s.code === '7777'));
  const csv = D.toCsv(rows, ['billNo', 'date', 'customerId', 'code', 'name']);
  assert.ok(csv.startsWith('﻿billNo,date'));
});

test('smart search: id, name, phone, label, contact, address, product, bill', () => {
  const m = model();
  const c = m.customers[5];
  assert.equal(D.searchCustomers(m, c.id)[0].id, c.id);
  assert.ok(D.searchCustomers(m, c.name).some(x => x.id === c.id));
  const ph = D.custPhones(m, c.id)[0];
  assert.ok(D.searchCustomers(m, ph).some(x => x.id === c.id));
  const lb = D.custLabels(m, c.id)[0];
  assert.ok(D.searchCustomers(m, lb).some(x => x.id === c.id));
  assert.ok(D.searchProducts(m, '4012').some(p => p.code === '4012'));
  assert.ok(D.searchBills(m, m.bills[0].no.slice(0, 5)).length > 0);
  assert.deepEqual(D.searchCustomers(m, '   '), []);
});

test('regular items come from real history, ignoring free lines; codes stay text', () => {
  const m = model();
  const id = m.customers.find(c => (m.billsByCust.get(c.id) || []).length >= 6).id;
  const r = D.regularItems(m, id);
  assert.ok(r.length > 0 && r.every(x => typeof x.code === 'string'));
  assert.ok(r[0].bills >= r[r.length - 1].bills);
});

test('quality report flags duplicates and orphan references', () => {
  const raw = buildFixtures({ now: NOW, customers: 10 });
  raw.customers.push({ ...raw.customers[0] });
  raw.bills.push({ ...raw.bills[0] });
  raw.bill_items.push({ billNo: 'NOPE', line: '1', code: '1', name: 'x', qty: '1', price: '1', amount: '1' });
  const q = D.qualityReport(D.buildModel(raw, NOW));
  const codes = q.issues.map(i => i.code);
  for (const c of ['DUP_CUSTOMER_ID', 'DUP_BILL_NO', 'ITEM_NO_BILL', 'COUNT_DIFF']) assert.ok(codes.includes(c), c);
});

test('order doc hides product codes but shows customer code', () => {
  const m = model();
  const c = m.customers[0];
  const txt = D.orderDocText(m, { no: 'OD1', date: '2026-11-26', customerId: c.id, paymentTerm: 'เงินสด', note: '' }, [{ code: '4012', name: 'แชมพูออยล์', qty: 5, price: 115, unit: '' }]);
  assert.ok(txt.includes(`รหัสลูกค้า: ${c.id}`));
  assert.ok(txt.includes('แชมพูออยล์') && txt.includes('575'));
  assert.ok(!txt.includes('4012'));
});

test('settings merge keeps unknown keys; latest row wins', () => {
  const s = D.parseSettings([{ updatedAt: '2026-01-01', data: '{"lateDays":10,"comm":8}' }, { updatedAt: '2026-02-01', data: '{"lateDays":120,"vatRate":7}' }]);
  assert.equal(s.lateDays, 120); assert.equal(s.dormDays, 365);
});

test('period ranges', () => {
  assert.deepEqual(D.periodRange('lastmonth', '2026-01-15'), ['2025-12-01', '2025-12-31']);
  assert.deepEqual(D.periodRange('month', '2026-11-26'), ['2026-11-01', '2026-11-26']);
});

test('activeFlag as found in the REAL sheet: blank = active, FALSE = closed, TRUE = active', () => {
  assert.equal(D.isClosedFlag(''), false); assert.equal(D.isClosedFlag(undefined), false);
  assert.equal(D.isClosedFlag('FALSE'), true); assert.equal(D.isClosedFlag('false'), true);
  assert.equal(D.isClosedFlag('TRUE'), false);
  const raw = { customers: [{ id: 'a', activeFlag: '' }, { id: 'b', activeFlag: 'FALSE' }, { id: 'c', activeFlag: 'TRUE' }], bills: [], bill_items: [], systemSettings: [] };
  const m = D.buildModel(raw, NOW);
  assert.equal(D.customerStats(m, 'b').status, 'closed');
  assert.notEqual(D.customerStats(m, 'a').status, 'closed'); assert.notEqual(D.customerStats(m, 'c').status, 'closed');
});

test('sales by clerk uses bills.openedBy; salesperson is reported separately and both sum to the total', () => {
  const m = model(); const r = D.salesBetween(m, '', '');
  const sum = x => [...x.values()].reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sum(r.byClerk)), Math.round(r.total)); assert.equal(Math.round(sum(r.bySales)), Math.round(r.total));
  assert.ok([...r.byClerk.keys()].every(k => ['หยง', 'เหมียว', 'ฝน'].includes(k)));
  assert.deepEqual([...r.bySales.keys()], ['อาร์ต']);
});
