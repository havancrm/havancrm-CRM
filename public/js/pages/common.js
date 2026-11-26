import * as D from '../shared/domain.js';
import { esc, icon, sheet, fmtDate } from '../ui.js';

export const statusBadge = st => `<span class="badge ${st.status === 'current' ? 'ok' : st.status === 'closed' ? 'gray' : 'warn'}">${D.STATUS_TH[st.status]}</span>`;

export function custRow(m, c, { extra = '', sub } = {}) {
  const st = D.customerStats(m, c.id);
  const labels = D.custLabels(m, c.id).slice(0, 2).join(' · ');
  return `<div class="li" data-go="#/c/${encodeURIComponent(c.id)}"><div class="grow"><div class="t ell">${esc(c.name)}</div>
    <div class="s ell">${esc(c.id)}${labels ? ' · ' + esc(labels) : ''}${sub ? ' · ' + sub : ''}</div></div>
    <div class="r">${extra || statusBadge(st)}${!extra && st.lastDate ? `<div class="xs faint">${fmtDate(st.lastDate)}</div>` : ''}</div></div>`;
}

export const emptyMsg = t => `<div class="empty">${esc(t)}</div>`;

// bill lines (history view): billed name/qty/price/amount are kept exactly as stored.
export function billLinesHtml(m, no) {
  const lines = D.billLines(m, no);
  if (!lines.length) return `<div class="muted sm">บิลนี้ไม่มีรายการ</div>`;
  return `<div class="list">${lines.map(l => {
    const lg = !l.inRegistry ? D.resolveLegacy(m, l.code, l.name) : null;
    const note = !l.inRegistry ? `<span class="badge gray">ไม่อยู่ในทะเบียนปัจจุบัน</span>${lg?.ok ? ` <span class="badge">คู่เดิม ✓</span>` : ''}` : '';
    return `<div class="li" style="cursor:default"><div class="grow"><div class="t" style="font-weight:500">${esc(l.name)}</div>
      <div class="s">${l.inRegistry && l.code ? esc(l.code) + ' · ' : ''}${D.num(l.qty)} × ${D.money(l.price)} ${note}</div></div><div class="r num b">${D.money(l.amount)}</div></div>`;
  }).join('')}</div>`;
}

export function openBill(m, no, { reorder = true } = {}) {
  const b = m.billByNo.get(no);
  if (!b) return;
  const total = D.billTotal(m, no);
  const hasVat = (m.itemsByBill.get(no) || []).some(i => /vat|ภาษีมูลค่าเพิ่ม/i.test(i.name || ''));
  const s = sheet(`<div class="row between"><h3 style="margin:0">บิล ${esc(no)}</h3><button class="btn ghost sm" data-close>ปิด</button></div>
    <div class="muted sm" style="margin:6px 0 10px">${fmtDate(b.date)} · <a href="#/c/${encodeURIComponent(b.customerId)}" data-close>${esc(b.customerNameOverride || D.custName(m, b.customerId))}</a><br>
    ${esc(b.paymentTerm || '')}${b.openedBy ? ' · เสมียน ' + esc(b.openedBy) : ''}${b.salesperson ? ' · ขาย ' + esc(b.salesperson) : ''}</div>
    ${billLinesHtml(m, no)}
    <div class="row between" style="margin-top:12px"><span class="b">ยอดรวม</span><span class="b num" style="font-size:18px">${D.money(total)}</span></div>
    <div class="xs faint" style="margin-top:4px">ยอดรวมจากผลรวมรายการในบิล${hasVat ? ' (บิลนี้มีรายการภาษีอยู่แล้ว ไม่คิดซ้ำ)' : b.vatMode && b.vatMode !== 'NONE' ? ` · โหมดภาษี ${esc(b.vatMode)} (ไม่คิดซ้ำ)` : ''}</div>
    ${reorder ? `<a class="btn grad block" style="margin-top:12px" href="#/order/new?c=${encodeURIComponent(b.customerId)}&from=${encodeURIComponent(no)}" data-close>${icon('cart')} สั่งซ้ำจากบิลนี้</a>` : ''}`);
  return s;
}

export function openProduct(m, code) {
  const p = m.prodByCode.get(code);
  const buyers = new Map(); let bills = 0, qty = 0;
  for (const [no, items] of m.itemsByBill) {
    const hit = items.filter(i => i.code === code); if (!hit.length) continue;
    const b = m.billByNo.get(no); bills++; hit.forEach(i => { qty += D.num(i.qty); });
    if (b) { const cur = buyers.get(b.customerId); if (!cur || b.date > cur) buyers.set(b.customerId, b.date); }
  }
  const top = [...buyers.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 15);
  sheet(`<div class="row between"><h3 style="margin:0">${esc(p?.name || code)}</h3><button class="btn ghost sm" data-close>ปิด</button></div>
    <div class="muted sm" style="margin:6px 0 10px">รหัส ${esc(code)} · ${p ? 'อยู่ในทะเบียนปัจจุบัน' : 'ไม่อยู่ในทะเบียนปัจจุบัน (ประวัติบิล)'}<br>ขายแล้ว ${bills} บิล · ${D.money(qty)} หน่วย</div>
    <div class="sec">ลูกค้าที่ซื้อล่าสุด</div><div class="list">${top.map(([id, d]) => `<a class="li" href="#/c/${encodeURIComponent(id)}" data-close style="color:inherit"><div class="grow ell">${esc(D.custName(m, id))}</div><div class="xs faint">${fmtDate(d)}</div></a>`).join('') || '<div class="empty">ยังไม่มีผู้ซื้อ</div>'}</div>`);
}

export function pager(items, render, { size = 50, id = 'pg' } = {}) {
  // returns html for first page + a "show more" button that the caller wires with bindPager()
  return `<div id="${id}-list">${items.slice(0, size).map(render).join('')}</div>${items.length > size ? `<button class="btn line block" style="margin-top:10px" id="${id}-more">แสดงเพิ่ม (${items.length - size})</button>` : ''}`;
}
export function bindPager(root, items, render, { size = 50, id = 'pg' } = {}) {
  let shown = size; const btn = root.querySelector(`#${id}-more`); if (!btn) return;
  btn.onclick = () => { const next = items.slice(shown, shown + size); shown += size; root.querySelector(`#${id}-list`).insertAdjacentHTML('beforeend', next.map(render).join('')); if (shown >= items.length) btn.remove(); else btn.textContent = `แสดงเพิ่ม (${items.length - shown})`; };
}
