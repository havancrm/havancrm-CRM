// "ลูกค้าใหม่" = two different groups, never mixed:
//   ซื้อครั้งแรก      : first purchase (from bills) within N days
//   เพิ่งเพิ่มทะเบียน : added to the register within N days (activity "เพิ่มลูกค้า"), bought or not
import * as D from '../shared/domain.js';
import { esc, icon, fmtDate, debounce } from '../ui.js';
import { custRow, emptyMsg, pager, bindPager } from './common.js';
import { newCustomerSheet } from './forms.js';

export default function newcustomers({ m, query }) {
  const tab = query.t === 'reg' ? 'reg' : 'first';
  const first = m.customers.filter(c => D.isFirstPurchaseNew(m, c)).sort((a, b) => (D.customerStats(m, b.id).firstDate > D.customerStats(m, a.id).firstDate ? 1 : -1));
  const reg = m.customers.filter(c => D.isRecentlyRegistered(m, c)).sort((a, b) => (D.registeredAt(m, b.id) > D.registeredAt(m, a.id) ? 1 : -1));
  const rows = tab === 'first' ? first : reg;
  const both = new Set(first.map(c => c.id).filter(id => reg.some(c => c.id === id)));
  const range = m.settings.newDays > 0 ? `ในช่วง ${m.settings.newDays} วันล่าสุด` : 'เดือนนี้';
  const html = `<div class="stack">
    <div class="seg"><button data-t="first" class="${tab === 'first' ? 'on' : ''}">ซื้อครั้งแรก ${first.length}</button><button data-t="reg" class="${tab === 'reg' ? 'on' : ''}">เพิ่มทะเบียน ${reg.length}</button></div>
    <div class="muted sm">${tab === 'first' ? `ร้านที่ <b>ซื้อครั้งแรก</b> ${range} (นับจากบิลจริง)` : `ร้านที่ <b>เพิ่งเพิ่มเข้าทะเบียน</b> ${range} (ยังไม่ซื้อก็แสดง) · ${reg.filter(c => D.isTempId(c.id)).length} ร้านยังไม่มีรหัสบัญชี`}</div>
    ${tab === 'reg' ? `<button class="btn grad block" id="addc">${icon('plus')} เพิ่มร้านใหม่</button>` : ''}
    <label class="search">${icon('search')}<input id="nq" type="search" placeholder="ค้นหาร้าน ชื่อ รหัส เบอร์" autocomplete="off"></label><div id="nl"></div></div>`;
  return {
    html, title: 'ลูกค้าใหม่',
    after(root) {
      root.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { location.hash = `#/new?t=${b.dataset.t}`; });
      root.querySelector('#addc')?.addEventListener('click', () => newCustomerSheet());
      const inp = root.querySelector('#nq'), box = root.querySelector('#nl');
      const row = c => {
        const st = D.customerStats(m, c.id);
        const extra = tab === 'first' ? `<span class="badge">ซื้อแรก ${fmtDate(st.firstDate)}</span>` : `<span class="badge gray">เพิ่ม ${fmtDate(D.registeredAt(m, c.id))}</span>`;
        const sub = tab === 'first' ? `${st.bills} บิล · ${D.money(st.total)} ฿${both.has(c.id) ? ' · เพิ่งเพิ่มทะเบียนด้วย' : ''}` : (st.bills ? `ซื้อแล้ว ${st.bills} บิล` : 'ยังไม่ซื้อ');
        return custRow(m, c, { extra, sub });
      };
      const draw = () => {
        const ids = new Set(rows.map(c => c.id));
        const r = D.normText(inp.value) ? D.searchCustomers(m, inp.value, Infinity).filter(c => ids.has(c.id)) : rows;
        box.innerHTML = r.length ? `<div class="list">${pager(r, row, { id: 'nc' })}</div>` : emptyMsg(tab === 'first' ? 'ไม่มีร้านที่ซื้อครั้งแรกในช่วงนี้' : 'ไม่มีร้านที่เพิ่งเพิ่มทะเบียน');
        bindPager(box, r, row, { id: 'nc' });
      };
      draw(); inp.addEventListener('input', debounce(draw));
    },
  };
}
