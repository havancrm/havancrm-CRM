import * as D from '../shared/domain.js';
import { esc, icon, fmtDate, monthLabel, MONTHS } from '../ui.js';
import { custRow, emptyMsg, pager, bindPager } from './common.js';

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

// รอบลูกค้า (aCRM): pick a year (BE) -> 12 month cards with counts -> list of shops whose round falls in that month.
// Display mode toggle (user request): month = cards, day = day grid of the selected month.
export default function visits({ m, query }) {
  const html = `<div class="stack" id="vb"></div>`;
  return {
    html, title: 'รอบลูกค้า',
    after(root) { calendar(m, root.querySelector('#vb'), query); },
  };
}

function calendar(m, box, query) {
  if (query.ov || query.nc) {
    const items = query.ov ? D.overdueBefore(m, m.today.slice(0, 7) + '-01').map(x => ({ c: x.c, st: x.st })) : m.customers.map(c => ({ c, st: D.customerStats(m, c.id) })).filter(x => x.st.status !== 'closed' && !x.st.eligible);
    const row = x => custRow(m, x.c);
    box.innerHTML = `<div class="sh"><span>${query.ov ? 'เกินรอบจากเดือนก่อน' : 'ยังไม่มีรอบ'} (${items.length})</span></div><div class="stack">${pager(items, row, { id: 'ov' })}</div>`;
    bindPager(box, items, row, { id: 'ov' });
    return;
  }
  let ym = /^\d{4}-\d{2}$/.test(query.ym || '') ? query.ym : m.today.slice(0, 7);
  let sel = query.d && query.d.startsWith(ym) ? query.d : (m.today.startsWith(ym) ? m.today : '');
  let mode = query.v === 'day' || query.v === 'month' ? query.v : (() => { try { return localStorage.getItem('calMode') === 'day' ? 'day' : 'month'; } catch { return 'month'; } })();
  const setMode = v => { mode = v; try { localStorage.setItem('calMode', v); } catch {} draw(); };
  const modeBar = () => `<div class="seg" style="margin-top:12px"><button data-vm="month" class="${mode === 'month' ? 'on' : ''}">แสดงแบบเดือน</button><button data-vm="day" class="${mode === 'day' ? 'on' : ''}">แสดงแบบวัน</button></div>`;
  const badgeOf = x => `<span class="pill ${x.reason === 'นัดหมาย' ? 'p-amb' : 'p-blu'}">${x.reason}</span>`;
  const bind = () => box.querySelectorAll('[data-vm]').forEach(b => b.onclick = () => setMode(b.dataset.vm));
  const subOf = (x, d) => {
    if (x.reason === 'นัดหมาย') return `นัด ${fmtDate(d)}`;
    const diff = D.dayNum(d) - D.dayNum(m.today);
    return diff < 0 ? `<span class="rd">เกินรอบ ${-diff} วัน</span>` : diff === 0 ? 'ถึงรอบวันนี้' : `ถึงรอบ ${fmtDate(d)}`;
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
      <div id="ml">${rows.length ? `<div class="stack">${pager(rows, row, { id: 'mc' })}</div>` : emptyMsg('ไม่มีร้านในเดือนนี้')}</div>`;
    bind(); bindPager(box, rows, row, { id: 'mc' });
    const late = D.overdueBefore(m, m.today.slice(0, 7) + '-01').length, none = m.customers.filter(c => { const st = D.customerStats(m, c.id); return st.status !== 'closed' && !st.eligible; }).length;
    box.insertAdjacentHTML('beforeend', `<div class="sc" style="margin-top:8px"><a class="li" href="#/follow?ov=1"><div class="grow">เกินรอบจากเดือนก่อน</div><b>${late} ›</b></a><a class="li" href="#/follow?nc=1"><div class="grow">ยังไม่มีรอบ</div><b>${none} ›</b></a></div>`);
    box.querySelectorAll('[data-y]').forEach(b => b.onclick = () => { ym = `${b.dataset.y}-${ym.slice(5)}`; sel = ''; draw(); });
    box.querySelectorAll('[data-mo]').forEach(b => b.onclick = () => { ym = `${ym.slice(0, 4)}-${String(b.dataset.mo).padStart(2, '0')}`; sel = ''; history.replaceState(null, '', `#/follow?v=month&ym=${ym}`); draw(); });
    box.querySelector('#mq')?.addEventListener('input', e => { const t = D.normText(e.target.value); const r = rows.filter(z => !t || D.normText(z.x.c.name).includes(t) || z.x.c.id === e.target.value.trim()); box.querySelector('#ml').innerHTML = r.length ? `<div class="stack">${r.map(row).join('')}</div>` : emptyMsg('ไม่พบ'); });
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
      <div id="dl">${sel ? (list.length ? `<div class="stack">${list.map(row).join('')}</div>` : emptyMsg('ไม่มีร้านในวันนี้')) : ''}</div>`;
    bind();
    box.querySelector('#dq')?.addEventListener('input', e => { const t = D.normText(e.target.value); box.querySelector('#dl').innerHTML = `<div class="stack">${list.filter(x => !t || D.normText(x.c.name).includes(t) || x.c.id === e.target.value.trim()).map(row).join('')}</div>`; });
    box.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { sel = b.dataset.d; history.replaceState(null, '', `#/follow?v=day&ym=${ym}&d=${sel}`); draw(); });
    box.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const dt = new Date(Date.UTC(y, mo - 1 + +b.dataset.m, 1)); ym = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`; sel = ''; draw(); });
  };
  const draw = () => (mode === 'day' ? drawDays() : drawMonths());
  draw();
}
