import { VERSION } from './version.js';
import { S, init, whoami, setToken, loadFromCache, refresh, flush, subscribe, loadGoogleScript, ApiError, pendingCount, logout } from './data.js';
import { esc, icon, toast } from './ui.js';

const routes = [];
const reg = (re, mod, opts = {}) => routes.push({ re, mod, ...opts });
// [pattern, module file, nav tab, title, top-level?]
reg(/^\/$/, 'home', { nav: 'home', title: 'HAVAN CRM', top: true });
reg(/^\/customers$/, 'customers', { nav: 'customers', title: 'ลูกค้า', top: true });
reg(/^\/c\/([^/]+)$/, 'customer', { nav: 'customers', title: 'ลูกค้า' });
reg(/^\/visits$/, 'visits', { nav: 'visits', title: 'เข้าพบ', top: true });
reg(/^\/orders$/, 'orders', { nav: 'orders', title: 'ออเดอร์', top: true });
reg(/^\/order\/([^/]+)$/, 'order', { nav: 'orders', title: 'รับออเดอร์' });
reg(/^\/settings$/, 'settings', { nav: 'settings', title: 'ตั้งค่า', top: true });
reg(/^\/settings\/([a-z]+)$/, 'settings', { nav: 'settings', title: 'ตั้งค่า' });
reg(/^\/sales$/, 'sales', { nav: 'home', title: 'รายงานยอดขาย' });
reg(/^\/new$/, 'newcustomers', { nav: 'home', title: 'ลูกค้าใหม่' });
reg(/^\/map$/, 'map', { nav: 'home', title: 'แผนที่' });

const NAV = [['home', '#/', 'home', 'หน้าแรก'], ['customers', '#/customers', 'users', 'ลูกค้า'], ['visits', '#/visits', 'pin', 'เข้าพบ'], ['orders', '#/orders', 'cart', 'ออเดอร์'], ['settings', '#/settings', 'gear', 'ตั้งค่า']];
const $ = s => document.querySelector(s);
const pageCache = {};
const scrollMem = new Map();
let current = { hash: '', cleanup: null };
let forward = false;

export function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')), raw: h };
}
export const go = (h, { replace = false } = {}) => { forward = true; if (replace) location.replace(h); else location.hash = h; };
export const back = fallback => { if (history.length > 1) history.back(); else go(fallback || '#/'); };

function paintShell(route) {
  const top = route?.top;
  $('#nav').innerHTML = NAV.map(([k, h, ic, t]) => `<a href="${h}" class="${route?.nav === k ? 'on' : ''}" aria-label="${t}">${icon(ic)}<span>${t}</span></a>`).join('');
  paintHeader(route?.title, top);
}
function paintHeader(title, top) {
  const pend = pendingCount(), failed = S.failed.length;
  const state = S.syncing ? 'กำลังซิงก์…' : !S.online ? 'ออฟไลน์' : failed ? `ค้าง ${failed}` : pend ? `รอส่ง ${pend}` : 'ซิงก์แล้ว';
  const cls = !S.online ? 'off' : failed ? 'err' : '';
  $('#hdr').innerHTML = `${top ? '' : `<button class="ibtn" data-back aria-label="ย้อนกลับ">${icon('back')}</button>`}<div class="ttl" id="ttl">${esc(title || '')}</div><button class="sync" data-go="#/settings/sync" aria-label="สถานะซิงก์"><span class="dot ${cls}"></span>${state}</button>`;
}
export const setTitle = t => { const el = $('#ttl'); if (el) el.textContent = t; document.title = `${t} · HAVAN CRM`; };

async function render() {
  const { path, query, raw } = parseHash();
  let route, m;
  for (const r of routes) { m = r.re.exec(path); if (m) { route = r; break; } }
  if (current.cleanup) { try { current.cleanup(); } catch {} current.cleanup = null; }
  if (current.hash) scrollMem.set(current.hash, scrollY);
  current.hash = raw;
  paintShell(route);
  // fresh container each render: drops every listener the previous page attached (no stacked handlers)
  const old = $('#view'); const view = old.cloneNode(false); old.replaceWith(view);
  if (!route) { view.innerHTML = `<div class="empty">ไม่พบหน้านี้<br><a href="#/">กลับหน้าแรก</a></div>`; return; }
  if (!S.model) { view.innerHTML = `<div class="empty">กำลังโหลดข้อมูล…</div>`; return; }
  try {
    const mod = pageCache[route.mod] || (pageCache[route.mod] = await import(`./pages/${route.mod}.js?v=${encodeURIComponent(VERSION)}`));
    const out = await mod.default({ params: m.slice(1).map(decodeURIComponent), query, m: S.model, path });
    const html = typeof out === 'string' ? out : out.html;
    view.innerHTML = html;
    if (out.title) setTitle(out.title); else if (route.title) document.title = `${route.title} · HAVAN CRM`;
    if (out.after) current.cleanup = out.after(view) || null;
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="banner bad">เปิดหน้านี้ไม่สำเร็จ: ${esc(e.message)}</div>`;
  }
  const y = !forward ? scrollMem.get(raw) : 0; forward = false;
  requestAnimationFrame(() => scrollTo(0, y || 0));
}

// global delegated navigation
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#/"]'); if (a) forward = true;
  const g = e.target.closest('[data-go]'); if (g && !e.defaultPrevented) { e.preventDefault(); go(g.dataset.go); }
  if (e.target.closest('[data-back]')) { e.preventDefault(); back(); }
});
window.addEventListener('hashchange', render);

// Re-render on data changes, but never while the user is typing or a sheet is open (checked when the
// timer FIRES, not when it was scheduled). A deferred refresh is applied as soon as the user is done.
let rerenderTimer, dirty = false;
const busy = () => !!document.querySelector('.scrim') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
function flushRender() {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    if (busy()) { dirty = true; return; }
    dirty = false; const y = scrollY; render().then(() => scrollTo(0, y));
  }, 150);
}
subscribe(() => {
  const { path } = parseHash();
  paintHeader($('#ttl')?.textContent, routes.find(r => r.re.test(path))?.top);
  flushRender();
});
document.addEventListener('focusout', () => { if (dirty) setTimeout(() => { if (dirty && !busy()) flushRender(); }, 200); });
document.addEventListener('sheetclose', () => { if (dirty) setTimeout(flushRender, 50); });

// ---------- login ----------
function showLogin(msg = '') {
  const el = $('#login'); el.classList.remove('hide');
  el.innerHTML = `<div class="box"><div style="width:64px;height:64px;margin:0 auto 14px;border-radius:16px;background:var(--grad);display:grid;place-items:center;color:#fff;font-weight:800;font-size:28px">H</div>
    <h2 style="margin-bottom:4px">HAVAN CRM</h2><p class="muted sm" style="margin-bottom:18px">เข้าสู่ระบบด้วยบัญชี Google ที่ได้รับอนุญาต</p>
    ${msg ? `<div class="banner bad" style="margin-bottom:12px">${esc(msg)}</div>` : ''}<div id="gbtn" style="display:flex;justify-content:center"></div></div>`;
  loadGoogleScript().then(() => {
    window.google.accounts.id.initialize({ client_id: S.health.googleClientId, auto_select: true, callback: async r => { setToken(r.credential); el.classList.add('hide'); await start(); } });
    window.google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'th' });
  }).catch(e => { $('#gbtn').innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; });
}

async function start() {
  try {
    if (S.health.authMode !== 'dev' && !S.token) return showLogin();
    await whoami();
  } catch (e) {
    if (e.status === 401) { setToken(''); return showLogin(e.message); }
    if (e.status === 403) { setToken(''); return showLogin(e.message); }
    if (e.status === 0 && await loadFromCache()) { S.user = { email: '(ออฟไลน์)', role: '', isAdmin: false }; } else return showLogin(e.message);
  }
  const cached = await loadFromCache();
  if (cached) render();
  try { await refresh({ quiet: cached }); } catch (e) {
    if (e.status === 401 || e.status === 403) { setToken(''); return showLogin(e.message); }
    if (!cached) { $('#view').innerHTML = `<div class="banner bad">โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}<br><button class="btn sm" style="margin-top:8px" onclick="location.reload()">ลองใหม่</button></div>`; return; }
  }
  render();
  flush().catch(e => { if (e.status === 401 || e.status === 403) showLogin('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง (งานที่ค้างจะไม่หาย)'); });
  // refresh stale data when the app comes back to the foreground
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - S.lastSync > 10 * 60000) refresh({ quiet: true }).catch(() => {}); });
}

(async () => {
  paintShell(null);
  try { await init(); } catch (e) { $('#view').innerHTML = `<div class="banner bad">ติดต่อเซิร์ฟเวอร์ไม่ได้: ${esc(e.message)}</div>`; return; }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('/sw.js').then(reg => reg.update()).catch(() => {});
  }
  await start();
})();
window.__crm = { S, go, back, VERSION };
