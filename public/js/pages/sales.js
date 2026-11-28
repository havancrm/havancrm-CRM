// Sales report. Totals = SUM(bill_items.amount); VAT is never recomputed. No charts: tables only.
import * as D from '../shared/domain.js';
import { esc, icon, fmtDate, monthLabel, debounce } from '../ui.js';
import { custRow, emptyMsg, pager, bindPager, openBill } from './common.js';

const PERIODS = [['today', 'วันนี้'], ['7d', '7 วัน'], ['month', 'เดือนนี้'], ['lastmonth', 'เดือนก่อน'], ['year', 'ปีนี้'], ['all', 'ทั้งหมด']];

export default function sales({ m, query }) {
  const p = PERIODS.some(x => x[0] === query.p) ? query.p : 'month';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.mo || query.q || '') ? (query.mo || query.q) : '';
  const [from, to] = month ? [month + '-01', month + '-31'] : D.periodRange(p, m.today);
  const r = D.salesBetween(m, from, to);
  const view = ['month', 'clerk', 'cust', 'bills'].includes(query.v) ? query.v : 'month';
  const avg = r.billCount ? r.total / r.billCount : 0;
  const months = [...r.byMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const clerks = [...r.byClerk.entries()].sort((a, b) => b[1] - a[1]);
  const sellers = [...r.bySales.entries()].sort((a, b) => b[1] - a[1]);
  const custs = [...r.byCust.entries()].sort((a, b) => b[1] - a[1]);
  const bills = [...r.bills].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.no < b.no ? 1 : -1));
  const kv = (t, v, go) => `<button class="card soft" ${go ? `data-v="${go}"` : 'disabled'} style="text-align:center;min-width:0;border:0;cursor:pointer"><div class="xs muted">${t}</div><div class="b num" style="font-size:16px">${v}</div></button>`;
  const html = `<div class="stack">
    <div class="chips">${PERIODS.map(([k, t]) => `<button class="chip ${!month && p === k ? 'on' : ''}" data-p="${k}">${t}</button>`).join('')}</div>
    <div class="hero" style="margin:0;border-radius:14px"><div class="sm" style="opacity:.8">ยอดขายรวม ${from ? fmtDate(from) + ' – ' + fmtDate(to) : 'ทั้งหมด'}</div><div class="num" style="font-size:30px;font-weight:700">${D.money(r.total)} <span style="font-size:15px">฿</span></div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">${kv('จำนวนบิล', D.money(r.billCount), 'bills')}${kv('เฉลี่ย/บิล', D.money(avg), '')}${kv('ลูกค้า', custs.length, 'cust')}</div>
    <div class="xs faint">ยอดขายคำนวณจากผลรวมรายการในบิล (bill_items.amount) ของฐาน CRM เท่านั้น ไม่บวกภาษีเพิ่ม ถ้ายอดต่างจากระบบเดิมให้ยึดฐาน CRM</div>
    <div class="seg">${[['month', 'รายเดือน'], ['clerk', 'เสมียน/ขาย'], ['cust', 'ลูกค้า'], ['bills', 'บิล']].map(([k, t]) => `<button data-v="${k}" class="${view === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <label class="search">${icon('search')}<input id="sq" type="search" placeholder="${view === 'bills' ? 'ค้นหาเลขบิล/ชื่อลูกค้า' : view === 'cust' ? 'ค้นหาลูกค้า' : view === 'month' ? 'ค้นหาเดือน (เช่น 2026-10)' : 'ค้นหาชื่อเสมียน/พนักงาน'}" autocomplete="off"></label>
    <div id="sl"></div></div>`;
  return {
    html, title: 'รายงานยอดขาย',
    after(root) {
      const nav = patch => { const q = { p, v: view, ...(month && !patch.p ? { mo: month } : {}), ...patch }; location.hash = `#/sales?${new URLSearchParams(q)}`; };
      root.querySelectorAll('[data-p]').forEach(b => b.onclick = () => nav({ p: b.dataset.p }));
      root.querySelectorAll('[data-v]').forEach(b => b.onclick = () => nav({ v: b.dataset.v }));
      const box = root.querySelector('#sl'), inp = root.querySelector('#sq');
      const draw = () => {
        const t = D.normText(inp?.value || '');
        if (view === 'month') { const mr = months.filter(([mo]) => !t || mo.includes(inp.value.trim()) || D.normText(monthLabel(mo)).includes(t)); box.innerHTML = mr.length ? `<div class="list">${mr.map(([mo, v]) => `<div class="li" data-mo="${mo}"><div class="grow t">${monthLabel(mo)}</div><div class="r b num">${D.money(v)}</div></div>`).join('')}</div>` : emptyMsg('ไม่มียอดขายในช่วงนี้'); }
        else if (view === 'clerk') {
          const grp = (title, arr) => { const a = arr.filter(([k]) => !t || D.normText(k).includes(t)); return a.length ? `<div class="sec">${title}</div><div class="list">${a.map(([k, v]) => `<div class="li" style="cursor:default"><div class="grow t">${esc(k)}</div><div class="r"><div class="b num">${D.money(v)}</div><div class="xs faint">${r.total ? (v / r.total * 100).toFixed(1) : 0}%</div></div></div>`).join('')}</div>` : ''; };
          box.innerHTML = (grp('เสมียนที่เปิดบิล', clerks) + grp('พนักงานขาย', sellers)) || emptyMsg('ไม่มีข้อมูล');
        }
        else if (view === 'cust') {
          const rows = custs.filter(([id]) => !t || D.normText(D.custName(m, id)).includes(t) || id === inp.value.trim());
          const row = ([id, v]) => custRow(m, m.custById.get(id) || { id, name: D.custName(m, id) }, { extra: `<span class="b num">${D.money(v)}</span>` });
          box.innerHTML = rows.length ? `<div class="list">${pager(rows, row, { id: 'sc' })}</div>` : emptyMsg('ไม่พบ'); bindPager(box, rows, row, { id: 'sc' });
        } else {
          const rows = bills.filter(b => !t || b.no.includes(inp.value.trim()) || D.normText(D.custName(m, b.customerId)).includes(t));
          const row = b => `<div class="li" data-bill="${esc(b.no)}"><div class="grow"><div class="t ell">${esc(D.custName(m, b.customerId))}</div><div class="s">${esc(b.no)} · ${fmtDate(b.date)}</div></div><div class="r b num">${D.money(D.billTotal(m, b.no))}</div></div>`;
          box.innerHTML = rows.length ? `<div class="list">${pager(rows, row, { id: 'sb' })}</div>` : emptyMsg('ไม่พบบิล'); bindPager(box, rows, row, { id: 'sb' });
        }
      };
      draw();
      inp?.addEventListener('input', debounce(draw));
      box.addEventListener('click', e => {
        const b = e.target.closest('[data-bill]'); if (b) openBill(m, b.dataset.bill);
        const mo = e.target.closest('[data-mo]'); if (mo) { const [y, mm] = mo.dataset.mo.split('-'); location.hash = `#/sales?p=all&v=bills&mo=${y}-${mm}`; }
      });
    },
  };
}
