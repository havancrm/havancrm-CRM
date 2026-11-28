const enc = new TextEncoder();
const dec = new TextDecoder();
const keys = new Map();

function signingKey(secret) {
  if (!keys.has(secret)) {
    if (keys.size >= 8) keys.clear();
    keys.set(secret, crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
  }
  return keys.get(secret);
}

const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

export async function verifyAppsScriptIdentity(token, secret, origin, now = Date.now()) {
  if (!secret || secret.length < 32) return '';
  const parts = token.match(/^([A-Za-z0-9_-]{1,2000})\.([a-f0-9]{64})$/);
  if (!parts) return '';
  const [, payload, signature] = parts;
  const bytes = Uint8Array.from(signature.match(/../g), value => parseInt(value, 16));
  if (!await crypto.subtle.verify('HMAC', await signingKey(secret), bytes, enc.encode('crm-login-v1.' + payload))) return '';
  try {
    const claims = JSON.parse(dec.decode(Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));
    if (!Number.isInteger(claims.exp) || now >= claims.exp || claims.exp > now + 8 * 3600_000 || claims.origin !== origin) return '';
    return /^[^\s@]+@[^\s@]+$/.test(claims.email || '') ? claims.email.toLowerCase() : '';
  } catch {
    return '';
  }
}

export function appsScriptUrl(value) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(value || '') ? value : '';
}

// The first four response bytes carry the original status. The Sheets JSON remains streamed.
export async function bridgeRequest(env, operation) {
  const url = appsScriptUrl(env.CRM_BRIDGE_URL);
  if (!url || !env.CRM_BRIDGE_SECRET || env.CRM_BRIDGE_SECRET.length < 32) throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมชีตผ่าน Apps Script');
  const body = JSON.stringify({ at: Date.now(), nonce: crypto.randomUUID(), ...operation });
  const signature = hex(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(env.CRM_BRIDGE_SECRET), enc.encode('crm-bridge-v1.' + body))));
  const upstream = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body, signature }) });
  if (!upstream.ok || !upstream.body) return new Response('Apps Script bridge unavailable', { status: 502 });
  const reader = upstream.body.getReader();
  let prefix = '';
  let first;
  while (prefix.length < 4) {
    const { value, done } = await reader.read();
    if (done) break;
    const take = Math.min(4 - prefix.length, value.length);
    prefix += dec.decode(value.subarray(0, take));
    if (take < value.length) first = value.subarray(take);
  }
  const code = /^[2-5][0-9]{2}\n$/.test(prefix) ? Number(prefix.slice(0, 3)) : 0;
  if (!code || [204, 205, 304].includes(code)) {
    await reader.cancel();
    return new Response('Invalid Apps Script bridge response', { status: 502 });
  }
  const stream = new ReadableStream({
    async pull(controller) {
      if (first) { controller.enqueue(first); first = null; return; }
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  return new Response(stream, { status: code, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
