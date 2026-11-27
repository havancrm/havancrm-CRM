import * as D from '../shared/domain.js';
import { icon, getGps, distanceKm, toast, debounce, esc } from '../ui.js';
import { custRow, emptyMsg, pager, bindPager } from './common.js';

// เข้าพบ (aCRM check-in page): GPS card, chips ถึงรอบ / ใน 5 กม. / ทั้งหมด, search, list with navigate button.
export default function checkin({ m, query }) {
  const html = `<div class="c row"><div class="grow"><b>ตำแหน่งของฉัน</b><div class="t" id="gpst">ยังไม่ได้อ่านตำแหน่ง</div></div><button class="btn sm" id="loc">${icon('pin')} ใกล้ฉัน</button></div>
    <div class="chips" id="ch"></div>
    <div class="sr">${icon('search')}<input id="q" type="search" placeholder="ค้นหาร้านที่จะเข้าพบ" autocomplete="off"></div>
    <div id="list" class="stack"></div>`;
  return {
    html, title: 'เข้าพบ',
    after(root) {
      let me = null, f = query.f || 'due';
      const sug = D.suggestions(m);
      const dueIds = new Set([...sug.today, ...sug.over, ...sug.late].map(x => x.c.id));
      const inp = root.querySelector('#q'), list = root.querySelector('#list'), ch = root.querySelector('#ch');
      const draw = () => {
        const t = D.normText(inp.value);
        let rows = m.customers.filter(c => D.customerStats(m, c.id).status !== 'closed' && (!t || D.normText(c.name).includes(t) || c.id === inp.value.trim()));
        const near = rows.filter(c => me && D.hasGps(c) && distanceKm(me, { lat: +c.gpsLat, lng: +c.gpsLng }) <= 5);
        ch.innerHTML = [['due', `ถึงรอบ ${dueIds.size}`], ['near', `ใน 5 กม. ${me ? near.length : '-'}`], ['all', 'ทั้งหมด']].map(([k, tx]) => `<button class="chip ${f === k ? 'on' : ''}" data-f="${k}">${tx}</button>`).join('');
        if (f === 'due') rows = rows.filter(c => dueIds.has(c.id));
        if (f === 'near') rows = near;
        const dist = c => (me && D.hasGps(c) ? distanceKm(me, { lat: +c.gpsLat, lng: +c.gpsLng }) : null);
        rows = rows.map(c => ({ c, d: dist(c), st: D.customerStats(m, c.id) }))
          .sort((a, b) => (me && a.d !== null && b.d !== null ? a.d - b.d : (a.st.eligible ? a.st.dueDiff : 1e8) - (b.st.eligible ? b.st.dueDiff : 1e8)));
        const row = x => custRow(m, x.c, { extra: D.hasGps(x.c) ? `<a class="btn ghost sm" href="https://www.google.com/maps/dir/?api=1&destination=${x.c.gpsLat},${x.c.gpsLng}" target="_blank" rel="noopener">${icon('nav')}${x.d === null ? 'นำทาง' : x.d < 1 ? Math.round(x.d * 1000) + ' ม.' : x.d.toFixed(1) + ' กม.'}</a>` : '<span class="pill p-gry">ไม่มีพิกัด</span>' });
        list.innerHTML = rows.length ? pager(rows, row, { id: 'ci', size: 40 }) : emptyMsg(f === 'near' && !me ? 'กด “ใกล้ฉัน” เพื่ออ่านตำแหน่ง' : 'ไม่มีรายการ');
        bindPager(list, rows, row, { id: 'ci', size: 40 });
        ch.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { f = b.dataset.f; draw(); });
      };
      draw();
      inp.addEventListener('input', debounce(draw));
      root.querySelector('#loc').onclick = async e => {
        const b = e.currentTarget; b.disabled = true;
        try { me = await getGps(); root.querySelector('#gpst').textContent = `แม่นยำ ~${me.accuracy} ม.`; f = 'near'; draw(); } catch (er) { toast(er.message); }
        b.disabled = false;
      };
    },
  };
}
