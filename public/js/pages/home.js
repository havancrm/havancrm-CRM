import * as D from '../shared/domain.js';
import { esc, icon, debounce, fmtDate } from '../ui.js';
import { statusBadge, custRow, openBill, openProduct } from './common.js';

export default function home({ m }) {
  const k = D.customerCounts(m);
  const [from, to] = D.periodRange('month', m.today);
  const sales = D.salesBetween(m, from, to);
  const sug = D.suggestions(m);
  const newC = D.customersBy(m, 'new').length;
  const withGps = m.customers.filter(D.hasGps).length;
  const labelCounts = new Map();
  for (const rows of m.labels.values()) for (const r of rows) if (r.label) labelCounts.set(r.label, (labelCounts.get(r.label) || 0) + 1);
  const labels = [...labelCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th'));
  const tile = (go, ic, t, s) => `<button class="tile" data-go="${go}">${icon(ic)}<div class="grow"><div class="t">${t}</div><div class="s ell">${s}</div></div></button>`;
  const html = `<div class="stack">
    <label class="search">${icon('search')}<input id="hs" type="search" placeholder="ค้นหา ร้าน รหัส เบอร์ ป้าย สินค้า บิล" autocomplete="off" enterkeyhint="search"></label>
    <div id="hres"></div>
    <div class="mini4" id="mini">
      <button class="mini" data-go="#/customers?f=all"><b>${k.all}</b><span>ลูกค้าทั้งหมด</span></button>
      <button class="mini" data-go="#/customers?f=current"><b>${k.current}</b><span>ปัจจุบัน</span></button>
      <button class="mini" data-go="#/customers?f=lapsed"><b>${k.lapsed}</b><span>ห่างหาย</span></button>
      <button class="mini" data-go="#/customers?f=closed"><b>${k.closed}</b><span>เลิกกิจการ</span></button>
    </div>
    <div class="tiles">
      ${tile('#/sales', 'report', 'รายงานยอดขาย', `เดือนนี้ ${D.money(sales.total)} ฿`)}
      ${tile('#/new', 'star', 'ลูกค้าใหม่', `${newC} ร้าน`)}
      ${tile('#/visits?tab=cycle', 'clock', 'รอบลูกค้า', `เลยรอบ ${sug.overdue.length} · ใกล้ ${sug.soon.length}`)}
      ${tile('#/orders?new=1', 'cart', 'รับออเดอร์', 'เริ่มออเดอร์ใหม่')}
      ${tile('#/map', 'map', 'แผนที่', `มีพิกัด ${withGps} ร้าน`)}
      ${tile('#/visits?tab=cal', 'cal', 'ปฏิทินเข้าพบ', `ขาดเข้าพบ ${sug.missed.length}`)}
    </div>
    <div class="sec"><span>ป้ายกำกับ</span><span class="faint xs">${labels.length} ป้าย</span></div>
    ${labels.length ? `<div class="lbls">${labels.map(([l, n]) => `<button class="lbl" data-go="#/customers?label=${encodeURIComponent(l)}"><span>${esc(l)}</span><b>${n}</b></button>`).join('')}</div>` : '<div class="empty">ยังไม่มีป้ายกำกับ</div>'}
  </div>`;
  return {
    html, title: 'HAVAN CRM',
    after(root) {
      const inp = root.querySelector('#hs'), res = root.querySelector('#hres');
      const run = debounce(() => {
        const q = inp.value.trim();
        if (!q) { res.innerHTML = ''; return; }
        const r = D.smartSearch(m, q);
        const parts = [];
        if (r.customers.length) parts.push(`<div class="sec">ลูกค้า (${r.customers.length}${r.customers.length >= 30 ? '+' : ''})</div><div class="list">${r.customers.map(c => custRow(m, c)).join('')}</div>`);
        if (r.products.length) parts.push(`<div class="sec">สินค้า</div><div class="list">${r.products.map(p => `<div class="li" data-prod="${esc(p.code)}"><div class="grow ell">${esc(p.name)}</div><div class="r xs faint">${esc(p.code)}</div></div>`).join('')}</div>`);
        if (r.bills.length) parts.push(`<div class="sec">บิล</div><div class="list">${r.bills.map(b => `<div class="li" data-bill="${esc(b.no)}"><div class="grow ell">${esc(b.no)} · ${esc(D.custName(m, b.customerId))}</div><div class="r num">${D.money(D.billTotal(m, b.no))}</div></div>`).join('')}</div>`);
        res.innerHTML = parts.join('') || `<div class="empty">ไม่พบ “${esc(q)}”</div>`;
      });
      inp.addEventListener('input', run);
      res.addEventListener('click', e => {
        const p = e.target.closest('[data-prod]'); if (p) openProduct(m, p.dataset.prod);
        const b = e.target.closest('[data-bill]'); if (b) openBill(m, b.dataset.bill);
      });
    },
  };
}
