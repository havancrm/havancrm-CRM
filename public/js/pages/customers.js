import * as D from '../shared/domain.js';
import { esc, icon, debounce } from '../ui.js';
import { custRow, pager, bindPager, emptyMsg } from './common.js';
import { newCustomerSheet } from './forms.js';

const FILTERS = [['all', 'ทั้งหมด'], ['current', 'ปัจจุบัน'], ['lapsed', 'ห่างหาย'], ['closed', 'เลิกกิจการ'], ['new', 'ใหม่'], ['temp', 'ยังไม่มีรหัสบัญชี']];

export default function customers({ m, query }) {
  const label = query.label || '', q = query.q || '';
  const f0 = query.f || 'all';
  const html = `<div class="stack">
    <button class="btn grad block" id="addc">${icon('plus')} เพิ่มร้านใหม่</button>
    <label class="search">${icon('search')}<input id="cq" type="search" value="${esc(q)}" placeholder="ค้นหาลูกค้า ชื่อ รหัส เบอร์ ป้ายกำกับ" autocomplete="off"></label>
    <div class="chips">${FILTERS.map(([k, t]) => `<button class="chip ${f0 === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
    ${label ? `<div class="row"><span class="badge">ป้าย: ${esc(label)}</span><button class="btn ghost sm" id="clr">ล้างป้าย</button></div>` : ''}
    <div class="muted sm" id="cnt"></div><div id="clist"></div></div>`;
  return {
    html, title: 'ลูกค้า',
    after(root) {
      const inp = root.querySelector('#cq'), list = root.querySelector('#clist'), cnt = root.querySelector('#cnt');
      const upd = (patch) => { const nq = { ...query, ...patch }; for (const k of Object.keys(nq)) if (!nq[k] || (k === 'f' && nq[k] === 'all')) delete nq[k]; history.replaceState(null, '', '#/customers' + (Object.keys(nq).length ? '?' + new URLSearchParams(nq) : '')); Object.assign(query, patch); };
      const draw = () => {
        const term = inp.value.trim();
        let rows = term ? D.searchCustomers(m, term, 400) : m.customers;
        const f = query.f || 'all';
        const keep = new Set(D.customersBy(m, f).map(c => c.id));
        rows = rows.filter(c => keep.has(c.id));
        if (label) rows = rows.filter(c => D.custLabels(m, c.id).includes(label));
        if (!term) rows = [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name), 'th'));
        cnt.textContent = `${rows.length} ร้าน`;
        list.innerHTML = rows.length ? `<div class="list">${pager(rows, c => custRow(m, c), { id: 'cl' })}</div>` : emptyMsg('ไม่พบลูกค้า');
        bindPager(list, rows, c => custRow(m, c), { id: 'cl' });
      };
      draw();
      root.querySelector('#addc').onclick = () => newCustomerSheet();
      inp.addEventListener('input', debounce(() => { upd({ q: inp.value.trim() }); draw(); }));
      root.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { upd({ f: b.dataset.f }); root.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
      root.querySelector('#clr')?.addEventListener('click', () => { location.hash = '#/customers' + ((query.f || 'all') !== 'all' ? `?f=${query.f}` : ''); });
    },
  };
}
