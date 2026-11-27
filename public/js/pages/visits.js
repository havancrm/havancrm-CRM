import * as D from '../shared/domain.js';
import { esc, icon, fmtDate, monthLabel, MONTHS } from '../ui.js';
import { custRow, emptyMsg, pager, bindPager } from './common.js';
import { visitSheet } from './forms.js';

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const GROUPS = [['overdue', 'เลยรอบซื้อ', 'bad'], ['soon', 'ใกล้ถึงรอบซื้อ', 'warn'], ['missed', 'ขาดเข้าพบ', '']];

export default function visits({ m, query }) {
  const tab = query.tab === 'cal' ? 'cal' : 'cycle';
  const html = `<div class="stack"><div class="seg"><button data-t="cycle" class="${tab === 'cycle' ? 'on' : ''}">รอบลูกค้า</button><button data-t="cal" class="${tab === 'cal' ? 'on' : ''}">ปฏิทิน</button></div><div id="vb"></div></div>`;
  return {
    html, title: 'เข้าพบ',
    after(root) {
      root.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { location.hash = `#/visits?tab=${b.dataset.t}`; });
      const box = root.querySelector('#vb');
      if (tab === 'cycle') cycle(m, box, query); else calendar(m, box, query);
    },
  };
}

function cycle(m, box, query) {
  const sug = D.suggestions(m);
  const g = query.g && sug[query.g] ? query.g : 'overdue';
  const rowFor = x => {
    const st = x.st;
    const info = g === 'overdue' ? `<span class="badge bad">เลย ${x.days} วัน</span>` : g === 'soon' ? `<span class="badge warn">อีก ${x.days} วัน</span>` : `<span class="badge gray">${st.daysSinceVisit === null ? 'ยังไม่เคยเข้าพบ' : st.daysSinceVisit + ' วันที่แล้ว'}</span>`;
    return custRow(m, x.c, { extra: info, sub: g === 'missed' ? `ซื้อล่าสุด ${fmtDate(st.lastDate)}` : `รอบ ${st.cycle} วัน · ซื้อล่าสุด ${fmtDate(st.lastDate)}` });
  };
  const term = D.normText(query.cq || '');
  const rows = sug[g].filter(x => !term || D.normText(x.c.name).includes(term) || x.c.id === String(query.cq).trim());
  box.innerHTML = `<label class="search" style="margin-top:12px">${icon('search')}<input id="cq" type="search" value="${esc(query.cq || '')}" placeholder="ค้นหาลูกค้าในรายการ" autocomplete="off"></label><div class="chips" style="margin:12px 0">${GROUPS.map(([k, t]) => `<button class="chip ${g === k ? 'on' : ''}" data-g="${k}">${t} ${sug[k].length}</button>`).join('')}</div>
    <div class="muted xs" style="margin-bottom:6px">คำนวณจากประวัติซื้อจริง (รอบ = ค่ากลางของระยะห่างระหว่างวันที่ซื้อ ต้องมีอย่างน้อย ${m.settings.minCycleBills} ครั้ง) · ขาดเข้าพบ = ลูกค้าปัจจุบันที่ไม่ได้เข้าพบเกิน ${m.settings.visitDef} วัน</div>
    ${rows.length ? `<div class="list">${pager(rows, rowFor, { id: 'cy' })}</div>` : emptyMsg('ไม่มีรายการ')}`;
  bindPager(box, rows, rowFor, { id: 'cy' });
  box.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { history.replaceState(null, '', `#/visits?tab=cycle&g=${b.dataset.g}`); query.g = b.dataset.g; cycle(m, box, query); });
  const cq = box.querySelector('#cq'); let tm;
  cq.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { query.cq = cq.value; cycle(m, box, query); const n = box.querySelector('#cq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200); });
}

function calendar(m, box, query) {
  let ym = /^\d{4}-\d{2}$/.test(query.ym || '') ? query.ym : m.today.slice(0, 7);
  let sel = query.d && query.d.startsWith(ym) ? query.d : (m.today.startsWith(ym) ? m.today : '');
  let mode = query.v === 'day' || query.v === 'month' ? query.v : (() => { try { return localStorage.getItem('calMode') === 'day' ? 'day' : 'month'; } catch { return 'month'; } })();
  const setMode = v => { mode = v; try { localStorage.setItem('calMode', v); } catch {} draw(); };
  const modeBar = () => `<div class="seg" style="margin-top:12px"><button data-vm="month" class="${mode === 'month' ? 'on' : ''}">แสดงแบบเดือน</button><button data-vm="day" class="${mode === 'day' ? 'on' : ''}">แสดงแบบวัน</button></div>`;
  const badgeOf = x => `<span class="badge ${x.reason === 'นัดหมาย' ? 'warn' : ''}">${x.reason}</span>`;
  const bind = () => box.querySelectorAll('[data-vm]').forEach(b => b.onclick = () => setMode(b.dataset.vm));
  const subOf = (x, d) => {
    if (x.reason === 'นัดหมาย') return `นัด ${fmtDate(d)}`;
    const st = D.customerStats(m, x.c.id), diff = D.dayNum(d) - D.dayNum(m.today);
    return `${diff < 0 ? `<span style="color:var(--bad)">เกินรอบ ${-diff} วัน</span>` : `ถึงรอบ ${fmtDate(d)}`} · ทุก ${st.cycle || '-'} วัน`;
  };

  // ---- month cards: 12 months of the chosen (Buddhist) year, count per month, tap -> list below ----
  const drawMonths = () => {
    const y = +ym.slice(0, 4), thisY = +m.today.slice(0, 4);
    const years = [thisY - 1, thisY, thisY + 1];
    const counts = []; for (let i = 1; i <= 12; i++) counts.push([...D.monthCalendar(m, `${y}-${String(i).padStart(2, '0')}`).values()].reduce((s, a) => s + a.length, 0));
    const mo = +ym.slice(5, 7), days = D.monthCalendar(m, ym);
    const rows = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).flatMap(([d, arr]) => arr.map(x => ({ d, x })));
    const row = r => custRow(m, r.x.c, { extra: badgeOf(r.x), sub: subOf(r.x, r.d) });
    box.innerHTML = `${modeBar()}<div class="chips" style="margin:12px 0">${years.map(v => `<button class="chip ${v === y ? 'on' : ''}" data-y="${v}">${v + 543}</button>`).join('')}</div>
      <div class="mcards">${counts.map((n, i) => `<button class="mcard ${i + 1 === mo ? 'sel' : ''}" data-mo="${i + 1}"><b>${n}</b><span>${MONTHS[i]}</span></button>`).join('')}</div>
      <div class="sec"><span>${monthLabel(ym)} (${rows.length})</span><span class="faint xs">นัดหมาย + ถึงรอบซื้อ</span></div>
      ${rows.length > 6 ? `<label class="search" style="margin-bottom:8px">${icon('search')}<input id="mq" type="search" placeholder="ค้นหาในเดือนนี้" autocomplete="off"></label>` : ''}
      <div id="ml">${rows.length ? `<div class="list">${pager(rows, row, { id: 'mc' })}</div>` : emptyMsg('ไม่มีร้านในเดือนนี้')}</div>`;
    bind(); bindPager(box, rows, row, { id: 'mc' });
    box.querySelectorAll('[data-y]').forEach(b => b.onclick = () => { ym = `${b.dataset.y}-${ym.slice(5)}`; sel = ''; draw(); });
    box.querySelectorAll('[data-mo]').forEach(b => b.onclick = () => { ym = `${ym.slice(0, 4)}-${String(b.dataset.mo).padStart(2, '0')}`; sel = ''; history.replaceState(null, '', `#/visits?tab=cal&v=month&ym=${ym}`); draw(); });
    box.querySelector('#mq')?.addEventListener('input', e => { const t = D.normText(e.target.value); const r = rows.filter(z => !t || D.normText(z.x.c.name).includes(t) || z.x.c.id === e.target.value.trim()); box.querySelector('#ml').innerHTML = r.length ? `<div class="list">${r.map(row).join('')}</div>` : emptyMsg('ไม่พบ'); });
  };

  // ---- day grid: days of one month with store counts; tap a day -> list below ----
  const drawDays = () => {
    const days = D.monthCalendar(m, ym);
    const [y, mo] = ym.split('-').map(Number);
    const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(), dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    let cells = DOW.map(d => `<div class="dh">${d}</div>`).join('') + '<div class="d x"></div>'.repeat(first);
    for (let d = 1; d <= dim; d++) {
      const ds = `${ym}-${String(d).padStart(2, '0')}`, n = (days.get(ds) || []).length;
      cells += `<button class="d ${ds === m.today ? 'today' : ''} ${ds === sel ? 'sel' : ''}" data-d="${ds}">${d}${n ? `<b>${n}</b>` : ''}</button>`;
    }
    const list = sel ? (days.get(sel) || []) : [];
    const total = [...days.values()].reduce((s, a) => s + a.length, 0);
    const row = x => custRow(m, x.c, { extra: badgeOf(x), sub: subOf(x, sel) });
    box.innerHTML = `${modeBar()}<div class="row between" style="margin:12px 0"><button class="btn ghost sm" data-m="-1">${icon('back')}</button><div class="b">${monthLabel(ym)}</div><button class="btn ghost sm" data-m="1" style="transform:scaleX(-1)">${icon('back')}</button></div>
      <div class="cal">${cells}</div><div class="muted xs" style="margin-top:8px">ตัวเลขในช่อง = จำนวนร้านที่ต้องเข้าพบ (นัดหมายที่เซลล์บันทึก + ร้านที่ถึงรอบซื้อตามที่คำนวณ) · เดือนนี้รวม ${total} รายการ</div>
      <div class="sec"><span>${sel ? fmtDate(sel) : 'เลือกวันที่'}</span><span class="faint xs">${list.length} ร้าน</span></div>
      ${sel && list.length > 6 ? `<label class="search" style="margin-bottom:8px">${icon('search')}<input id="dq" type="search" placeholder="ค้นหาในวันนี้" autocomplete="off"></label>` : ''}
      <div id="dl">${sel ? (list.length ? `<div class="list">${list.map(row).join('')}</div>` : emptyMsg('ไม่มีร้านในวันนี้')) : ''}</div>`;
    bind();
    box.querySelector('#dq')?.addEventListener('input', e => { const t = D.normText(e.target.value); box.querySelector('#dl').innerHTML = `<div class="list">${list.filter(x => !t || D.normText(x.c.name).includes(t) || x.c.id === e.target.value.trim()).map(row).join('')}</div>`; });
    box.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { sel = b.dataset.d; history.replaceState(null, '', `#/visits?tab=cal&v=day&ym=${ym}&d=${sel}`); draw(); });
    box.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const dt = new Date(Date.UTC(y, mo - 1 + +b.dataset.m, 1)); ym = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`; sel = ''; draw(); });
  };
  const draw = () => (mode === 'day' ? drawDays() : drawMonths());
  draw();
}
