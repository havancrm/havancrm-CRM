import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { bridgeRequest, verifyAppsScriptIdentity } from '../../src/server/apps-script.js';
import { authenticate } from '../../src/server/auth.js';

const secret = 'test-only-secret-with-at-least-32-bytes';
const origin = 'https://staging-crm.havan-crm.workers.dev';
const email = 'test@example.invalid';
const mac = value => createHmac('sha256', secret).update(value).digest();
const properties = { getScriptProperties: () => ({ getProperty: () => secret }) };
const utilities = {
  computeHmacSha256Signature: value => [...mac(value)],
  base64EncodeWebSafe: value => Buffer.from(value).toString('base64url'),
};
const scriptFile = name => readFileSync(new URL('../../integrations/apps-script/' + name + '.gs', import.meta.url), 'utf8');

test('Apps Script signs the visiting Google account for the selected CRM origin', async () => {
  const login = runInNewContext(scriptFile('login') + '\n;doGet', {
    Session: { getActiveUser: () => ({ getEmail: () => email }) },
    PropertiesService: properties, Utilities: utilities,
    HtmlService: { createHtmlOutput: html => html },
  });
  const state = '47bb3cb1-25f3-49f8-8c4a-53e87f499840';
  const html = login({ parameter: { origin, state } });
  const token = html.match(/#crm-login=([^&]+)/)[1];
  assert.equal(await verifyAppsScriptIdentity(token, secret, origin), email);
  assert.equal(await verifyAppsScriptIdentity(token, secret, 'https://crm.havan-crm.workers.dev'), '');
  assert.equal(await verifyAppsScriptIdentity(token, secret, origin, Date.now() + 5 * 3600_000), '');
  assert.equal(await verifyAppsScriptIdentity(token.slice(0, -1) + 'z', secret, origin), '');
  assert.doesNotMatch(login({ parameter: { origin: 'https://example.invalid', state } }), /#crm-login=/);
  const request = new Request(origin + '/api/me', { headers: { authorization: 'Bearer ' + token } });
  const env = { AUTH_MODE: 'apps_script', CRM_LOGIN_SECRET: secret };
  await assert.rejects(() => authenticate(request, env, { table: async () => [] }), { status: 403 });
  const account = await authenticate(request, env, { table: async () => [{ email, role: 'admin', active: 'TRUE' }] });
  assert.equal(account.email, email);
  assert.equal(account.isAdmin, true);
});

test('bridge verifies signed requests and streams their original status and JSON', async t => {
  const calls = [];
  const doPost = runInNewContext(scriptFile('bridge') + '\n;doPost', {
    PropertiesService: properties, Utilities: utilities,
    ScriptApp: { getOAuthToken: () => 'test-google-token' },
    UrlFetchApp: { fetch: (url, options) => {
      calls.push({ url, options });
      return { getResponseCode: () => 429, getContentText: () => '{"error":"test rate limit"}' };
    } },
    ContentService: { MimeType: { TEXT: 'text' }, createTextOutput: body => ({ setMimeType: () => body }) },
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://script.google.com/macros/s/test/exec');
    const text = doPost({ postData: { contents: options.body } });
    const chunks = [text.slice(0, 2), text.slice(2, 7), text.slice(7)];
    return new Response(new ReadableStream({ start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    } }));
  });
  const env = { CRM_BRIDGE_URL: 'https://script.google.com/macros/s/test/exec', CRM_BRIDGE_SECRET: secret };
  const request = { kind: 'sheets', method: 'GET', path: "/values:batchGet?ranges='customers'&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE" };
  const r = await bridgeRequest(env, request);
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), { error: 'test rate limit' });
  assert.match(calls[0].url, /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/1KbM5G_/);
  const rejected = await bridgeRequest({ ...env, CRM_BRIDGE_SECRET: secret + 'wrong' }, request);
  assert.equal(rejected.status, 403);
  const arbitrary = await bridgeRequest(env, { ...request, path: '/../../../3rd-resource' });
  assert.equal(arbitrary.status, 403);
  assert.equal(calls.length, 1);
});
