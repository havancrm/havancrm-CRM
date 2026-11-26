import * as D from '../shared/domain.js';
import { esc, icon, fmtDate, debounce, sheet } from '../ui.js';
import { custRow, emptyMsg, pager, bindPager } from './common.js';

const ST = { 'ร่าง': ['ร่าง', 'warn'], 'รอส่ง': ['รอส่ง', 'warn'], 'ส่งแล้ว': ['ส่งแล้ว', 'ok'], 'ยกเลิก': ['ยกเลิก', 'gray'] };

export function pickCustomerSheet(m, onPick) {
  const s = sheet(`<div class="row between"><h3 style="margin:0">เลือกลูกค้า</h3><button class="btn ghost sm" data-close>ปิด</button></div>
    <label class="search" style="margin:12px 0">${icon('search')}<input id="pc" type="search" placeholder="ค้นหาชื่อร้าน รหัส เบอร์" autocomplete="off"></label><div id="pl" class="list"></div>`);
  const inp = s.el.querySelector('#pc'), list = s.el.querySelector('#pl');
  const draw = () => {
    const rows = inp.value.trim() ? D.searchCustomers(m, inp.value, 30) : [...m.customers].filter(c => D.customerStats(m, c.id).status === 'current').sort((a, b) => (D.customerStats(m, b.id).lastDate > D.customerStats(m, a.id).lastDate ? 1 : -1)).slice(0, 20);
    list.innerHTML = rows.map(c => `<div class="li" data-id="${esc(c.id)}"><div class="grow"><div class="t ell">${esc(c.name)}</div><div class="s">${esc(c.id)}</div></div></div>`).join('') || emptyMsg('ไม่พบลูกค้า');
  };
  draw(); inp.addEventListener('input', debounce(draw)); setTimeout(() => inp.focus(), 50);
  list.onclick = e => { const r = e.target.closest('[data-id]'); if (r) { s.close(); onPick(r.dataset.id); } };
}

export default function orders({ m, query }) {
  const f = query.f || 'all', q = query.q || '';
  const all = [...m.orders].sort((a, b) => (String(b.updatedAt) > String(a.updatedAt) ? 1 : -1));
  const counts = { all: all.length, 'ร่าง': 0, 'รอส่ง': 0, 'ส่งแล้ว': 0, 'ยกเลิก': 0 };
  for (const o of all) counts[o.status] = (counts[o.status] || 0) + 1;
  const html = `<div class="stack"><button class="btn grad block" id="no">${icon('plus')} ออเดอร์ใหม่</button>
    <label class="search">${icon('search')}<input id="oq" type="search" value="${esc(q)}" placeholder="ค้นหาเลขที่ออเดอร์ ชื่อ/รหัสลูกค้า" autocomplete="off"></label>
    <div class="chips">${[['all', 'ทั้งหมด'], ['ร่าง', 'ร่าง'], ['รอส่ง', 'รอส่ง'], ['ส่งแล้ว', 'ส่งแล้ว'], ['ยกเลิก', 'ยกเลิก']].map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-f="${k}">${t} ${counts[k] || 0}</button>`).join('')}</div>
    <div id="ol"></div></div>`;
  return {
    html, title: 'ออเดอร์',
    after(root) {
      const inp = root.querySelector('#oq'), list = root.querySelector('#ol');
      const rowFor = o => {
        const items = m.orderItems.get(o.no) || [], total = items.reduce((s, i) => s + D.num(i.amount), 0);
        const [t, cls] = ST[o.status] || [o.status, 'gray'];
        return `<div class="li" data-go="#/order/${encodeURIComponent(o.no)}"><div class="grow"><div class="t ell">${esc(o.customerNameOverride || D.custName(m, o.customerId))}</div><div class="s ell">${esc(o.no)} · ${fmtDate(o.date)} · ${items.length} รายการ</div></div><div class="r"><div class="b num">${D.money(total)}</div><span class="badge ${cls}">${t}</span></div></div>`;
      };
      const draw = () => {
        const t = D.normText(inp.value);
        const rows = all.filter(o => (f === 'all' || o.status === f) && (!t || D.normText(o.no).includes(t) || D.normText(D.custName(m, o.customerId)).includes(t) || o.customerId === inp.value.trim()));
        list.innerHTML = rows.length ? `<div class="list">${pager(rows, rowFor, { id: 'ol2' })}</div>` : emptyMsg('ยังไม่มีออเดอร์');
        bindPager(list, rows, rowFor, { id: 'ol2' });
      };
      draw();
      inp.addEventListener('input', debounce(draw));
      root.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { location.hash = `#/orders?f=${encodeURIComponent(b.dataset.f)}`; });
      const start = () => pickCustomerSheet(m, id => { location.hash = `#/order/new?c=${encodeURIComponent(id)}`; });
      root.querySelector('#no').onclick = start;
      if (query.new) { history.replaceState(null, '', '#/orders'); start(); }
    },
  };
}
