import * as D from '../shared/domain.js';
import { esc, icon } from '../ui.js';
import { custRow, pager, bindPager, emptyMsg } from './common.js';
import { newCustomerSheet } from './forms.js';

const FILTERS = [['all', 'ทั้งหมด'], ['current', 'ปัจจุบัน'], ['lapsed', 'ห่างหาย'], ['closed', 'เลิกกิจการ'], ['new', 'ใหม่'], ['temp', 'ยังไม่มีรหัสบัญชี']];

export default function customers({ m, query }) {
  const label = query.label || '', q = query.q || '';
  const f0 = query.f || 'all';
  const cnt = D.customerCounts(m);
  const html = `<div class="stack">
    <div class="g4" id="kp">${FILTERS.slice(0, 4).map(([k, t]) => `<button class="kp ${f0 === k ? 'on' : ''}" data-f="${k}"><b>${cnt[k]}</b>${t}</button>`).join('')}</div>
    <div class="row"><div class="sr grow">${icon('search')}<input id="cq" type="search" value="${esc(q)}" placeholder="ค้นหาลูกค้า ชื่อ รหัส เบอร์ ป้ายกำกับ" autocomplete="off"></div><button class="btn sm" id="addc">${icon('plus')} ร้านใหม่</button></div>
    <div class="chips">${FILTERS.slice(4).map(([k, t]) => `<button class="chip ${f0 === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
    ${label ? `<div class="row"><span class="badge">ป้าย: ${esc(label)}</span><button class="btn ghost sm" id="clr">ล้างป้าย</button></div>` : ''}
    <div class="t" id="cnt"></div><div id="clist"></div></div>`;
  return {
    html, title: 'ลูกค้า',
    after(root) {
      const inp = root.querySelector('#cq'), list = root.querySelector('#clist'), cntEl = root.querySelector('#cnt');
      const upd = (patch) => { const nq = { ...query, ...patch }; for (const k of Object.keys(nq)) if (!nq[k] || (k === 'f' && nq[k] === 'all')) delete nq[k]; history.replaceState(null, '', '#/customers' + (Object.keys(nq).length ? '?' + new URLSearchParams(nq) : '')); Object.assign(query, patch); };
      const draw = () => {
        const term = inp.value.trim();
        let rows = term ? D.searchCustomers(m, term, m.customers.length) : m.customers;
        const f = query.f || 'all';
        const keep = new Set(D.customersBy(m, f).map(c => c.id));
        rows = rows.filter(c => keep.has(c.id));
        if (label) rows = rows.filter(c => D.custLabels(m, c.id).includes(label));
        if (!term) { const key = c => { const st = D.customerStats(m, c.id); return st.status === 'closed' ? 1e9 : st.eligible ? st.dueDiff : 1e8; }; rows = [...rows].sort((a, b) => key(a) - key(b) || String(a.name).localeCompare(String(b.name), 'th')); }
        cntEl.textContent = `${rows.length} ร้าน${term ? '' : ' · เรียงตามความเร่งด่วน'}`;
        list.innerHTML = rows.length ? `<div class="stack">${pager(rows, c => custRow(m, c), { id: 'cl' })}</div>` : emptyMsg('ไม่พบลูกค้า');
        bindPager(list, rows, c => custRow(m, c), { id: 'cl' });
      };
      draw();
      root.querySelector('#addc').onclick = () => newCustomerSheet();
      inp.addEventListener('input', () => { upd({ q: inp.value.trim() }); draw(); });
      root.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { upd({ f: b.dataset.f }); root.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x.dataset.f === b.dataset.f)); draw(); });
      root.querySelector('#clr')?.addEventListener('click', () => { const next = new URLSearchParams(); if ((query.f || 'all') !== 'all') next.set('f', query.f); if (inp.value.trim()) next.set('q', inp.value.trim()); location.hash = '#/customers' + (next.size ? '?' + next : ''); });
    },
  };
}
