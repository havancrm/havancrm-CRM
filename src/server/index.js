// Cloudflare Worker entry: static assets (public/) + /api/*.
import { MemoryStore, SheetsStore, SchemaError } from './store.js';
import { authenticate, AuthError, loadAccess } from './auth.js';
import { execBatch } from './exec.js';
import { buildFixtures } from './fixtures.js';
import { CORE_TABS, TABS, checkHeaders, TOTAL_COLUMNS } from '../../public/js/shared/schema.js';
import { OpError } from '../../public/js/shared/ops.js';

// Cloudflare Free allows 50 subrequests per invocation; one op needs <= ~12 Google calls.
const MAX_OPS_PER_REQUEST = 4;
const VERSION = '1.0.0+e23694c';
let memStore = null;

function getStore(env) {
  if (env.DATA_MODE === 'memory') {
    if (!memStore) memStore = new MemoryStore(buildFixtures({ now: Date.now() }));
    return memStore;
  }
  return new SheetsStore(env);
}
export function _resetMemory() { memStore = null; }

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(req) : new Response('not found', { status: 404 });
    try {
      const store = getStore(env);
      if (url.pathname === '/api/health') {
        return json({ ok: true, version: VERSION, mode: store.mode, authMode: env.AUTH_MODE || 'google', googleClientId: env.AUTH_MODE === 'dev' ? '' : env.GOOGLE_CLIENT_ID || '' });
      }
      const me = await authenticate(req, env, store);
      const ctx = { now: Date.now(), user: me.email, isAdmin: me.isAdmin, deviceId: req.headers.get('x-device-id') || '' };

      if (url.pathname === '/api/me') return json({ email: me.email, role: me.role, isAdmin: me.isAdmin });

      if (url.pathname === '/api/bootstrap' && req.method === 'GET') {
        if (store.mode === 'sheets') {
          const r = await store.batchGetRaw(CORE_TABS);
          if (!r.ok) return json({ error: `อ่านฐานข้อมูลไม่สำเร็จ (${r.status})` }, 502);
          return new Response(r.body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-crm-mode': 'sheets' } });
        }
        return json(await store.batchGet(CORE_TABS), 200, { 'x-crm-mode': 'memory' });
      }

      if (url.pathname.startsWith('/api/tab/') && req.method === 'GET') {
        const tab = decodeURIComponent(url.pathname.slice(9));
        if (!['IMPORT_BATCHES', 'IMPORT_REVIEW', 'changes', 'ACCESS'].includes(tab)) return json({ error: 'ไม่อนุญาตแท็บนี้' }, 403);
        if (!me.isAdmin) return json({ error: 'ต้องเป็นผู้ดูแลระบบ' }, 403);
        return json(await store.batchGet([tab]));
      }

      if (url.pathname.startsWith('/api/photo/') && req.method === 'GET') {
        const id = decodeURIComponent(url.pathname.slice(11));
        if (!/^[\w-]{3,120}$/.test(id)) return json({ error: 'fileId ไม่ถูกต้อง' }, 400);
        // only files this CRM recorded (photos.fileId / customers.storePhotoFileIds) can be proxied
        const [pf, sf] = await Promise.all([store.column('photos', 'fileId'), store.column('customers', 'storePhotoFileIds')]);
        const known = pf.includes(id) || sf.some(v => v.split(',').map(x => x.trim()).includes(id));
        if (!known) return json({ error: 'ไม่พบรูปนี้ในระบบ' }, 404);
        const r = await store.fetchPhoto(id);
        if (!r.ok) return json({ error: `ดึงรูปไม่สำเร็จ (${r.status})` }, 502);
        return new Response(r.body, { headers: { 'content-type': r.headers.get('content-type') || 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
      }

      if (url.pathname === '/api/diagnostics' && req.method === 'GET') {
        if (!me.isAdmin) return json({ error: 'ต้องเป็นผู้ดูแลระบบ' }, 403);
        const hs = await store.headerRows(TABS);
        const checks = hs.map(h => checkHeaders(h.tab, h.header));
        return json({ tabs: TABS.length, expectedColumns: TOTAL_COLUMNS, ok: checks.every(c => c.ok), checks, mode: store.mode });
      }

      if (url.pathname === '/api/ops' && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        if (!body || !Array.isArray(body.ops)) return json({ error: 'รูปแบบคำขอไม่ถูกต้อง' }, 400);
        if (body.ops.length > MAX_OPS_PER_REQUEST) return json({ error: `ส่งได้ครั้งละไม่เกิน ${MAX_OPS_PER_REQUEST} คำสั่ง` }, 400);
        const results = await execBatch(store, body.ops, { ...ctx, deviceId: body.deviceId || ctx.deviceId });
        return json({ results });
      }
      return json({ error: 'ไม่พบ API' }, 404);
    } catch (e) {
      if (e instanceof AuthError) return json({ error: e.message }, e.status);
      if (e instanceof SchemaError) return json({ error: e.message, kind: 'schema' }, 500);
      if (e instanceof OpError) return json({ error: e.message }, 400);
      return json({ error: `ผิดพลาดที่เซิร์ฟเวอร์: ${String(e.message).slice(0, 200)}` }, 500);
    }
  },
};
