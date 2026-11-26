import * as D from '../shared/domain.js';
import { esc, icon, getGps, distanceKm, toast, debounce } from '../ui.js';
import { custRow, emptyMsg, pager, bindPager } from './common.js';

export default function map({ m, query }) {
  const withGps = m.customers.filter(D.hasGps);
  const f = query.f || 'current';
  const html = `<div class="stack">
    <div class="row"><button class="btn grad grow" id="loc">${icon('pin')} ใกล้ฉัน</button></div>
    <label class="search">${icon('search')}<input id="mq" type="search" placeholder="ค้นหาร้านที่มีพิกัด" autocomplete="off"></label>
    <div class="chips">${[['all', 'ทั้งหมด'], ['current', 'ปัจจุบัน'], ['lapsed', 'ห่างหาย']].map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
    <div class="muted sm" id="mc">มีพิกัด ${withGps.length} จาก ${m.customers.length} ร้าน · ไม่มีพิกัด ${m.customers.length - withGps.length}</div>
    <div id="mp"></div><div id="ml"></div></div>`;
  return {
    html, title: 'แผนที่',
    after(root) {
      let me = null, sel = null;
      const inp = root.querySelector('#mq'), list = root.querySelector('#ml'), mp = root.querySelector('#mp');
      const draw = () => {
        const t = D.normText(inp.value);
        let rows = withGps.filter(c => (f === 'all' || D.customerStats(m, c.id).status === f) && (!t || D.normText(c.name).includes(t) || c.id === inp.value.trim()));
        if (me) { rows = rows.map(c => ({ c, d: distanceKm(me, { lat: +c.gpsLat, lng: +c.gpsLng }) })).sort((a, b) => a.d - b.d); }
        else rows = rows.map(c => ({ c, d: null })).sort((a, b) => String(a.c.name).localeCompare(String(b.c.name), 'th'));
        const row = x => custRow(m, x.c, { extra: `<a href="https://www.google.com/maps/dir/?api=1&destination=${x.c.gpsLat},${x.c.gpsLng}" target="_blank" rel="noopener" class="btn ghost sm">${icon('nav')}${x.d === null ? 'นำทาง' : x.d < 1 ? Math.round(x.d * 1000) + ' ม.' : x.d.toFixed(1) + ' กม.'}</a>` });
        list.innerHTML = rows.length ? `<div class="list">${pager(rows, row, { id: 'mm', size: 40 })}</div>` : emptyMsg('ไม่พบร้านที่มีพิกัด');
        bindPager(list, rows, row, { id: 'mm', size: 40 });
        list.onclick = e => { const li = e.target.closest('.li'); if (li && !e.target.closest('a')) { const id = decodeURIComponent(li.dataset.go.split('/').pop()); const c = m.custById.get(id); if (c) { sel = c; showMap(); e.stopPropagation(); } } };
        if (!sel && rows[0]) { sel = rows[0].c; } showMap();
      };
      const showMap = () => {
        if (!sel) { mp.innerHTML = ''; return; }
        const la = +sel.gpsLat, lo = +sel.gpsLng, d = 0.006;
        mp.innerHTML = `<div class="card" style="padding:0;overflow:hidden"><iframe title="แผนที่ ${esc(sel.name)}" loading="lazy" style="border:0;width:100%;height:220px;display:block" src="https://www.openstreetmap.org/export/embed.html?bbox=${lo - d}%2C${la - d}%2C${lo + d}%2C${la + d}&layer=mapnik&marker=${la}%2C${lo}"></iframe><div class="row between" style="padding:8px 12px"><span class="b ell">${esc(sel.name)}</span><a href="#/c/${encodeURIComponent(sel.id)}">เปิด</a></div></div>`;
      };
      draw();
      inp.addEventListener('input', debounce(draw));
      root.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { location.hash = `#/map?f=${b.dataset.f}`; });
      root.querySelector('#loc').onclick = async e => { e.target.disabled = true; try { me = await getGps(); toast('เรียงตามระยะทางจากตำแหน่งปัจจุบัน'); draw(); } catch (er) { toast(er.message); } e.target.disabled = false; };
    },
  };
}
