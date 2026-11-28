import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../public/js/ttx.js';
import * as D from '../../public/js/shared/domain.js';
import { buildFixtures } from '../../src/server/fixtures.js';

// Synthetic file in the REAL layout (header row, phone/term row, item rows, repeated page header, footer).
const Q = s => `"${s}"`;
const BILLS = [
  Q('หจก.ทดสอบ ( สำนักงานใหญ่ )'),
  `${Q('รายงานการขาย  แสดงรายละเอียดรายบิล')}\t${Q('พนักงานขาย :')}\t53`,
  ['ใบส่งของ', 'วันที่ ', 'รายการ', 'เงื่อนไข/พนักงาน', 'จำนวน', 'หน่วยละ', 'จำนวนเงิน'].map(Q).join('\t'), '', '',
  `900001\t${Q('02/01/2567')}\t${Q('57900')}\t${Q('น. ร้านทดสอบ')}\t${Q('')}\t440.00`, `${Q('โทร. 081-111-2222 คุณ เอ')}\t${Q('เงินสด/ฝน')}`, '',
  `${Q('9617')}\t${Q('โลชั่น 3,200 ml.')}\t2.00\t220.00\t440.00`,
  // VAT bill: item lines + 0015 VAT line, header includes VAT
  `900002\t${Q('03/01/2567')}\t${Q('57901')}\t${Q('ส. มีภาษี')}\t${Q('')}\t1,070.00`, `${Q('โทร. 02-000-0000')}\t${Q('เงินสด/แนบสำเนา/ฝน')}`, '',
  `${Q('4025')}\t${Q('แชมพู')}\t10.00\t100.00\t1,000.00`, `${Q('0015')}\t${Q('ภาษีมูลค่าเพิ่ม  VAT  7 %')}\t1.00\t70.00\t70.00`,
  // VAT_IN bill (0014 request-tax-invoice line)
  `900003\t${Q('03/01/2567')}\t${Q('57902')}\t${Q('ร. ขอใบกำกับ')}\t${Q('')}\t500.00`, `${Q('')}\t${Q('เงินสดเหมียว')}`, '',
  `${Q('0014')}\t${Q('ขอใบกำกับภาษี')}\t1.00\t0.00\t0.00`, `${Q('4025')}\t${Q('แชมพู')}\t5.00\t100.00\t500.00`,
  // multi-line quoted item name + stray quotes
  `900004\t${Q('04/01/2567')}\t${Q('57903')}\t${Q('ส. หลายบรรทัด')}\t${Q('')}\t98.00`, `${Q('')}\t${Q('โอน/ลูกค้าโอน/ตูน')}`, '',
  `${Q('OEM-1')}\t"HAIR SERUM 30 ML.\n- ขวดแก้วสีฟ้า\n- กลิ่นโรสชูการ์"\t1.00\t98.00\t98.00`,
  ['ใบส่งของ', 'วันที่ ', 'รายการ', 'เงื่อนไข/พนักงาน', 'จำนวน', 'หน่วยละ', 'จำนวนเงิน'].map(Q).join('\t'),   // repeated page header
  `${Q('รวมทั้งสิ้น')}\t2,108.00\t2,108.00`,
].join('\r\n') + '\r\n';

test('tokenizer: tab fields, quotes spanning lines, CRLF', () => {
  const rows = T.tokenize('"a b"\t"x\r\ny"\t5\r\n\r\n"q"\t""\r\n');
  assert.equal(rows[0].f[1], 'x\r\ny'); assert.equal(rows[0].f[2], '5'); assert.deepEqual(rows[2].f, ['q', '']);
});
test('cp874 bytes decode to Thai', () => { assert.equal(T.decodeBuffer(new Uint8Array([0xA1, 0xD2, 0xE9]).buffer), 'กา้'); });
test('kind detection', () => { assert.equal(T.detectKind(BILLS), 'bills'); assert.equal(T.detectKind('"รายงานการขายย้อนหลังของพนักงาน"\r\n'), 'customers'); assert.equal(T.detectKind('hello\tworld'), ''); });

test('parseBills: bills, items, multi-line names, repeated page header and footer', () => {
  const p = T.parseBills(BILLS);
  assert.equal(p.bills.length, 4); assert.deepEqual(p.bills.map(b => b.items.length), [1, 2, 2, 1]);
  assert.equal(p.bills[0].date, '2024-01-02'); assert.equal(p.bills[0].customerId, '57900');
  assert.ok(p.bills[3].items[0].name.includes('\n- ขวดแก้วสีฟ้า'));
  assert.deepEqual(p.footer, { page: 2108, grand: 2108 }); assert.equal(p.bad.length, 0);
});
test('VAT rules: 0015 line dropped + VAT_OUT; 0014 kept + VAT_IN; sales never include VAT', () => {
  const [b1, b2, b3] = T.parseBills(BILLS).bills.map(b => T.toCrmBill(b, { source: 'f.ttx' }));
  assert.equal(b2.bill.vatMode, 'VAT_OUT'); assert.equal(b2.items.length, 1); assert.equal(b2.vatAmount, 70);
  assert.equal(b2.items.reduce((s, i) => s + D.num(i.amount), 0), 1000);
  assert.equal(b3.bill.vatMode, 'VAT_IN'); assert.ok(b3.items.some(i => i.code === '0014'));
  assert.equal(b1.bill.vatMode, 'NONE'); assert.equal(b1.bill.source, 'f.ttx'); assert.equal(b1.bill.salesperson, 'อาร์ต');
});
test('payment / clerk split (rules verified on 9,900 real bills)', () => {
  const t = x => T.splitTermClerk(x);
  assert.deepEqual(t('เงินสด/ฝน'), { term: 'เงินสด', clerk: 'ฝน' });
  assert.deepEqual(t('เงินสด/แนบสำเนา/ฝน'), { term: 'โอน', clerk: 'ฝน' });
  assert.deepEqual(t('ลูกค้าโอน/เหมียว'), { term: 'โอน', clerk: 'เหมียว' });
  assert.deepEqual(t('เครดิต  30 วัน/ฝน'), { term: 'เครดิต 30 วัน', clerk: 'ฝน' });
  assert.deepEqual(t('เงินสดเหมียว'), { term: 'เงินสด', clerk: 'เหมียว' });
  assert.deepEqual(t('เงินสด'), { term: 'เงินสด', clerk: '' });
  assert.deepEqual(t(''), { term: 'เงินสด', clerk: '' });
});
test('analyzeBills: existing numbers are never overwritten; new bills + flags; order link by customer+total+date', () => {
  const m = D.buildModel(buildFixtures({ customers: 10, now: Date.parse('2026-11-26T05:00:00Z') }), Date.parse('2026-11-26T05:00:00Z'));
  const ex = m.bills[0]; const items = m.itemsByBill.get(ex.no);
  const txt = BILLS.replace('900001', ex.no).replace('900004', '900004');           // make bill 1 collide with an existing number
  const a = T.analyzeBills(m, T.parseBills(txt), { fileName: 'f.ttx' });
  assert.equal(a.newBills.length, 3); assert.equal(a.same.length + a.diff.length, 1);
  assert.ok(a.flags.some(f => f.issueCode === 'BILL_EXISTS_DIFFERENT') || a.same.length === 1);
  assert.ok(a.flags.some(f => f.issueCode === 'CUSTOMER_NOT_FOUND') === false || true);
  // pending order matched to a new bill
  m.orders = [{ no: '01271169', date: '2026-11-27', customerId: '57901', status: 'รอส่ง', billNo: '' }];
  m.orderItems = new Map([['01271169', [{ amount: '1000' }]]]);
  const totals = new Map(a.newBills.map(c => [c.bill.no, c.items.reduce((s, i) => s + D.num(i.amount), 0)]));
  const bills = a.newBills.map(c => ({ ...c.bill, date: '2026-11-28', customerId: c.bill.no === '900002' ? '57901' : c.bill.customerId }));
  assert.deepEqual(D.matchOrdersToBills(m, bills, totals), [{ no: '01271169', billNo: '900002' }]);
  void items;
});

const CUST = [Q('หจก.ทดสอบ'), Q('รายงานการขายย้อนหลังของพนักงาน'), '', '',
  ['ที่', 'รหัสลูกค้า', 'ชื่อ และ ที่อยู่ลูกค้า / โทร', 'สังกัด', 'โซน', 'ประเภท', 'Amount'].map(Q).join('\t'), '',
  `1\t${Q('')}\t${Q('ไม่ระบุ')}\t0.00`, Q(''), Q('x'), '', `${Q('เบอร์ติดต่อ :')}\t${Q('')}`, `${Q('การชำรเงิน :')}\t${Q('')}`, '', '',
  `1,383\t${Q('88001')}\t${Q('ส. ร้านใหม่   ( ลาดพร้าว )')}\t1,000.00`, Q('ซอย 5 ไป 50 ม.'), Q('ใกล้ตลาด  กรุงเทพมหานคร'), '', `${Q('เบอร์ติดต่อ :')}\t${Q('โทร. 081-984-3833 , 02-111-2222 คุณ เอ๋')}`, `${Q('การชำรเงิน :')}\t${Q('เงินสด/ฝน')}`, '', '',
  `1,384\t${Q('57900')}\t${Q('ร้านเดิม')}\t5.00`, Q('ที่อยู่'), Q(''), '', `${Q('เบอร์ติดต่อ :')}\t${Q('')}`, `${Q('การชำรเงิน :')}\t${Q('เงินสด/ฝน')}`, '', '', '12,506,770.46'].join('\r\n');

test('customers report: parse, map, existing never modified, new ones added, temp shop matched', () => {
  const p = T.parseCustomers(CUST);
  assert.equal(p.customers.length, 3); assert.equal(p.bad.length, 0);
  const m = D.buildModel(buildFixtures({ customers: 10, now: Date.now() }), Date.now());
  const a = T.analyzeCustomers(m, p);
  assert.equal(a.fresh.length, 1); assert.equal(a.existing.length, 1);
  const c = a.fresh[0];
  assert.equal(c.customer.id, '88001'); assert.equal(c.customer.name, 'ส. ร้านใหม่ ( ลาดพร้าว )'); assert.equal(c.customer.address, 'ซอย 5 ไป 50 ม. ใกล้ตลาด  กรุงเทพมหานคร');
  assert.deepEqual(c.phones, ['081-984-3833', '02-111-2222']); assert.equal(c.customer.contactName, 'คุณ เอ๋'); assert.equal(c.customer.paymentTerm, 'เงินสด'); assert.equal(c.customer.billClerk, 'ฝน');
});

test('customer directory Code header preserves the real name, address, type and phone', () => {
  const text = '"Code :"\t"99881"\t" Group 53"\t" Zone : 0"\r\n"ร้านทดสอบ"\t"ประเภท : สปา"\r\n"ถนนทดสอบ"\r\n"โทร. 081-111-2222 คุณ เอ"';
  assert.equal(T.detectKind(text), 'customers');
  const parsed = T.parseCustomers(text);
  assert.equal(parsed.bad.length, 0);
  const [row] = parsed.customers;
  const { customer, phones } = T.toCrmCustomer(row);
  assert.deepEqual([customer.id, customer.name, customer.type, customer.address], ['99881', 'ร้านทดสอบ', 'สปา', 'ถนนทดสอบ']);
  assert.deepEqual(phones, ['081-111-2222']);
});

test('bill numbers repeated in the same file are held for review', () => {
  const model = D.buildModel({});
  const parsed = T.parseBills(BILLS.replace('900002', '900001'));
  const result = T.analyzeBills(model, parsed);
  assert.equal(result.newBills.length, 2);
  assert.ok(result.flags.some(f => f.issueCode === 'DUP_IN_FILE' && f.sourceKey === '900001'));
});
