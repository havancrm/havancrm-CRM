// Storage adapters. Every method addresses columns by HEADER NAME; row positions are only
// used transiently (to update/delete a specific row found by key).
import { SCHEMA, NUMERIC_COLS, checkHeaders, rowsToObjects } from '../../public/js/shared/schema.js';

export class SchemaError extends Error {}

const colLetter = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

function cellValue(tab, header, v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  if (NUMERIC_COLS[tab]?.includes(header) && String(v).trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return String(v);
}

// ---------------- in-memory (preview / tests) ----------------
export class MemoryStore {
  constructor(seed = {}) {
    this.mode = 'memory';
    this.tabs = {};
    for (const [t, cols] of Object.entries(SCHEMA)) {
      this.tabs[t] = [cols.slice(), ...(seed[t] || []).map(o => cols.map(c => (o[c] === undefined ? '' : String(o[c]))))];
    }
    this.writes = 0;
    this.files = new Map();
  }
  async headers(tab) {
    if (!this.tabs[tab]) throw new SchemaError(`ไม่พบแท็บ ${tab}`);
    const h = this.tabs[tab][0];
    const chk = checkHeaders(tab, h);
    if (!chk.ok) throw new SchemaError(`แท็บ ${tab} ขาดคอลัมน์: ${chk.missing.join(', ')}`);
    return h;
  }
  async matrix(tab) { await this.headers(tab); return this.tabs[tab].map(r => r.slice()); }
  async table(tab) { await this.headers(tab); return rowsToObjects(this.tabs[tab]); }
  async batchGet(tabs) { return { valueRanges: tabs.map(t => ({ range: `${t}!A1:Z${this.tabs[t].length}`, majorDimension: 'ROWS', values: this.tabs[t].map(r => r.slice()) })) }; }
  async headerRows(tabs) { return tabs.map(t => ({ tab: t, header: this.tabs[t][0] })); }
  async column(tab, header) {
    const h = await this.headers(tab); const i = h.indexOf(header);
    return this.tabs[tab].slice(1).map(r => (r[i] === undefined ? '' : String(r[i])));
  }
  async getRow(tab, rowNo) {
    const h = await this.headers(tab); const r = this.tabs[tab][rowNo - 1] || [];
    const o = {}; h.forEach((k, i) => { o[k] = r[i] === undefined ? '' : String(r[i]); }); return o;
  }
  async appendRows(tab, objs) {
    const h = await this.headers(tab);
    for (const o of objs) this.tabs[tab].push(h.map(k => String(cellValue(tab, k, o[k]))));
    this.writes += objs.length;
  }
  async updateRow(tab, rowNo, patch) {
    const h = await this.headers(tab); const r = this.tabs[tab][rowNo - 1];
    for (const [k, v] of Object.entries(patch)) { const i = h.indexOf(k); if (i < 0) throw new SchemaError(`ไม่พบคอลัมน์ ${k} ใน ${tab}`); r[i] = String(cellValue(tab, k, v)); }
    this.writes++;
  }
  async deleteRows(tab, rowNos) {
    for (const n of [...rowNos].sort((a, b) => b - a)) this.tabs[tab].splice(n - 1, 1);
    this.writes += rowNos.length;
  }
  async fetchPhoto() {
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#dfe8f7"/><text x="160" y="95" text-anchor="middle" font-size="16" fill="#12337a">รูปตัวอย่าง</text></svg>', { headers: { 'content-type': 'image/svg+xml' } });
  }
  async uploadPhoto() { const id = `mem-${this.files.size + 1}`; this.files.set(id, true); return { fileId: id, folderId: 'mem-folder' }; }
}

// ---------------- Google Sheets ----------------
let tokenCache = { token: '', exp: 0, scope: '' };

const b64u = buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b64uStr = s => b64u(new TextEncoder().encode(s));

async function importKey(pem) {
  const body = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', bin, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export async function googleAccessToken(env, scope) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.scope === scope && tokenCache.exp - 60 > now) return tokenCache.token;
  if (!env.GOOGLE_SA_EMAIL || !env.GOOGLE_SA_KEY) throw new SchemaError('ยังไม่ได้ตั้งค่า GOOGLE_SA_EMAIL / GOOGLE_SA_KEY (secrets)');
  const head = b64uStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64uStr(JSON.stringify({ iss: env.GOOGLE_SA_EMAIL, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const key = await importKey(env.GOOGLE_SA_KEY);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64u(sig)}` }) });
  if (!r.ok) throw new Error(`google token ${r.status}`);
  const j = await r.json();
  tokenCache = { token: j.access_token, exp: now + (j.expires_in || 3600), scope };
  return j.access_token;
}

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';

export class SheetsStore {
  constructor(env) {
    this.env = env; this.mode = 'sheets'; this.id = env.SPREADSHEET_ID;
    this._headers = new Map(); this._sheetIds = null;
    if (!this.id) throw new SchemaError('ไม่ได้ตั้งค่า SPREADSHEET_ID');
  }
  async _fetch(path, init = {}, base = 'https://sheets.googleapis.com/v4/spreadsheets') {
    const token = await googleAccessToken(this.env, SCOPE);
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`${base}/${this.id}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });
      if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise(s => setTimeout(s, 400 * 2 ** attempt)); continue; }
      return r;
    }
  }
  async _json(path, init) {
    const r = await this._fetch(path, init);
    if (!r.ok) throw new Error(`sheets ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
  }
  _q(tab) { return encodeURIComponent(`'${tab}'`); }
  async headers(tab) {
    if (this._headers.has(tab)) return this._headers.get(tab);
    const j = await this._json(`/values/${this._q(tab)}!1:1`);
    const h = (j.values && j.values[0]) || [];
    const chk = checkHeaders(tab, h);
    if (!chk.ok) throw new SchemaError(`แท็บ ${tab} ขาดคอลัมน์: ${chk.missing.join(', ')}`);
    this._headers.set(tab, h);
    return h;
  }
  // Raw pass-through of the Google response body (no JSON parsing in the Worker: free-plan CPU is tiny).
  async batchGetRaw(tabs) {
    const qs = tabs.map(t => `ranges=${this._q(t)}`).join('&');
    return this._fetch(`/values:batchGet?${qs}&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`);
  }
  async table(tab) { await this.headers(tab); const j = await this._json(`/values/${this._q(tab)}`); return rowsToObjects(j.values || []); }
  async batchGet(tabs) { const r = await this.batchGetRaw(tabs); if (!r.ok) throw new Error(`sheets ${r.status}`); return r.json(); }
  async headerRows(tabs) {
    const qs = tabs.map(t => `ranges=${this._q(t)}!1:1`).join('&');
    const j = await this._json(`/values:batchGet?${qs}`);
    return tabs.map((t, i) => ({ tab: t, header: (j.valueRanges[i].values || [[]])[0] || [] }));
  }
  async column(tab, header) {
    const h = await this.headers(tab); const i = h.indexOf(header); const L = colLetter(i);
    const j = await this._json(`/values/${this._q(tab)}!${L}2:${L}?majorDimension=COLUMNS`);
    const col = (j.values && j.values[0]) || [];
    return col.map(v => (v === undefined || v === null ? '' : String(v)));
  }
  async getRow(tab, rowNo) {
    const h = await this.headers(tab); const L = colLetter(h.length - 1);
    const j = await this._json(`/values/${this._q(tab)}!A${rowNo}:${L}${rowNo}`);
    const r = (j.values && j.values[0]) || []; const o = {};
    h.forEach((k, i) => { o[k] = r[i] === undefined ? '' : String(r[i]); }); return o;
  }
  async appendRows(tab, objs) {
    if (!objs.length) return;
    const h = await this.headers(tab);
    const values = objs.map(o => h.map(k => cellValue(tab, k, o[k])));
    await this._json(`/values/${this._q(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values }) });
  }
  async updateRow(tab, rowNo, patch) {
    const h = await this.headers(tab);
    const data = Object.entries(patch).map(([k, v]) => {
      const i = h.indexOf(k); if (i < 0) throw new SchemaError(`ไม่พบคอลัมน์ ${k} ใน ${tab}`);
      return { range: `'${tab}'!${colLetter(i)}${rowNo}`, values: [[cellValue(tab, k, v)]] };
    });
    await this._json('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
  }
  async _sheetId(tab) {
    if (!this._sheetIds) {
      const j = await this._json('?fields=sheets.properties(sheetId,title)');
      this._sheetIds = Object.fromEntries(j.sheets.map(s => [s.properties.title, s.properties.sheetId]));
    }
    return this._sheetIds[tab];
  }
  async deleteRows(tab, rowNos) {
    if (!rowNos.length) return;
    const sheetId = await this._sheetId(tab);
    const requests = [...rowNos].sort((a, b) => b - a).map(n => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: n - 1, endIndex: n } } }));
    await this._json(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
  }
  async fetchPhoto(fileId) {
    const token = await googleAccessToken(this.env, SCOPE);
    return fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` } });
  }
  async uploadPhoto({ base64, mime, name, parent }) {
    const folder = parent || this.env.DRIVE_FOLDER_ID;
    if (!folder) return { fileId: '', folderId: '' };
    const token = await googleAccessToken(this.env, SCOPE);
    const boundary = 'crm' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name, parents: [folder] });
    const bin = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const enc = new TextEncoder();
    const pre = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
    const post = enc.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(pre.length + bin.length + post.length);
    body.set(pre, 0); body.set(bin, pre.length); body.set(post, pre.length + bin.length);
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` }, body });
    if (!r.ok) throw new Error(`drive ${r.status}`);
    return { fileId: (await r.json()).id, folderId: folder };
  }
}
