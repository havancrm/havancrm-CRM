import * as D from '../shared/domain.js';
import { esc, icon, fmtDate, debounce } from '../ui.js';
import { custRow, emptyMsg, pager, bindPager } from './common.js';

export default function newcustomers({ m }) {
  const rows = D.customersBy(m, 'new').sort((a, b) => (D.customerStats(m, b.id).firstDate > D.customerStats(m, a.id).firstDate ? 1 : -1));
  const html = `<div class="stack"><div class="muted sm">ลูกค้าที่ซื้อครั้งแรกภายใน ${m.settings.newDays} วันที่ผ่านมา (ปรับได้ในตั้งค่า) · ${rows.length} ร้าน</div>
    <label class="search">${icon('search')}<input id="nq" type="search" placeholder="ค้นหาลูกค้าใหม่" autocomplete="off"></label><div id="nl"></div></div>`;
  return {
    html, title: 'ลูกค้าใหม่',
    after(root) {
      const inp = root.querySelector('#nq'), box = root.querySelector('#nl');
      const row = c => { const st = D.customerStats(m, c.id); return custRow(m, c, { extra: `<span class="badge">ซื้อแรก ${fmtDate(st.firstDate)}</span>`, sub: `${st.bills} บิล · ${D.money(st.total)} ฿` }); };
      const draw = () => {
        const t = D.normText(inp.value);
        const r = t ? rows.filter(c => D.normText(c.name).includes(t) || c.id === inp.value.trim() || D.custPhones(m, c.id).some(p => D.digits(p).includes(D.digits(inp.value)) && D.digits(inp.value).length >= 3)) : rows;
        box.innerHTML = r.length ? `<div class="list">${pager(r, row, { id: 'nc' })}</div>` : emptyMsg('ไม่พบลูกค้าใหม่');
        bindPager(box, r, row, { id: 'nc' });
      };
      draw(); inp.addEventListener('input', debounce(draw));
    },
  };
}
