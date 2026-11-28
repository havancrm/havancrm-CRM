import * as D from '../shared/domain.js';
import { esc, icon } from '../ui.js';
import { custRow, openBill, openProduct } from './common.js';
import { newCustomerSheet } from './forms.js';

// Layout and order follow the aCRM home page: sales card -> search -> 4-stat card -> 4 action tiles -> label shortcuts.
export default function home({ m, query = {} }) {
  const k = D.customerCounts(m);
  const [from, to] = D.periodRange('month', m.today);
  const sales = D.salesBetween(m, from, to);
  const sug = D.suggestions(m);
  const due = sug.today.length + sug.over.length + sug.late.length;
  const labels = D.customerLabelCounts(m);
  const html = `
    <a class="inv" href="#/sales"><div><div class="t">ยอดขายเดือนนี้</div><div class="f6 num">${D.money(sales.total)} ฿</div></div><div class="ta-r t">${sales.billCount} บิล ›</div></a>
    <div class="sr">${icon('search')}<input id="hs" type="search" value="${esc(query.q || '')}" placeholder="ค้นหา ร้าน รหัส เบอร์ ป้าย สินค้า บิล" autocomplete="off" enterkeyhint="search"></div>
    <div id="hres" class="stack"></div>
    <div class="c hstat">
      <a data-go="#/customers?f=all"><b>${k.all}</b>ทั้งหมด</a>
      <a data-go="#/customers?f=current"><b>${k.current}</b>ปัจจุบัน</a>
      <a data-go="#/customers?f=lapsed"><b>${k.lapsed}</b>ห่างหาย</a>
      <a data-go="#/customers?f=closed"><b>${k.closed}</b>เลิกกิจการ</a>
    </div>
    <div class="g4 hacts">
      <button class="ab" id="addc">${icon('plus')}ลูกค้าใหม่</button>
      <a class="ab" href="#/follow">${icon('bell')}รอบลูกค้า${due ? `<em class="bdg">${due > 99 ? '99+' : due}</em>` : ''}</a>
      <a class="ab p" href="#/orders?new=1">${icon('cart')}รับออเดอร์</a>
      <a class="ab" href="#/map">${icon('map')}แผนที่</a>
    </div>
    <div class="c hlab"><div class="lh"><span>${icon('tag')} ป้ายกำกับ</span><span class="t">${labels.length} ป้าย</span></div>
      ${labels.length ? `<div class="lg">${labels.slice(0, 8).map(([l, n]) => `<button class="hlr" data-go="#/customers?label=${encodeURIComponent(l)}"><span>${esc(l)}</span><b>${n}</b></button>`).join('')}</div>` : '<div class="empty">ยังไม่มีป้ายกำกับ</div>'}
      ${labels.length ? `<a class="lf" href="#/customers?labels=1">ดูป้ายกำกับทั้งหมด (${labels.length}) ›</a>` : ''}
    </div>
    <a class="lk t" href="#/new" style="justify-content:center">รายงานลูกค้าใหม่ (ซื้อครั้งแรก/เพิ่มทะเบียน) ›</a>`;
  return {
    html, title: 'HAVAN CRM',
    after(root) {
      root.querySelector('#addc').onclick = () => newCustomerSheet();
      const inp = root.querySelector('#hs'), res = root.querySelector('#hres');
      const run = () => {
        const q = inp.value.trim();
        history.replaceState(null, '', '#/' + (q ? '?' + new URLSearchParams({q}) : ''));
        if (!q) { res.innerHTML = ''; return; }
        const r = D.smartSearch(m, q);
        const parts = [];
        if (r.customers.length) parts.push(`<div class="t">ลูกค้า (${r.customers.length}${r.customers.length >= 30 ? '+' : ''})</div>${r.customers.map(c => custRow(m, c)).join('')}<a class="btn line block" href="#/customers?q=${encodeURIComponent(q)}">ดูผลค้นหาลูกค้าทั้งหมด ›</a>`);
        if (r.products.length) parts.push(`<div class="t">สินค้า</div><div class="sc">${r.products.map(p => `<div class="li" data-prod="${esc(p.code)}"><div class="grow ell">${esc(p.name)}</div><div class="t">${esc(p.code)}</div></div>`).join('')}</div>`);
        if (r.bills.length) parts.push(`<div class="t">บิล</div><div class="sc">${r.bills.map(b => `<div class="li" data-bill="${esc(b.no)}"><div class="grow ell">${esc(b.no)} · ${esc(D.custName(m, b.customerId))}</div><div class="num">${D.money(D.billTotal(m, b.no))}</div></div>`).join('')}</div>`);
        res.innerHTML = parts.join('') || `<div class="empty">ไม่พบ “${esc(q)}”</div>`;
      };
      inp.addEventListener('input', run);
      if (inp.value) run();
      res.addEventListener('click', e => {
        const p = e.target.closest('[data-prod]'); if (p) openProduct(m, p.dataset.prod);
        const b = e.target.closest('[data-bill]'); if (b) openBill(m, b.dataset.bill);
      });
    },
  };
}
