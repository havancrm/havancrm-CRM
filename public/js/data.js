// Client data layer: auth, cached bootstrap, offline op queue, optimistic local mirror, sync.
import { buildModel } from './shared/domain.js';
import { rowsToObjects, tabFromRange, checkHeaders, CORE_TABS } from './shared/schema.js';
import { expandOp, applyMutationsLocal } from './shared/ops.js';
import { uuid } from './ui.js';

export const UNITS = {};            // product code -> unit (from the accounting price list; units only, no prices)
export const S = {
  health: null, user: null, raw: null, model: null, queue: [], failed: [], online: navigator.onLine,
  syncing: false, lastSync: 0, schemaIssues: [], listeners: new Set(), token: '', deviceId: '',
};
const emit = () => S.listeners.forEach(f => f());
export const subscribe = f => { S.listeners.add(f); return () => S.listeners.delete(f); };

// ---------- IndexedDB (falls back to memory) ----------
let dbp = null; const memKV = new Map(), memQ = new Map();
function db() {
  if (dbp) return dbp;
  dbp = new Promise(res => {
    try {
      const r = indexedDB.open('havan-crm', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('queue', { keyPath: 'opId' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
const idb = (store, mode, fn) => db().then(d => !d ? null : new Promise(res => { try { const tx = d.transaction(store, mode); const rq = fn(tx.objectStore(store)); tx.oncomplete = () => res(rq?.result); tx.onerror = () => res(null); tx.onabort = () => res(null); } catch { res(null); } }));
const kvGet = async k => { const v = await idb('kv', 'readonly', s => s.get(k)); return v ?? memKV.get(k); };
const kvSet = async (k, v) => { memKV.set(k, v); await idb('kv', 'readwrite', s => s.put(v, k)); };
const qAll = async () => { const v = await idb('queue', 'readonly', s => s.getAll()); return v ?? [...memQ.values()]; };
const qPut = async o => {
  const key = await idb('queue', 'readwrite', s => s.put(o));
  if (key !== o.opId) throw new Error('บันทึกงานลงอุปกรณ์ไม่สำเร็จ กรุณาตรวจพื้นที่จัดเก็บและลองใหม่');
  memQ.set(o.opId, o);
};
const qDel = async id => { memQ.delete(id); await idb('queue', 'readwrite', s => s.delete(id)); };

// ---------- API ----------
export class ApiError extends Error { constructor(m, status, body) { super(m); this.status = status; this.body = body; } }
export async function api(path, init = {}) {
  const headers = { 'x-device-id': S.deviceId, ...(init.headers || {}) };
  if (S.health?.authMode === 'dev') headers['x-dev-user'] = localStorage.getItem('devUser') || 'dev@local';
  else if (S.token) headers.authorization = `Bearer ${S.token}`;
  if (init.body && typeof init.body !== 'string') { init.body = JSON.stringify(init.body); headers['content-type'] = 'application/json'; }
  let r;
  try { r = await fetch(path, { ...init, headers, cache: 'no-store' }); } catch (e) { throw new ApiError('ออฟไลน์', 0); }
  if (r.status === 204) return null;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(body.error || `ผิดพลาด ${r.status}`, r.status, body);
  return body;
}

// ---------- model ----------
function normalize(boot) {
  const raw = {}; const issues = [];
  for (const vr of boot.valueRanges || []) {
    const tab = tabFromRange(vr.range); if (!tab) continue;
    const chk = checkHeaders(tab, vr.values?.[0]);
    if (!chk.ok) issues.push(chk);
    raw[tab] = rowsToObjects(vr.values);
  }
  for (const t of CORE_TABS) if (!raw[t]) raw[t] = [];
  return { raw, issues };
}
export function rebuild() {
  if (!S.raw) return;
  // optimistic overlay of pending ops on a shallow copy (arrays are copied lazily by applyMutationsLocal)
  const raw = {}; for (const k of Object.keys(S.raw)) raw[k] = S.raw[k].map(r => ({ ...r }));
  for (const op of S.queue) {
    try { const ex = expandOp(op, { now: op.at, user: S.user?.email || '', deviceId: S.deviceId }); applyMutationsLocal(raw, ex.mutations); } catch { /* invalid op stays visible in sync panel */ }
  }
  S.model = buildModel(raw, Date.now());
  emit();
}
const DAYMS = 86400000;
export async function loadFromCache() {
  const txt = await kvGet('bootstrap');
  if (!txt) return false;
  try { const { raw, issues } = normalize(JSON.parse(txt)); S.raw = raw; S.schemaIssues = issues; S.lastSync = (await kvGet('bootstrapAt')) || 0; rebuild(); return true; } catch { return false; }
}
export async function refresh({ quiet = false } = {}) {
  if (S.syncing) return;
  S.syncing = true; emit();
  try {
    const r = await fetch('/api/bootstrap', { cache: 'no-store', headers: { ...(S.health?.authMode === 'dev' ? { 'x-dev-user': localStorage.getItem('devUser') || 'dev@local' } : { authorization: `Bearer ${S.token}` }), 'x-device-id': S.deviceId } });
    if (!r.ok) { const b = await r.json().catch(() => ({})); throw new ApiError(b.error || `ผิดพลาด ${r.status}`, r.status, b); }
    const txt = await r.text();
    const { raw, issues } = normalize(JSON.parse(txt));
    S.raw = raw; S.schemaIssues = issues; S.lastSync = Date.now();
    kvSet('bootstrap', txt).catch(() => {}); kvSet('bootstrapAt', S.lastSync).catch(() => {});
    S.online = true; rebuild();
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw e;
    S.online = false; if (!quiet && !S.raw) throw e;
  } finally { S.syncing = false; emit(); }
}

// ---------- queue ----------
export async function loadQueue() { S.queue = (await qAll()).sort((a, b) => a.at - b.at); S.failed = S.queue.filter(o => o.error); }
export async function enqueue(type, payload) {
  const op = { opId: uuid(), type, payload, at: Date.now() };
  await expandOp(op, { now: op.at, user: S.user?.email || '', deviceId: S.deviceId });   // validate now (throws OpError -> shown to user)
  await qPut(op); S.queue.push(op); rebuild();
  flush().catch(() => {});
  return op;
}
let flushing = null;
export function flush() {
  if (flushing) return flushing;
  const run = (async () => {
    await null;                         // never let the body finish before `flushing` is assigned
    try {
      while (true) {
        const todo = S.queue.filter(o => !o.error).slice(0, 3);   // server cap is 4 ops/request (Cloudflare Free subrequest limit)
        if (!todo.length || (!S.online && !navigator.onLine)) break;
        let res;
        try { res = await api('/api/ops', { method: 'POST', body: { deviceId: S.deviceId, ops: todo } }); S.online = true; }
        catch (e) {
          if (e.status === 0) { S.online = false; break; }
          if (e.status === 401 || e.status === 403) throw e;
          for (const o of todo) { o.error = e.message; await qPut(o); }
          break;
        }
        for (const r of res.results) {
          const op = S.queue.find(o => o.opId === r.opId); if (!op) continue;
          if (r.status === 'ok' || r.status === 'duplicate') { S.queue = S.queue.filter(o => o !== op); await qDel(op.opId); }
          else { op.error = r.message || r.code; await qPut(op); }
        }
        S.failed = S.queue.filter(o => o.error); emit();
      }
    } finally { S.failed = S.queue.filter(o => o.error); emit(); }
    if (!S.queue.some(o => !o.error)) await refresh({ quiet: true }).catch(() => {});
  })();
  flushing = run;
  run.then(() => { if (flushing === run) flushing = null; }, () => { if (flushing === run) flushing = null; });
  return run;
}
export async function discardOp(opId) { S.queue = S.queue.filter(o => o.opId !== opId); await qDel(opId); S.failed = S.queue.filter(o => o.error); rebuild(); }
export async function retryFailed() { for (const o of S.queue) if (o.error) { delete o.error; await qPut(o); } S.failed = []; emit(); return flush(); }
export const pendingCount = () => S.queue.filter(o => !o.error).length;

// ---------- auth ----------
export function loadGoogleScript() {
  return new Promise((res, rej) => { if (window.google?.accounts) return res(); const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = res; s.onerror = () => rej(new Error('โหลด Google Sign-In ไม่ได้')); document.head.appendChild(s); });
}
export async function init() {
  S.deviceId = localStorage.getItem('deviceId') || (() => { const d = uuid().slice(0, 8); localStorage.setItem('deviceId', d); return d; })();
  try { S.health = await api('/api/health'); try { localStorage.setItem('health', JSON.stringify(S.health)); } catch {} }
  catch (e) {                                   // offline start: reuse the last known server settings
    let h = null; try { h = JSON.parse(localStorage.getItem('health') || 'null'); } catch {}
    if (!h || e.status !== 0) throw e; S.health = h; S.online = false;
  }
  S.token = sessionStorage.getItem('idt') || '';
  fetch('/data/units.json').then(r => (r.ok ? r.json() : {})).then(j => Object.assign(UNITS, j)).catch(() => {});
  await loadQueue();
  window.addEventListener('online', () => { S.online = true; emit(); flush().catch(() => {}); });
  window.addEventListener('offline', () => { S.online = false; emit(); });
}
export const setToken = t => { S.token = t; t ? sessionStorage.setItem('idt', t) : sessionStorage.removeItem('idt'); };
export async function whoami() { S.user = await api('/api/me'); return S.user; }
export async function logout() { setToken(''); S.user = null; try { window.google?.accounts?.id?.disableAutoSelect(); } catch {} }
export async function clearCache() { await idb('kv', 'readwrite', s => s.clear()); memKV.clear(); S.raw = null; S.model = null; }

// ---------- photos (Drive proxy needs auth header -> blob URLs) ----------
const photoCache = new Map();
export async function photoUrl(fileId) {
  if (!fileId) return '';
  if (photoCache.has(fileId)) return photoCache.get(fileId);
  try {
    const headers = S.health?.authMode === 'dev' ? { 'x-dev-user': localStorage.getItem('devUser') || 'dev@local' } : { authorization: `Bearer ${S.token}` };
    const r = await fetch(`/api/photo/${encodeURIComponent(fileId)}`, { headers });
    if (!r.ok) return '';
    const u = URL.createObjectURL(await r.blob()); photoCache.set(fileId, u); return u;
  } catch { return ''; }
}
