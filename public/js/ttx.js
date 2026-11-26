// TTX import - REAL format (verified on the files exported from the accounting program):
//  * text, code page 874 (TIS-620), CRLF, TAB separated, fields optionally "quoted" (quotes may span lines)
//  * "บิล" report (รายงานการขาย แสดงรายละเอียดรายบิล):
//        <billNo> <"dd/mm/yyyy" BE> <"custCode"> <"name"> <""> <amount>
//        <"phone / contact"> <"paymentTerm/clerk">
//        <"itemCode"> <"itemName"> <qty> <unit price> <amount>   (one row per item)
//    page headers repeat; footer "รวมทั้งสิ้น".
//  * "ลูกค้า" report (รายงานการขายย้อนหลัง...): <seq> <"code"> <"name"> <amount>, then 2 address rows,
//    then "เบอร์ติดต่อ :" <phone/contact> and "การชำรเงิน :" <term/clerk>.
// Conversion rules were derived by diffing against the bills already in the CRM sheet (see test/real).
import { num, dateOf } from './shared/domain.js';

export function decodeBuffer(buf) {
  let t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (t.includes('�') || /[\u0080-\u009f]/.test(t)) { try { t = new TextDecoder('windows-874').decode(buf); } catch { /* keep */ } }
  return t.replace(/^﻿/, '');
}

// TAB separated records with quoted fields (RFC4180-like, quotes may contain newlines). Returns [{f:[...], q:[bool...]}]
export function tokenize(text) {
  const rows = []; let f = [], q = [], cur = '', quoted = false, inQ = false, any = false;
  const endField = () => { f.push(cur); q.push(quoted); cur = ''; quoted = false; any = false; };
  const endRow = () => { endField(); rows.push({ f, q }); f = []; q = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        const n = text[i + 1];
        if (n === '"') { cur += '"'; i++; }
        else if (n === undefined || n === '\t' || n === '\r' || n === '\n') inQ = false;   // closing quote
        else cur += '"';                                                                     // stray quote inside a name
      } else cur += c;
      continue;
    }
    if (c === '"' && cur === '' && !quoted) { inQ = true; quoted = true; any = true; }
    else if (c === '\t') endField();
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') endRow();
    else { cur += c; any = true; }
  }
  if (cur !== '' || f.length || any) endRow();
  return rows;
}

export const beDate = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim()); if (!m) return ''; let y = +m[3]; if (y > 2400) y -= 543; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };
const money = s => { const n = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : NaN; };
export const isVatLine = it => /ภาษีมูลค่าเพิ่ม|^vat\b/i.test(it.name || '') || it.code === '0015';

// "เงื่อนไข/พนักงาน" e.g. "เงินสด/ฝน", "เงินสด/แนบสำเนา/ฝน", "ลูกค้าโอน/เหมียว", "เงินสดเหมียว", "เครดิต  30 วัน/ฝน"
// Rules derived by diffing 9,900 bills against the CRM sheet: transfer wording (โอน / แนบสำเนา) => "โอน";
// the clerk is the last part that is not payment wording; blank term => "เงินสด".
const PAY_WORD = /เงินสด|โอน|แนบสำเนา|เครดิต|เช็ค|ลูกค้า|ปลายทาง/;
export function splitTermClerk(s) {
  const norm = x => String(x || '').replace(/\s+/g, ' ').trim();
  let parts = norm(s).split('/').map(norm).filter(Boolean);
  if (parts.length === 1) { const m = /^(เงินสด)(\S+)$/.exec(parts[0]); if (m) parts = [m[1], m[2]]; }
  if (!parts.length) return { term: 'เงินสด', clerk: '' };
  const clerkPart = parts.length && !PAY_WORD.test(parts[parts.length - 1]) ? parts[parts.length - 1] : '';
  const payParts = clerkPart ? parts.slice(0, -1) : parts;
  let term;
  if (payParts.some(p => /โอน|แนบสำเนา/.test(p))) term = 'โอน';
  else term = payParts.find(p => /เงินสด|เครดิต|เช็ค/.test(p)) || payParts[0] || 'เงินสด';
  return { term, clerk: clerkPart };
}

export function parseBills(text) {
  const rows = tokenize(text);
  const bills = []; const bad = []; let cur = null, expectSub = false, footer = null;
  for (let i = 0; i < rows.length; i++) {
    const { f, q } = rows[i];
    if (f.every(x => x === '')) continue;
    // header: unquoted bill no, quoted dd/mm/yyyy
    if (f.length >= 6 && !q[0] && /^\d+$/.test(f[0]) && beDate(f[1])) {
      cur = { no: f[0], date: beDate(f[1]), customerId: f[2], customerName: f[3].replace(/\s+/g, ' ').trim(), headerAmount: money(f[5]), items: [], phone: '', termRaw: '', row: i + 1 };
      bills.push(cur); expectSub = true; continue;
    }
    if (f[0] === 'รวมทั้งสิ้น') { footer = { page: money(f[1]), grand: money(f[2]) }; continue; }
    if (f.length === 2 && cur && expectSub) { cur.phone = f[0]; cur.termRaw = f[1]; expectSub = false; continue; }
    if (f.length === 5 && cur && q[0] && Number.isFinite(money(f[2])) && Number.isFinite(money(f[4]))) {
      cur.items.push({ code: f[0], name: f[1], qty: money(f[2]), price: money(f[3]), amount: money(f[4]) }); continue;
    }
    if (f.length >= 3 && f[0] === 'ใบส่งของ') continue;             // column titles
    if (i < 4 && f.length <= 3) continue;                            // report title lines
    if (f.length === 3 && f[1] === 'พนักงานขาย :') continue;
    bad.push({ row: i + 1, text: f.join(' | ').slice(0, 120) });
  }
  return { kind: 'bills', bills, footer, bad, rowsRead: rows.length };
}

// ---- convert a TTX bill into CRM rows (rules verified against the real sheet) ----
// * VAT_IN = bill carries item 0014 "ขอใบกำกับภาษี" (kept as an item); VAT_OUT = bill carries the 0015 VAT line.
// * VAT line (code 0015 "ภาษีมูลค่าเพิ่ม") is NOT stored as an item; the bill gets vatMode VAT_OUT and the
//   sales total stays SUM(items.amount) - VAT is never added again.
// * header amount may disagree with items (flag only): items win.
export function toCrmBill(b, { source, salesperson = 'อาร์ต' } = {}) {
  const { term, clerk } = splitTermClerk(b.termRaw);
  const vat = b.items.filter(isVatLine);
  const items = b.items.filter(it => !isVatLine(it));
  return {
    bill: { no: b.no, date: b.date, customerId: b.customerId, customerNameOverride: '', paymentTerm: term, openedBy: clerk, salesperson, vatMode: vat.length ? 'VAT_OUT' : items.some(i => i.code === '0014') ? 'VAT_IN' : 'NONE', source },
    items: items.map((it, i) => ({ billNo: b.no, line: String(i + 1), code: it.code, name: it.name, qty: String(it.qty), price: String(it.price), amount: String(it.amount) })),
    vatAmount: vat.reduce((s, x) => s + x.amount, 0),
  };
}

export function parseCustomers(text) {
  const rows = tokenize(text);
  const out = []; const bad = []; let cur = null, mode = '';
  for (let i = 0; i < rows.length; i++) {
    const { f, q } = rows[i];
    if (f.every(x => x === '') && !(f.length === 1 && cur && mode === 'addr' && q[0])) continue;
    if (f.length >= 4 && !q[0] && /^[\d,]+$/.test(f[0]) && q[1]) {
      cur = { seq: f[0], id: f[1], name: f[2].replace(/\s+/g, ' ').trim(), amount: money(f[3]), addr: [], phone: '', termRaw: '', row: i + 1 }; out.push(cur); mode = 'addr'; continue;
    }
    if (cur && f[0] === 'เบอร์ติดต่อ :') { cur.phone = f[1] || ''; mode = 'after'; continue; }
    if (cur && f[0] === 'การชำรเงิน :') { cur.termRaw = f[1] || ''; mode = 'after'; continue; }
    if (cur && mode === 'addr' && f.length === 1) { cur.addr.push(f[0]); continue; }
    if (f.length === 1 && !q[0] && /^[\d,.]+$/.test(f[0])) continue;   // grand total
    if (i < 8) continue;
    bad.push({ row: i + 1, text: f.join(' | ').slice(0, 120) });
  }
  return { kind: 'customers', customers: out, bad, rowsRead: rows.length };
}

// "โทร. 081-984-3833 คุณ เอ๋" -> phones ["081-984-3833"], contact "คุณ เอ๋" (text kept as written)
export function splitPhone(s) {
  const t = String(s || '').replace(/^\s*[*]?\s*(โทร|tel|t)\.?\s*/i, '').trim();
  const phones = [...t.matchAll(/(?:\+?66|0)[\d\- ]{7,12}\d/g)].map(m => m[0].replace(/\s+/g, ' ').trim());
  let rest = t; for (const p of phones) rest = rest.replace(p, ' ');
  rest = rest.replace(/[,]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { phones, contact: rest };
}

export function detectKind(text) {
  const head = text.slice(0, 600);
  if (/รายงานการขาย\s+แสดงรายละเอียดรายบิล/.test(head)) return 'bills';
  if (/รายงานการขายย้อนหลัง|รหัสลูกค้า/.test(head)) return 'customers';
  return '';
}

export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Compare parsed bills with the current model. Existing bill numbers are NEVER overwritten.
export function analyzeBills(m, parsed, { fileName = '', salesperson = 'อาร์ต' } = {}) {
  const flags = [], newBills = [], same = [], diff = [];
  const unknownCust = new Set(), codes = new Map();
  for (const b of parsed.bills) {
    const c = toCrmBill(b, { source: fileName, salesperson });
    const itemsTotal = c.items.reduce((s, i) => s + num(i.amount), 0);
    const hdr = b.headerAmount, expectHdr = itemsTotal + c.vatAmount;
    if (Number.isFinite(hdr) && Math.abs(hdr - expectHdr) > 0.01) flags.push({ entityType: 'bill', sourceKey: b.no, issueCode: 'HEADER_NE_ITEMS', severity: 'medium', sourceValue: `หัวบิล ${hdr} vs รายการ ${expectHdr}`, suggestedAction: 'ใช้ยอดรวมรายการ (bill_items.amount)' });
    if (!c.items.length) { flags.push({ entityType: 'bill', sourceKey: b.no, issueCode: 'BILL_NO_ITEMS', severity: 'medium', sourceValue: `หัวบิล ${hdr}`, suggestedAction: 'บิลไม่มีรายการสินค้า ไม่นำเข้า' }); continue; }
    const ex = m.billByNo.get(b.no);
    if (ex) {
      const t0 = m.billTotals.get(b.no) || 0;
      (Math.abs(t0 - itemsTotal) < 0.005 && ex.customerId === b.customerId ? same : diff).push({ b, total: itemsTotal, t0 });
    } else newBills.push(c);
    if (!m.custById.has(b.customerId)) unknownCust.add(b.customerId);
    for (const i of c.items) if (i.code && !m.prodByCode.has(i.code)) codes.set(i.code, (codes.get(i.code) || 0) + 1);
  }
  for (const { b, total, t0 } of diff) flags.push({ entityType: 'bill', sourceKey: b.no, issueCode: 'BILL_EXISTS_DIFFERENT', severity: 'medium', sourceValue: `ไฟล์ ${total}`, existingValue: `ฐาน ${t0}`, suggestedAction: 'ไม่เขียนทับ ตรวจสอบเอง' });
  for (const id of unknownCust) flags.push({ entityType: 'customer', sourceKey: id, issueCode: 'CUSTOMER_NOT_FOUND', severity: 'medium', sourceValue: id, suggestedAction: 'นำเข้ารายชื่อลูกค้าจาก TTX ก่อน' });
  for (const [code, n] of codes) flags.push({ entityType: 'product', sourceKey: code, issueCode: 'PRODUCT_NOT_IN_REGISTER', severity: 'low', sourceValue: `${n} บรรทัด`, suggestedAction: 'ตรวจกับทะเบียนสินค้า (รหัสเก่าไม่ได้แปลว่าผิด)' });
  return { newBills, same, diff, unknownCust: [...unknownCust], codes, flags, footer: parsed.footer, bad: parsed.bad, kind: 'bills' };
}

// Customers: existing ids are never modified. New customers are added with the TTX fields.
export function toCrmCustomer(c) {
  const { term, clerk } = splitTermClerk(c.termRaw);
  const { phones, contact } = splitPhone(c.phone);
  return {
    customer: { id: c.id, name: c.name, address: c.addr.map(s => s.trim()).filter(Boolean).join(' '), contactName: contact, paymentTerm: term, billClerk: clerk, activeFlag: '' },
    phones,
  };
}
export function analyzeCustomers(m, parsed) {
  const fresh = [], existing = [], flags = [];
  const seen = new Set();
  for (const c of parsed.customers) {
    if (!c.id || c.id === '000') continue;                           // blank / walk-in placeholder rows
    if (seen.has(c.id)) { flags.push({ entityType: 'customer', sourceKey: c.id, issueCode: 'DUP_IN_FILE', severity: 'medium', sourceValue: c.name, suggestedAction: 'รหัสซ้ำในไฟล์ ใช้แถวแรก' }); continue; }
    seen.add(c.id);
    if (m.custById.has(c.id)) existing.push(c); else fresh.push(toCrmCustomer(c));
  }
  return { fresh, existing, flags, bad: parsed.bad, kind: 'customers' };
}
export { dateOf };
