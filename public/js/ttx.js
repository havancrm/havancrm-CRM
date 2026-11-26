// TTX import parser. ASSUMPTION (unverified against the real exporter, see docs/REPORT.md):
// a delimited text export (tab / comma / pipe / semicolon) whose first row holds column titles.
// Column titles are matched by synonym; when the required columns are not found the file is
// REJECTED with a clear message instead of guessing a layout.
const SYN = {
  billNo: ['เลขที่บิล', 'เลขที่เอกสาร', 'เลขที่', 'billno', 'bill_no', 'docno', 'doc_no', 'invoice', 'invoiceno', 'no'],
  date: ['วันที่', 'date', 'docdate', 'billdate'],
  customerId: ['รหัสลูกค้า', 'customerid', 'custcode', 'cust_id', 'customer_id', 'custid'],
  customerName: ['ชื่อลูกค้า', 'customername', 'custname'],
  code: ['รหัสสินค้า', 'itemcode', 'code', 'sku', 'productcode'],
  name: ['ชื่อสินค้า', 'รายการ', 'รายละเอียด', 'description', 'itemname', 'productname', 'name'],
  qty: ['จำนวน', 'qty', 'quantity'],
  price: ['ราคา', 'ราคาต่อหน่วย', 'price', 'unitprice'],
  amount: ['จำนวนเงิน', 'amount', 'total', 'รวมเงิน', 'ยอดรวม'],
  openedBy: ['เสมียน', 'openedby', 'clerk'],
  salesperson: ['พนักงานขาย', 'salesperson', 'sales', 'พนักงาน'],
  paymentTerm: ['เงื่อนไขชำระ', 'เงื่อนไข', 'paymentterm', 'terms', 'payment'],
};
const REQUIRED = ['billNo', 'date', 'customerId', 'name', 'qty', 'price', 'amount'];
const norm = s => String(s ?? '').trim().toLowerCase().replace(/[\s_\-.]+/g, '');
const SYN_N = Object.fromEntries(Object.entries(SYN).map(([k, v]) => [k, v.map(norm)]));

export function decodeBuffer(buf) {
  let t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (t.includes('�')) { try { t = new TextDecoder('windows-874').decode(buf); } catch { /* keep utf-8 */ } }
  return t.replace(/^﻿/, '');
}
function splitLine(line, d) {
  if (d !== ',') return line.split(d).map(s => s.trim());
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch; }
  out.push(cur.trim()); return out;
}
export function normDate(s) {
  s = String(s || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(s);
  if (m) { let y = +m[3]; if (y < 100) y += y > 50 ? 2500 : 2000; if (y > 2400) y -= 543; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return '';
}
export function parseTtx(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { error: 'ไฟล์ว่างหรือมีไม่ถึง 2 บรรทัด' };
  let best = null;
  for (const d of ['\t', '|', ';', ',']) { const n = splitLine(lines[0], d).length; if (!best || n > best.n) best = { d, n }; }
  if (best.n < 5) return { error: 'ไม่รู้จักรูปแบบไฟล์ TTX (ต้องเป็นข้อความที่คั่นด้วย Tab/จุลภาค/| และมีแถวหัวคอลัมน์)' };
  const head = splitLine(lines[0], best.d).map(norm);
  const col = {};
  for (const [k, syns] of Object.entries(SYN_N)) { const i = head.findIndex(h => syns.includes(h)); if (i >= 0) col[k] = i; }
  const missing = REQUIRED.filter(k => col[k] === undefined);
  if (missing.length) return { error: `ไม่พบคอลัมน์ที่จำเป็น: ${missing.join(', ')} — แถวหัวที่อ่านได้: ${splitLine(lines[0], best.d).join(' | ')}` };
  const bills = new Map(), items = [], bad = [];
  for (let r = 1; r < lines.length; r++) {
    const f = splitLine(lines[r], best.d), g = k => (col[k] === undefined ? '' : (f[col[k]] ?? ''));
    const no = g('billNo'), date = normDate(g('date'));
    if (!no || !date || !g('name')) { bad.push({ row: r + 1, reason: !no ? 'ไม่มีเลขที่บิล' : !date ? `วันที่ไม่ถูกต้อง "${g('date')}"` : 'ไม่มีชื่อสินค้า' }); continue; }
    if (!bills.has(no)) bills.set(no, { no, date, customerId: g('customerId'), customerNameOverride: '', paymentTerm: g('paymentTerm'), openedBy: g('openedBy'), salesperson: g('salesperson'), _name: g('customerName'), lines: 0 });
    const b = bills.get(no); b.lines++;
    const num = v => String(v).replace(/,/g, '');
    items.push({ billNo: no, line: String(b.lines), code: g('code'), name: g('name'), qty: num(g('qty')), price: num(g('price')), amount: num(g('amount')), _row: r + 1 });
  }
  return { delimiter: best.d === '\t' ? 'Tab' : best.d, bills: [...bills.values()], items, bad };
}

// Compare parsed bills with the current model. Existing bill numbers are never overwritten.
export function analyze(m, parsed, fileName) {
  const num = v => parseFloat(v) || 0;
  const newBills = [], same = [], diff = [], reviews = [];
  const itemsByBill = new Map(); parsed.items.forEach(i => { if (!itemsByBill.has(i.billNo)) itemsByBill.set(i.billNo, []); itemsByBill.get(i.billNo).push(i); });
  const unknownCust = new Set(), codes = new Map();
  for (const b of parsed.bills) {
    const its = itemsByBill.get(b.no) || [], total = its.reduce((s, i) => s + num(i.amount), 0);
    const ex = m.billByNo.get(b.no);
    if (ex) { const t0 = m.billTotals.get(b.no) || 0; (Math.abs(t0 - total) < 0.005 && ex.customerId === b.customerId ? same : diff).push({ b, total, t0 }); }
    else newBills.push(b);
    if (!m.custById.has(b.customerId)) unknownCust.add(b.customerId);
    for (const i of its) { if (i.code && !m.prodByCode.has(i.code)) codes.set(i.code, (codes.get(i.code) || 0) + 1); if (Math.abs(num(i.qty) * num(i.price) - num(i.amount)) > 0.01) reviews.push({ entityType: 'bill_item', sourceKey: `${b.no}#${i.line}`, issueCode: 'AMOUNT_NE_QTY_X_PRICE', severity: 'info', sourceValue: `${i.qty}×${i.price}≠${i.amount}`, suggestedAction: 'ใช้ยอดจากไฟล์ (amount) ตามกติกา' }); }
  }
  for (const { b, total, t0 } of diff) reviews.push({ entityType: 'bill', sourceKey: b.no, issueCode: 'BILL_EXISTS_DIFFERENT', severity: 'warn', sourceValue: `ไฟล์ ${total}`, existingValue: `ฐาน ${t0}`, suggestedAction: 'ไม่เขียนทับ ตรวจสอบเอง' });
  for (const id of unknownCust) reviews.push({ entityType: 'customer', sourceKey: id, issueCode: 'CUSTOMER_NOT_FOUND', severity: 'warn', sourceValue: id, suggestedAction: 'เพิ่มลูกค้าในฐานก่อน หรือตรวจรหัส' });
  for (const [code, n] of codes) reviews.push({ entityType: 'product', sourceKey: code, issueCode: 'CODE_NOT_IN_REGISTRY', severity: 'info', sourceValue: `${n} บรรทัด`, suggestedAction: 'ตรวจรหัส/ชื่อสินค้า (รหัสเก่าไม่ได้แปลว่าผิด)' });
  for (const x of parsed.bad) reviews.push({ entityType: 'row', sourceKey: `${fileName}:${x.row}`, issueCode: 'ROW_REJECTED', severity: 'warn', sourceValue: x.reason, suggestedAction: 'แก้ไฟล์แล้วนำเข้าใหม่' });
  const importBills = newBills.filter(b => (itemsByBill.get(b.no) || []).length);
  return { newBills: importBills, same, diff, unknownCust: [...unknownCust], codes, reviews, itemsByBill, newItems: importBills.flatMap(b => itemsByBill.get(b.no)) };
}
