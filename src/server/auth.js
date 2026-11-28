import { verifyAppsScriptIdentity } from './apps-script.js';

// Authentication: Google ID token -> email -> ACCESS tab (active + role).
// AUTH_MODE=dev is honoured ONLY together with DATA_MODE=memory, so production can never run open.
const tokenOk = new Map();      // idToken -> {email, exp}
let accessCache = { at: 0, rows: [] };

const truthy = v => ['true', '1', 'yes', 'y', 'ใช่', 'active', 'on'].includes(String(v ?? '').trim().toLowerCase());
export const isAdminRole = r => ['admin', 'owner', 'manager', 'แอดมิน', 'เจ้าของ', 'ผู้จัดการ'].includes(String(r || '').trim().toLowerCase());

export class AuthError extends Error { constructor(msg, status = 401) { super(msg); this.status = status; } }

async function verifyGoogle(token, env) {
  const hit = tokenOk.get(token);
  if (hit && hit.exp > Date.now()) return hit.email;
  if (!env.GOOGLE_CLIENT_ID) throw new AuthError('ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID', 500);
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  if (!r.ok) throw new AuthError('โทเคนไม่ถูกต้องหรือหมดอายุ');
  const j = await r.json();
  if (j.aud !== env.GOOGLE_CLIENT_ID) throw new AuthError('โทเคนไม่ใช่ของแอปนี้');
  if (String(j.email_verified) !== 'true') throw new AuthError('อีเมลยังไม่ยืนยัน');
  if (+j.exp * 1000 < Date.now()) throw new AuthError('โทเคนหมดอายุ');
  const email = String(j.email).toLowerCase();
  tokenOk.set(token, { email, exp: Math.min(+j.exp * 1000, Date.now() + 300000) });
  if (tokenOk.size > 200) tokenOk.clear();
  return email;
}

export async function loadAccess(store, force = false) {
  if (!force && Date.now() - accessCache.at < 60000 && accessCache.store === store) return accessCache.rows;
  const rows = (await store.table('ACCESS')).map(r => ({ email: String(r.email || '').trim().toLowerCase(), active: truthy(r.active), note: r.note || '', role: r.role || '' })).filter(r => r.email);
  accessCache = { at: Date.now(), rows, store };
  return rows;
}
export const resetAccessCache = () => { accessCache = { at: 0, rows: [] }; tokenOk.clear(); };

export async function authenticate(req, env, store) {
  let email;
  if (env.AUTH_MODE === 'dev') {
    if (env.DATA_MODE !== 'memory') throw new AuthError('AUTH_MODE=dev ใช้ได้เฉพาะ DATA_MODE=memory', 500);
    email = (req.headers.get('x-dev-user') || 'dev@local').toLowerCase();
  } else {
    const h = req.headers.get('authorization') || '';
    if (!h.startsWith('Bearer ')) throw new AuthError('ต้องเข้าสู่ระบบ');
    if (env.AUTH_MODE === 'apps_script') {
      email = await verifyAppsScriptIdentity(h.slice(7), env.CRM_LOGIN_SECRET, new URL(req.url).origin);
      if (!email) throw new AuthError('หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบด้วย Google อีกครั้ง');
    } else {
      email = await verifyGoogle(h.slice(7), env);
    }
  }
  const rows = await loadAccess(store);
  const me = rows.find(r => r.email === email);
  if (!me || !me.active) throw new AuthError(`บัญชี ${email} ไม่มีสิทธิ์ใช้งาน (ตรวจแท็บ ACCESS)`, 403);
  return { email, role: me.role, isAdmin: isAdminRole(me.role) };
}
