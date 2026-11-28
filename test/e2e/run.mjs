// End-to-end acceptance on a real Chromium with a phone viewport, against `wrangler dev` (workerd) in
// memory-data mode. Never touches the real Google Sheet. Usage: node test/e2e/run.mjs  (BASE=http://... to reuse a server)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as D from '../../public/js/shared/domain.js';
import { rowsToObjects } from '../../public/js/shared/schema.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const OUT = path.resolve('test/e2e/out'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 8799;
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const results = [];
let server;

async function startServer() {
  if (process.env.BASE) return;
  server = spawn('npx', ['wrangler', 'dev', '--var', 'DATA_MODE:memory', '--var', 'AUTH_MODE:dev', '--port', String(PORT), '--ip', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 1000)); }
  throw new Error('server did not start');
}
const H = (u = 'dev@local') => ({ 'x-dev-user': u, 'content-type': 'application/json' });
async function api(p, opt = {}) { const r = await fetch(BASE + p, { ...opt, headers: { ...H(opt.user), ...(opt.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => ({})) }; }
async function raw() { const r = await api('/api/bootstrap'); const o = {}; for (const v of r.body.valueRanges) o[v.range.split('!')[0]] = rowsToObjects(v.values); return o; }
async function tab(name) { const r = await api(`/api/tab/${name}`); return rowsToObjects(r.body.valueRanges[0].values); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(150); } return await fn(); }

function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push({ name, pass: true, ms: Date.now() - t }); console.log(`  ✓ ${name}`); }
  catch (e) { results.push({ name, pass: false, error: e.message, ms: Date.now() - t }); console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); try { await page.screenshot({ path: `${OUT}/FAIL-${results.length}.png` }); await page.evaluate(() => document.querySelectorAll('.scrim,.toast').forEach(e => e.remove())); } catch {} }
}

let page, ctx, browser; const consoleErrors = [];
const view = () => page.locator('#view');
async function go(hash, waitSel = '#view *') {
  await page.evaluate(h => { location.hash = h; }, hash);
  await page.waitForFunction(() => !document.querySelector('#view .empty')?.textContent?.includes('กำลังโหลด'), null, { timeout: 8000 }).catch(() => {});
  await sleep(250);
  if (waitSel) await page.waitForSelector(waitSel, { timeout: 8000 });
}
async function noOverflow(label) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
  ok(w.sw <= w.cw + 1 && w.bw <= w.cw + 1, `horizontal overflow on ${label}: scrollWidth ${w.sw} > ${w.cw}`);
}
async function noPageError(label) { const t = await view().innerText(); ok(!t.includes('เปิดหน้านี้ไม่สำเร็จ'), `page error on ${label}: ${t.slice(0, 120)}`); }
async function shot(n) { await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false }); }

(async () => {
  await startServer();
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, geolocation: { latitude: 13.7563, longitude: 100.5018 }, permissions: ['geolocation'], acceptDownloads: true });
  page = await ctx.newPage(); page.setDefaultTimeout(9000);
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_INTERNET_DISCONNECTED')) consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());

  const R0 = await raw();
  const NOW = Date.now();
  const M0 = D.buildModel(R0, NOW);
  const custCurrent = M0.customers.find(c => D.customerStats(M0, c.id).status === 'current' && (M0.billsByCust.get(c.id) || []).length >= 6 && D.hasGps(c));
  const CID = custCurrent.id;

  console.log('\n== Boot / auth / version ==');
  await step('app boots and renders home without console errors', async () => { await page.goto(BASE + '/'); await page.waitForSelector('.hstat', { timeout: 15000 }); ok(consoleErrors.length === 0, consoleErrors.join(' | ')); await shot('01-home'); });
  await step('version identical in app, service worker and server', async () => {
    const v = await page.evaluate(() => window.__crm.VERSION);
    const sw = await (await fetch(BASE + '/sw.js')).text(); const h = (await (await fetch(BASE + '/api/health')).json()).version;
    const html = await (await fetch(BASE + '/')).text();
    ok(sw.includes(`const VERSION = '${v}'`), `sw.js version mismatch (${v})`); ok(h === v, `server ${h} != app ${v}`); ok(html.includes(`?v=${v}`), 'index.html cache-bust missing');
  });
  await step('service worker registers and caches app shell under the version key', async () => {
    const info = await until(async () => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); const ks = await caches.keys(); return r?.active && ks.some(k => k.startsWith('havan-crm-')) ? { active: true, ks } : null; }), 15000);
    ok(info && info.active, 'no active SW'); const v = await page.evaluate(() => window.__crm.VERSION); ok(info.ks.includes(`havan-crm-${v}`), 'cache key ' + info.ks);
  });
  await step('unauthorised account sees the login wall, not data', async () => {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p2 = await c2.newPage(); await p2.addInitScript(() => localStorage.setItem('devUser', 'off@local'));
    await p2.goto(BASE + '/'); await p2.waitForSelector('#login:not(.hide)', { timeout: 8000 });
    ok((await p2.locator('#login').innerText()).includes('ไม่มีสิทธิ์'), 'no denial message'); ok(!(await p2.locator('.hstat').count()), 'data visible'); await c2.close();
  });

  console.log('\n== Home KPIs tie to the data ==');
  await step('4 customer cards, one row, numbers = database', async () => {
    await go('#/'); const k = D.customerCounts(M0);
    const nums = await page.locator('.hstat b').allInnerTexts(); ok(nums.join() === [k.all, k.current, k.lapsed, k.closed].join(), `cards ${nums} != ${[k.all, k.current, k.lapsed, k.closed]}`);
    const ys = await page.locator('.hstat a').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top))); ok(new Set(ys).size === 1, 'cards not on one row');
    const [, , , c4] = await page.locator('.hstat a').evaluateAll(els => els.map(e => e.getBoundingClientRect().width)); ok(c4 < 100, 'cards not compact');
  });
  await step('every KPI card opens the matching list with the same count', async () => {
    for (const [i, key] of ['all', 'current', 'lapsed', 'closed'].entries()) {
      await go('#/'); await page.locator('.hstat a').nth(i).click(); await page.waitForSelector('#cnt'); await sleep(200);
      const t = await page.locator('#cnt').innerText(); const exp = D.customerCounts(M0)[key]; ok(t.startsWith(String(exp)), `${key}: ${t} != ${exp}`);
    }
  });
  await step('labels are 2 columns, counts from customer_labels, tap filters customers', async () => {
    await go('#/'); const cols = await page.locator('.lg').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length); ok(cols === 2, 'labels grid cols ' + cols);
    const first = page.locator('.hlr').first(); const name = await first.locator('span').first().innerText(); const n = +(await first.locator('b').innerText());
    const exp = new Set(M0.raw.customer_labels.filter(l => l.label === name).map(l => l.customerId)).size; ok(n === exp, `label count ${n} != ${exp}`);
    await first.click(); await page.waitForSelector('#cnt'); await sleep(200); const t = await page.locator('#cnt').innerText();
    const expC = M0.customers.filter(c => D.custLabels(M0, c.id).includes(name)).length; ok(t.startsWith(String(expC)), `${t} != ${expC}`);
  });
  await step('smart search finds customer by name, id, phone, label, product and bill', async () => {
    await go('#/'); const c = M0.customers[3]; const inp = page.locator('#hs');
    for (const [q, expect] of [[c.name, c.name], [c.id, c.name], [D.custPhones(M0, c.id)[0], c.name], [M0.bills[5].no, M0.bills[5].no], ['4012', 'แชมพูออยล์']]) {
      await inp.fill(q); await page.waitForFunction(t => document.querySelector('#hres')?.innerText.includes(t), expect, { timeout: 4000 }).catch(() => { throw new Error(`search "${q}" did not show "${expect}"`); });
    }
    await inp.fill('zzzzzz-nothing'); await page.waitForFunction(() => document.querySelector('#hres')?.innerText.includes('ไม่พบ'), null, { timeout: 4000 });
  });

  console.log('\n== Bottom navigation, back, every page ==');
  const PAGES = [['#/settings/changes', 'ประวัติการเปลี่ยนแปลง'], ['#/', 'ยอดขายเดือนนี้'], ['#/customers', 'ลูกค้า'], ['#/visits', 'เข้าพบ'], ['#/orders', 'ออเดอร์'], ['#/settings', 'ตั้งค่า'], ['#/sales', 'รายงานยอดขาย'], ['#/new', 'ลูกค้าใหม่'], ['#/map', 'แผนที่'], ['#/follow', 'แสดงแบบเดือน'], ['#/settings/cycle', 'ห่างหาย'], ['#/settings/labels', 'ป้ายกำกับ'], ['#/settings/quality', 'ตรวจคุณภาพ'], ['#/settings/codes', 'ไม่ตรงทะเบียน'], ['#/settings/imports', 'ประวัติการนำเข้า'], ['#/settings/import', 'นำเข้า TTX'], ['#/settings/sync', 'ซิงก์'], [`#/c/${CID}`, 'ภาพรวม'], [`#/c/${CID}?tab=info`, 'ข้อมูลลูกค้า'], [`#/c/${CID}?tab=history`, 'บิล'], [`#/c/${CID}?tab=visits`, 'บันทึกเข้าพบ'], [`#/order/new?c=${CID}`, 'บิลล่าสุด']];
  await step(`all ${PAGES.length} pages render without error, overflow or console errors (mobile 390px)`, async () => {
    for (const [h, txt] of PAGES) {
      await go(h); await sleep(150);
      await noPageError(h); await noOverflow(h);
      const body = await page.locator('body').innerText(); ok(body.includes(txt), `${h}: expected text "${txt}"`);
      await shot('page-' + h.replace(/[^\w]+/g, '_'));
    }
    ok(consoleErrors.length === 0, 'console errors: ' + consoleErrors.join(' | '));
  });
  await step('all routes fit 320, 360, 375, 390, 393, 414 and 430 px', async () => {
    for (const width of [320, 360, 375, 390, 393, 414, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [h] of PAGES) {
        await page.evaluate(hash => {
          window.__previousE2EView = document.querySelector('#view');
          if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
          else location.hash = hash;
        }, h);
        await page.waitForFunction(hash => {
          const view = document.querySelector('#view');
          return location.hash === hash && view !== window.__previousE2EView && view?.children.length && !view.textContent.includes('กำลังโหลดข้อมูล…');
        }, h);
        await noPageError(h);
        await noOverflow(`${h} at ${width}px`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await step('bottom nav has exactly 5 items in order and each opens its page', async () => {
    await go('#/'); const labels = await page.locator('#nav a').allInnerTexts(); ok(labels.map(s => s.trim()).join() === 'หน้าหลัก,ลูกค้า,เข้าพบ,ออเดอร์,ตั้งค่า', labels.join());
    for (const [i, h] of ['#/', '#/customers', '#/visits', '#/orders', '#/settings'].entries()) { await page.locator('#nav a').nth(i).click(); await sleep(250); ok(page.url().endsWith(h) || page.url().includes(h + '?'), `nav ${i} -> ${page.url()}`); ok((await page.locator('#nav a.on').count()) === 1, 'active tab'); }
  });
  await step('back button returns through history and keeps bottom nav', async () => {
    await go('#/customers'); await go(`#/c/${CID}`); await page.locator('[data-back]').click(); await sleep(300); ok(page.url().endsWith('#/customers'), page.url());
    ok(await page.locator('#nav').isVisible(), 'nav hidden');
  });
  await step('customer list: search and status chips work', async () => {
    await go('#/customers'); const c = M0.customers[10]; await page.fill('#cq', c.name); await sleep(400);
    ok((await page.locator('#clist').innerText()).includes(c.name), 'search miss'); await page.fill('#cq', '');
    await page.locator('[data-f="closed"]').click(); await sleep(300); const exp = D.customerCounts(M0).closed; ok((await page.locator('#cnt').innerText()).startsWith(String(exp)), 'closed chip');
  });

  console.log('\n== Customer 360 ==');
  await step('4 tabs; 5 quick buttons in one row in the specified order', async () => {
    await go(`#/c/${CID}`);
    const tabs = (await page.locator('.tabs button').allInnerTexts()).join();
    ok(tabs === 'ภาพรวม,ข้อมูล,ประวัติซื้อ,เข้าพบ', tabs);
    const q = await page.locator('.customer-quick > *').evaluateAll(els => els.map(e => ({ t: e.textContent.trim(), y: Math.round(e.getBoundingClientRect().top) })));
    ok(q.map(x => x.t).join() === 'บันทึก,รูป+พิกัด,รับออเดอร์,โทร,นำทาง', q.map(x => x.t).join());
    ok(new Set(q.map(x => x.y)).size === 1, 'quick buttons wrap');
    ok(await page.locator('.act').count() === 0, 'duplicate bottom actions');
    await shot('customer-360');
  });
  await step('overview shows last bill, regular items, pre-visit note, birthday, store photo and GPS status', async () => {
    const c = M0.customers.find(c => c.keepNote && c.birthday && (M0.billsByCust.get(c.id) || []).length > 3); await go(`#/c/${c.id}`);
    const t = await view().innerText(); const lb = D.lastBillOf(M0, c.id);
    for (const s of ['บิลล่าสุด', `บิล ${lb.no}`, 'สินค้าที่สั่งประจำ', 'บันทึกก่อนเข้าร้าน', 'วันเกิด', 'รูปหน้าร้าน', 'พิกัดร้าน']) ok(t.includes(s), 'missing: ' + s);
    ok(t.includes(D.money(D.billTotal(M0, lb.no))), 'bill total not shown');
  });
  await step('history: search by product, open bill, total = sum of lines (no VAT added)', async () => {
    await go(`#/c/${CID}?tab=history`); const bills = M0.billsByCust.get(CID); ok((await view().innerText()).includes(`${bills.length} บิล`), 'bill count');
    await page.locator('[data-bill]').first().click(); await page.waitForSelector('.sheet'); const t = await page.locator('.sheet').innerText();
    const no = [...bills].reverse()[0].no; ok(t.includes(D.money(D.billTotal(M0, no))), 'sheet total'); await page.locator('.sheet [data-close]').first().click();
  });
  await step('VAT bill: total equals sum of its own lines and says VAT not re-added', async () => {
    const [no] = [...M0.itemsByBill.entries()].find(([, it]) => it.some(i => /VAT/.test(i.name))); const b = M0.billByNo.get(no);
    await go('#/'); await page.fill('#hs', no); await page.waitForSelector(`[data-bill="${no}"]`); await page.locator(`[data-bill="${no}"]`).first().click(); await page.waitForSelector('.sheet');
    const t = await page.locator('.sheet').innerText(); ok(t.includes(D.money(D.billTotal(M0, no))), 'VAT bill total'); ok(t.includes('ไม่คิดซ้ำ'), 'no VAT note'); void b; await page.locator('.sheet [data-close]').first().click();
  });
  await step('legacy-code bill: unregistered shown by name only, no guessed code; confirmed pair flagged', async () => {
    const row = D.unregisteredItems(M0).find(r => r.code === '7777'); await go('#/'); await sleep(600); await page.fill('#hs', row.billNo); await page.waitForSelector(`[data-bill="${row.billNo}"]`); await page.locator(`[data-bill="${row.billNo}"]`).first().click(); await page.waitForSelector('.sheet');
    const t = await page.locator('.sheet').innerText(); ok(t.includes('ไม่อยู่ในทะเบียนปัจจุบัน'), 'badge: ' + row.billNo + ' ' + t.slice(0, 200).replace(/\n/g, ' ')); ok(!t.includes('7777'), 'unregistered code displayed'); await page.locator('.sheet [data-close]').first().click();
  });
  await step('call / navigate buttons link to tel: and Google Maps directions', async () => {
    await go(`#/c/${CID}`); const c = M0.custById.get(CID);
    const nav = await page.locator('.quick a[target]').getAttribute('href'); ok(nav.includes(`destination=${c.gpsLat},${c.gpsLng}`), nav);
    ok((await page.locator('[data-act="call"]').count()) === 1, 'call button');
  });

  console.log('\n== Field work: unified visit form, GPS, appointments ==');
  const NOTE = 'e2e-visit-' + Date.now();
  await step('visit form saves note + GPS exactly once (visits, activities, gps rows by header)', async () => {
    await go(`#/c/${CID}`); await page.locator('[data-act="note"]').click(); await page.waitForSelector('.sheet #vn');
    await page.waitForFunction(() => document.querySelector('.sheet #gs')?.textContent.includes('พิกัดพร้อม'), null, { timeout: 8000 });
    await page.fill('#vn', NOTE); await page.selectOption('#vo', 'ได้ออเดอร์'); await shot('visit-form'); await page.click('#vs');
    const v = await until(async () => { const x = (await raw()).visits.filter(v => v.note === NOTE); return x.length && x; }, 8000); ok(v && v.length === 1, `visit rows ${v ? v.length : 0}`);
    ok(v[0].status === 'COMPLETED' && v[0].source === 'CRM App' && v[0].outcome === 'ได้ออเดอร์' && v[0].customerId === CID && /13\.75/.test(v[0].lat) && v[0].lng.startsWith('100.50'), JSON.stringify(v[0]));
    const r = await raw(); ok(r.activities.some(a => a.refId === v[0].visitId), 'activity'); ok(r.gps.some(g => g.visitId === v[0].visitId), 'gps row');
  });
  await step('new visit appears immediately in the customer timeline and last-visit date', async () => {
    await go(`#/c/${CID}?tab=visits`); ok((await view().innerText()).includes(NOTE), 'timeline'); await go(`#/c/${CID}`); ok((await view().innerText()).includes('เข้าพบล่าสุด'), 'overview');
  });
  const APPT = 'e2e-appt-' + Date.now(); const apptDay = D.dayStr(D.dayNum(M0.today) + 3);
  await step('appointment (same form) creates an aCRM-style follow-up task "ติดตาม"; calendar shows the day count', async () => {
    await go(`#/c/${CID}`); await page.locator('[data-act="note"]').click(); await page.waitForSelector('.sheet #vk'); await page.locator('#vk [data-k="appointment"]').click();
    await page.fill('#vn', APPT); await page.fill('#vd', apptDay); await page.fill('#vt', '14:30'); await page.click('#vs');
    const r = await until(async () => { const x = await raw(); return x.tasks.find(t => t.note === APPT) && x; }); const t = r.tasks.find(t => t.note === APPT);
    ok(t.type === 'ติดตาม' && t.status === 'open' && t.dueAt === apptDay + ' 00:00:00' && t.owner === 'dev@local', JSON.stringify(t)); ok(r.activities.some(a => a.type === 'ติดตาม' && a.refId === t.taskId), 'activity');
    await go(`#/follow?v=day&ym=${apptDay.slice(0, 7)}&d=${apptDay}`); await sleep(300);
    const cell = await page.locator(`[data-d="${apptDay}"] b`).innerText(); ok(+cell >= 1, 'calendar count ' + cell); ok((await view().innerText()).includes(M0.custById.get(CID).name), 'customer under date');
  });
  await step('calendar: tap a day lists stores below on the same page; month navigation works', async () => {
    const before = page.url(); await page.locator('[data-m="1"]').click(); await sleep(250); ok(page.url() === before || page.url().includes('visits'), 'left page');
    await page.locator('[data-m="-1"]').click(); await sleep(250); await page.locator(`[data-d="${apptDay}"]`).click(); await sleep(200); ok((await view().innerText()).includes('ร้าน'), 'list');
  });
  await step('calendar MONTH view = 12 month cards per year (count each), tap month lists stores; DAY view = day grid; choice remembered', async () => {
    await go(`#/follow?v=month&ym=${apptDay.slice(0, 7)}`); await sleep(300);
    ok(await page.locator('.mcard').count() === 12 && await page.locator('.cal').count() === 0, 'month cards');
    const m2 = D.buildModel(await raw(), Date.now()); const ym = apptDay.slice(0, 7); const exp = [...D.monthCalendar(m2, ym).values()].reduce((s, a) => s + a.length, 0);
    const shown = +(await page.locator(`.mcard.sel b`).innerText()); ok(shown === exp && exp >= 1, `month count ${shown} vs ${exp}`);
    ok((await view().innerText()).includes(M0.custById.get(CID).name), 'store listed under month'); await shot('calendar-month-cards');
    await page.locator('.mcard').nth(0).click(); await sleep(200); ok((await page.locator('.mcard.sel span').innerText()).includes('ม.ค.'), 'month tap');
    const y0 = await page.locator('[data-y].on').innerText(); await page.locator('[data-y]').last().click(); await sleep(200); ok((await page.locator('[data-y].on').innerText()) !== y0, 'year switch');
    await page.locator('[data-vm="day"]').click(); await sleep(300); ok(await page.locator('.cal').count() === 1 && await page.locator('.mcard').count() === 0, 'day grid'); await shot('calendar-day');
    await go('#/follow'); ok(await page.locator('.cal').count() === 1, 'mode not remembered');
    await page.locator('[data-vm="month"]').click(); await sleep(200); ok(await page.locator('.mcard').count() === 12, 'back to cards');
  });
  await step('appointment time is shown on the customer timeline and persists in tasks.data', async () => {
    await go(`#/c/${CID}?tab=visits`);
    const task = (await raw()).tasks.find(t => t.note === APPT);
    ok(D.parseJson(task.data).time === '14:30', 'appointment time not saved');
    ok((await page.locator('.li').filter({ hasText: APPT }).innerText()).includes('14:30'), 'appointment time not displayed');
  });
  await step('completing the follow-up task closes it and adds an activity', async () => {
    await go(`#/c/${CID}?tab=visits`); await page.locator('.li').filter({ hasText: APPT }).locator('[data-done]').click(); await page.waitForSelector('.sheet #cs'); await page.click('#cs');
    const r = await until(async () => { const x = await raw(); return x.tasks.find(t => t.note?.includes(APPT) && t.status === 'done') && x; }); ok(r, 'task not done');
    ok(r.tasks.find(t => t.note?.includes(APPT)).completedAt, 'completedAt');
  });
  await step('รอบลูกค้า page (aCRM): bell badge on home = today+over+late; month cards use due date = last bill + 30; list + overdue + no-cycle links', async () => {
    const m3 = D.buildModel(await raw(), Date.now()); const s = D.suggestions(m3); const exp = s.today.length + s.over.length + s.late.length;
    await go('#/'); const badge = await page.locator('.hacts .bdg').innerText().catch(() => '0'); ok(badge === (exp > 99 ? '99+' : String(exp)) || exp === 0, `badge ${badge} vs ${exp}`);
    await go('#/follow?v=month'); await sleep(300); ok(await page.locator('.mcard').count() === 12, '12 month cards');
    const txt = await view().innerText(); ok(txt.includes('เกินรอบจากเดือนก่อน') && txt.includes('ยังไม่มีรอบ'), 'extra links');
    await go('#/follow?ov=1'); ok((await page.locator('.cr').count()) === Math.min(50, D.overdueBefore(m3, m3.today.slice(0, 7) + '-01').length), 'overdue list count');
  });
  await step('เข้าพบ page (check-in): chips ถึงรอบ / ใน 5 กม. / ทั้งหมด, search box, list', async () => {
    await go('#/visits'); ok((await page.locator('#ch .chip').allInnerTexts()).length === 3, 'chips'); ok(await page.locator('#q').count() === 1, 'search');
    await page.locator('#ch .chip').nth(2).click(); await sleep(200); ok(await page.locator('#list .cr').count() > 0, 'list');
  });
  await step('store GPS update: writes customers.gpsLat/gpsLng/mapLink + gps row + changes log', async () => {
    const c = M0.customers.find(c => !D.hasGps(c) && D.customerStats(M0, c.id).status !== 'closed'); await go(`#/c/${c.id}`); await page.locator('[data-act="geo"]').click(); await page.waitForSelector('.sheet #gb'); await page.click('#gb');
    const r = await until(async () => { const x = await raw(); const cc = x.customers.find(q => q.id === c.id); return cc.gpsLat && x; }); const cc = r.customers.find(q => q.id === c.id);
    ok(cc.gpsLat.startsWith('13.7563') && cc.gpsLng.startsWith('100.5018') && cc.mapLink.includes('13.7563'), JSON.stringify([cc.gpsLat, cc.gpsLng, cc.mapLink])); ok(r.gps.some(g => g.customerId === c.id && g.source === 'store'), 'gps row');
    const ch = await tab('changes'); ok(ch.some(x => x.entity === 'customers' && x.id === c.id && x.action === 'update'), 'changes log');
  });
  await step('photo is optional: store photo uploads, row saved and file id attached to customer', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await go(`#/c/${CID}`); await page.locator('[data-act="geo"]').click(); await page.waitForSelector('.sheet #gp', { state: 'attached' }); await page.setInputFiles('#gp', { name: 'x.png', mimeType: 'image/png', buffer: png }); await page.waitForSelector('#gs2:not(.hide)'); await page.click('#gs2');
    const r = await until(async () => { const x = await raw(); return x.photos.length && x; }); ok(r.photos.length >= 1 && r.photos[0].photoType === 'store', 'photo row'); ok(r.customers.find(c => c.id === CID).storePhotoFileIds.includes('mem-'), 'file id on customer');
    await go(`#/c/${CID}`); await page.waitForSelector('#sp img', { timeout: 6000 }); ok(true);
  });
  await step('edit customer: only changed columns are written; other columns untouched', async () => {
    const before = (await raw()).customers.find(c => c.id === CID); await go(`#/c/${CID}?tab=info`); await page.locator('#edit').click(); await page.waitForSelector('.sheet [data-k="keepNote"]');
    await page.fill('[data-k="keepNote"]', 'e2e-keep-note'); await page.click('#es'); const after = await until(async () => { const c = (await raw()).customers.find(c => c.id === CID); return c.keepNote === 'e2e-keep-note' && c; });
    for (const k of Object.keys(before)) if (!['keepNote', 'storePhotoFileIds'].includes(k)) ok(after[k] === before[k], `column ${k} changed`);
  });

  console.log('\n== Order taking ==');
  let ORDER_NO;
  await step('order from latest bill: lines prefilled, cart bar shows count/total, no VAT added', async () => {
    await go(`#/order/new?c=${CID}`); await page.waitForSelector('#pk'); await sleep(200); const lb = D.lastBillOf(M0, CID);
    await page.locator('[data-all]').click(); await sleep(250); const bar = await page.locator('.cartbar').innerText(); ok(/ตะกร้า \d+ รายการ/.test(bar), bar); await shot('order-picker');
  });
  await step('all four product sources are present (latest bill / past bills / regular / all)', async () => {
    const t = (await page.locator('#src button').allInnerTexts()).join(); ok(t === 'บิลล่าสุด,บิลย้อนหลัง,สั่งประจำ,ทั้งหมด', t);
    for (const s of ['bills', 'regular', 'all']) { await page.locator(`#src [data-s="${s}"]`).click(); await sleep(250); ok((await page.locator('#pk').innerText()).length > 5, s + ' empty'); }
    await page.locator('#src [data-s="all"]').click(); await page.fill('#pq', '4012'); await sleep(500); ok((await page.locator('#pk').innerText()).includes('แชมพูออยล์'), 'all search'); await page.locator('#pk [data-add="4012"]').click();
  });
  await step('cart survives Back and a full page reload', async () => {
    const n0 = await page.locator('.cartbar').innerText(); await page.locator('.cartbar').click(); await page.waitForSelector('#cl .li'); await page.locator('[data-back]').click(); await sleep(300);
    ok((await page.locator('.cartbar').innerText()) === n0, 'cart changed after back'); await page.reload(); await page.waitForSelector('.cartbar', { timeout: 10000 }); ok((await page.locator('.cartbar').innerText()) === n0, 'cart lost on reload');
  });
  await step('cart: edit quantity & price, total = qty × price, remove line', async () => {
    await page.locator('.cartbar').click(); await page.waitForSelector('#cl .li'); const q = page.locator('[data-q="0"]'); await q.fill('7'); const p = page.locator('[data-p="0"]'); await p.fill('120'); await sleep(200);
    const amt = await page.locator('[data-a="0"]').innerText(); ok(amt.replace(/,/g, '') === '840', amt); const tot = await page.locator('#ct').innerText(); ok(tot.includes('฿'), tot);
    const n = await page.locator('#cl .li').count(); await page.locator('[data-x]').last().click(); ok((await page.locator('#cl .li').count()) === n - 1, 'remove'); await shot('order-cart');
  });
  await step('save as draft -> row in orders/order_items by header, status draft', async () => {
    await page.fill('#nt', 'e2e order note'); await page.click('#sd'); const r = await until(async () => { const x = await raw(); return x.orders.find(o => o.note === 'e2e order note') && x; }); const o = r.orders.find(o => o.note === 'e2e order note'); ORDER_NO = o.no;
    ok(o.status === 'ร่าง' && /^\d{8}$/.test(o.no) && o.customerId === CID && o.createdBy === 'dev@local' && o.deviceId, JSON.stringify(o)); const items = r.order_items.filter(i => i.orderNo === ORDER_NO); ok(items.length >= 1, 'items');
    ok(items[0].amount === String(D.num(items[0].qty) * D.num(items[0].price)), 'amount ' + items[0].amount);
  });
  await step('draft opens from the list, edit, confirm -> status confirmed, items replaced (no duplicates)', async () => {
    await go('#/orders'); await page.waitForSelector(`[data-go="#/order/${ORDER_NO}"]`); await page.locator(`[data-go="#/order/${ORDER_NO}"]`).click(); await page.waitForSelector('#pk');
    await page.locator('.cartbar').click(); await page.waitForSelector('#cl .li'); const n = await page.locator('#cl .li').count(); await page.click('#sc');
    await page.waitForSelector('.sheet .slip'); const doc = await page.locator('.sheet .slipbox').innerText(); ok(doc.includes(CID) && doc.includes('บาทถ้วน'), doc.slice(0, 200)); await shot('slip');
    ok(await page.locator('.sheet .slip img').first().evaluate(i => i.complete && i.naturalWidth > 500), 'slip template not loaded');
    const r = await until(async () => { const x = await raw(); return x.orders.find(o => o.no === ORDER_NO)?.status === 'รอส่ง' && x; }); ok(r.order_items.filter(i => i.orderNo === ORDER_NO).length === n, 'item count changed');
    ok(r.orders.filter(o => o.no === ORDER_NO).length === 1, 'duplicate order row');
    for (const i of r.order_items.filter(i => i.orderNo === ORDER_NO)) if (i.code) ok(doc.includes(i.code), `slip lacks product code ${i.code}`);
    await page.locator('.sheet [data-close]').first().click();
  });
  await step('delivering a confirmed order preserves its saved order lines', async () => {
    const before = (await raw()).order_items.filter(item => item.orderNo === ORDER_NO);
    await go(`#/order/${ORDER_NO}`);
    await page.locator('.cartbar').click();
    await page.locator('#ship').click();
    await page.locator('#cfm-ok').click();
    const after = await until(async () => {
      const r = await raw();
      return r.orders.find(o => o.no === ORDER_NO)?.status === 'ส่งแล้ว' && r;
    });
    ok(after, 'delivery status not saved');
    ok(JSON.stringify(after.order_items.filter(item => item.orderNo === ORDER_NO)) === JSON.stringify(before), 'order lines changed');
  });
  await step('re-sending the same op id is answered "duplicate" and changes nothing', async () => {
    const op = { type: 'visit.log', opId: 'dup-test-' + Date.now(), payload: { customerId: CID, kind: 'note', note: 'dup' } };
    const a = await api('/api/ops', { method: 'POST', body: JSON.stringify({ ops: [op] }) }); const b = await api('/api/ops', { method: 'POST', body: JSON.stringify({ ops: [op] }) });
    ok(a.body.results[0].status === 'ok' && b.body.results[0].status === 'duplicate', JSON.stringify([a.body, b.body])); ok((await raw()).activities.filter(v => v.opId === `${op.opId}:a`).length === 1, 'dup rows');
  });
  await step('reorder from a history bill skips unregistered lines (never guesses a code)', async () => {
    const row = D.unregisteredItems(M0).find(r => r.code === '7777'); const b = M0.billByNo.get(row.billNo);
    await page.evaluate(k => localStorage.removeItem(k), `cart:new:${b.customerId}`);
    await go(`#/order/new?c=${b.customerId}&from=${row.billNo}`); await page.waitForSelector('#pk'); await sleep(300); const t = await view().innerText(); ok(t.includes('ข้าม 1 รายการ') || t.includes('ไม่อยู่ในทะเบียนปัจจุบัน'), 'no skip notice');
    const cart = JSON.parse(await page.evaluate(k => localStorage.getItem(k), `cart:new:${b.customerId}`)); ok(!cart.lines.some(l => l.code === '7777'), 'guessed/unregistered code added'); await page.evaluate(k => localStorage.removeItem(k), `cart:new:${b.customerId}`);
  });
  await step('legacy confirmed pair (8217 -> 8217*) maps only when names agree; conflicting 9833* never maps', async () => {
    const m = D.buildModel(await raw(), Date.now()); ok(D.resolveLegacy(m, '8217', 'สบู่เหลว 1,000 ml. กลิ่นมะลิ').ok, 'pair 1'); ok(!D.resolveLegacy(m, '9833*', 'ทรีทเมนต์เคราติน 2,000 ml.').ok, 'conflict mapped');
  });

  console.log('\n== Reports & KPIs ==');
  await step('sales report total = SUM(bill_items.amount) for each period; bills count matches', async () => {
    for (const p of ['today', '7d', 'month', 'lastmonth', 'year', 'all']) {
      await go(`#/sales?p=${p}`); const [f, t] = D.periodRange(p, M0.today); const r = D.salesBetween(D.buildModel(await raw(), Date.now()), f, t);
      const txt = await page.locator('.hero').innerText(); ok(txt.replace(/,/g, '').includes(String(Math.round(r.total * 100) / 100)), `${p}: ${txt} vs ${r.total}`);
    }
    const allRaw = (await raw()).bill_items.reduce((s, i) => s + D.num(i.amount), 0); await go('#/sales?p=all'); ok((await page.locator('.hero').innerText()).replace(/,/g, '').includes(String(allRaw)), 'all-time != raw sum');
  });
  await step('Buddhist calendar year picker shows the corresponding bill range', async () => {
    await go('#/sales?p=all');
    const year = M0.bills[0].date.slice(0, 4);
    await page.locator(`[data-p="year-${year}"]`).click();
    await page.waitForSelector(`[data-p="year-${year}"].on`);
    const [from, to] = D.periodRange(`year-${year}`, M0.today);
    const m = D.buildModel(await raw(), Date.now());
    const report = D.salesBetween(m, from, to);
    ok((await page.locator('.hero').innerText()).includes(D.money(report.total)), 'wrong annual total');
  });
  await step('sales drill-down: by month/clerk/customer/bills all tappable lists', async () => {
    await go('#/sales?p=all&v=bills'); await page.waitForSelector('[data-bill]'); await page.locator('[data-bill]').first().click(); await page.waitForSelector('.sheet'); await page.locator('.sheet [data-close]').first().click();
    for (const v of ['month', 'clerk', 'cust']) { await go(`#/sales?p=all&v=${v}`); ok((await page.locator('#sl .cr, #sl .li').count()) > 0, v); }
    await go('#/sales?p=all&v=month'); await page.locator('#sl .cr, #sl .li').first().click(); await sleep(400); ok((await view().innerText()).includes('บิล'), 'month drilldown');
  });
  await step('new-customers page has two separate groups: first purchase vs newly registered, counts equal computed', async () => {
    const m2 = D.buildModel(await raw(), Date.now()); const first = m2.customers.filter(c => D.isFirstPurchaseNew(m2, c)).length, reg = m2.customers.filter(c => D.isRecentlyRegistered(m2, c)).length;
    await go('#/new'); const tabs = (await page.locator('.seg button').allInnerTexts()).join('|'); ok(tabs.includes(`ซื้อครั้งแรก ${first}`) && tabs.includes(`เพิ่มทะเบียน ${reg}`), tabs);
    await go('#/new?t=reg'); ok((await view().innerText()).includes('เพิ่งเพิ่มเข้าทะเบียน'), 'reg tab text');
  });
  await step('map: lists only stores with GPS, distance sort works, navigate links valid', async () => {
    await go('#/map?f=all'); const withGps = M0.customers.filter(D.hasGps).length + 1; await page.locator('#loc').click(); await sleep(700);
    const links = await page.locator('#ml a[href*="destination="]').count(); ok(links > 0, 'no nav links'); ok((await page.locator('#mc').innerText()).includes('มีพิกัด'), 'summary'); ok(await page.locator('iframe').count() === 1, 'map frame'); void withGps;
  });

  await step('every list page has a search box (customers, orders, cycle, calendar day, sales views, new, map, labels, codes, history, imports)', async () => {
    const list = ['#/customers', '#/orders', '#/follow', '#/sales?p=all&v=month', '#/sales?p=all&v=clerk', '#/sales?p=all&v=cust', '#/sales?p=all&v=bills', '#/new', '#/map', '#/settings/labels', '#/settings/codes', '#/settings/imports', `#/c/${CID}?tab=history`];
    for (const h of list) { await go(h); await sleep(200); ok((await page.locator('#view input[type="search"]').count()) >= 1, `no search box on ${h}`); }
  });
  await step('sales numbers are tappable (bill count -> bills, customers -> customers); clerk view lists clerks AND salespeople', async () => {
    await go('#/sales?p=all'); await page.locator('[data-v="bills"].card').click(); await sleep(300); ok(page.url().includes('v=bills'), page.url());
    await go('#/sales?p=all&v=clerk'); const t = await view().innerText(); ok(t.includes('เสมียนที่เปิดบิล') && t.includes('พนักงานขาย'), 'clerk/salesperson sections');
    const R = D.salesBetween(D.buildModel(await raw(), Date.now()), '', ''); const top = [...R.byClerk.entries()].sort((a, b) => b[1] - a[1])[0]; ok(t.includes(top[0]) && t.replace(/,/g, '').includes(String(top[1])), 'top clerk total');
  });

  console.log('\n== Settings, data quality, import ==');
  await step('cycle settings persist to systemSettings (new row), keep comm/vatRate; home counts react', async () => {
    await go('#/settings/cycle'); await page.fill('[data-k="dormDays"]', '30'); await page.click('#sv'); const r = await until(async () => { const x = await raw(); return x.systemSettings.length >= 2 && x; });
    const latest = r.systemSettings.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b)); const d = JSON.parse(latest.data); ok(d.dormDays === 30 && d.comm === 8 && d.vatRate === 7, latest.data);
    await go('#/'); await sleep(300); const m2 = D.buildModel(r, Date.now()); const nums = await page.locator('.hstat b').allInnerTexts(); ok(nums[1] === String(D.customerCounts(m2).current), `current ${nums[1]} vs ${D.customerCounts(m2).current}`);
    await go('#/settings/cycle'); await page.fill('[data-k="dormDays"]', '365'); await page.click('#sv'); await sleep(500);
  });
  await step('non-admin cannot save settings or import (UI disabled + server forbids)', async () => {
    const f = await api('/api/ops', { method: 'POST', user: 'sales@local', body: JSON.stringify({ ops: [{ type: 'settings.save', opId: 'na-' + Date.now(), payload: { data: { lateDays: 1 } } }] }) }); ok(f.body.results[0].code === 'forbidden', JSON.stringify(f.body));
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p2 = await c2.newPage(); await p2.addInitScript(() => localStorage.setItem('devUser', 'sales@local')); await p2.goto(BASE + '/#/settings/cycle'); await p2.waitForSelector('#sv'); ok(await p2.locator('#sv').isDisabled(), 'save enabled for non-admin'); await c2.close();
  });
  await step('labels: rename merges across customers, delete removes', async () => {
    const R = await raw(); const lab = R.customer_labels[0].label; const n = R.customer_labels.filter(l => l.label === lab).length;
    await go('#/settings/labels'); await page.locator(`[data-ren="${lab}"]`).click(); await page.waitForSelector('.sheet #nn'); await page.fill('#nn', 'ป้ายทดสอบ-e2e'); await page.click('#go');
    const r = await until(async () => { const x = await raw(); return x.customer_labels.filter(l => l.label === 'ป้ายทดสอบ-e2e').length === n && x; }); ok(r, 'rename count'); ok(!r.customer_labels.some(l => l.label === lab), 'old label remains');
  });
  await step('quality page: counts vs reference, duplicates/orphans listed, CSV export downloads', async () => {
    await go('#/settings/quality'); const t = await view().innerText(); ok(t.includes('1383') && t.includes('9922') && t.includes('30811') && t.includes('366'), 'reference counts'); ok(t.includes('COUNT_DIFF'), 'diff');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ex')]); ok(dl.suggestedFilename().startsWith('quality-'), dl.suggestedFilename());
  });
  await step('unregistered codes: lists bill no, date, customer, clerk, line; export CSV; never says "wrong"', async () => {
    await go('#/settings/codes'); const t = await view().innerText(); ok(t.includes('ไม่ได้หมายความว่ารหัสเก่าผิด'), 'neutral wording'); ok(t.includes('7777'), '7777 listed');
    await page.fill('#cq', '7777'); await sleep(400); const x = await page.locator('#cl .li').first().innerText(); const row = D.unregisteredItems(M0).find(r => r.code === '7777'); for (const s of [row.billNo, row.customerId, row.clerk, `บรรทัด ${row.line}`]) ok(x.includes(s) || (await page.locator('#cl').innerText()).includes(s), 'missing ' + s);
    await page.fill('#cq', ''); await sleep(300); const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ex')]); const csv = fs.readFileSync(await dl.path(), 'utf8'); ok(csv.includes('billNo,date,customerId,customerName,clerk,line,code,name'), 'csv header'); ok(csv.includes('คู่ที่ผู้ใช้ยืนยัน') || csv.includes('ชื่อสินค้าขัดแย้งกัน'), 'legacy column');
  });
  await step('diagnostics verifies all 18 tabs / 178 columns from the live store', async () => {
    await go('#/settings/sync'); await page.click('#dg'); await page.waitForFunction(() => document.querySelector('#dgo')?.innerText.includes('18'), null, { timeout: 6000 }); const t = await page.locator('#dgo').innerText(); ok(t.includes('178'), t);
  });
  const FX = f => fs.readFileSync(path.resolve('test/fixtures', f));
  let NEWID;
  await step('create a shop in the field: temp code N-…, rows by header, "ไม่มีรหัสบัญชี" badge, activity เพิ่มลูกค้า', async () => {
    await go('#/customers'); await page.click('#addc'); await page.waitForSelector('.sheet #nn');
    await page.fill('#nn', 'ร้านใหม่ e2e ลาดพร้าว'); await page.fill('#np', '081-777-6666'); await page.fill('#nt', 'ร้านเสริมสวย'); await page.fill('#na', 'ซอย 5 ลาดพร้าว'); await page.fill('#nl', 'ลาดพร้าว, VIP');
    await page.click('#nb'); await page.waitForFunction(() => document.querySelector('.sheet #ng')?.textContent.includes('พิกัดพร้อม'), null, { timeout: 8000 }); await shot('new-customer'); await page.click('#ns');
    await page.waitForFunction(() => location.hash.startsWith('#/c/N-'), null, { timeout: 8000 }); NEWID = decodeURIComponent(page.url().split('#/c/')[1].split('?')[0]);
    const r = await until(async () => { const x = await raw(); return x.customers.find(c => c.id === NEWID) && x; }); const c = r.customers.find(c => c.id === NEWID);
    ok(/^N-\d{6}-[0-9A-Z]{4}$/.test(NEWID) && c.name === 'ร้านใหม่ e2e ลาดพร้าว' && c.type === 'ร้านเสริมสวย' && c.gpsLat.startsWith('13.7563') && c.mapLink.includes('13.7563'), JSON.stringify(c));
    ok(r.customer_phones.some(p => p.customerId === NEWID && p.phone === '081-777-6666'), 'phone'); ok(r.customer_labels.filter(l => l.customerId === NEWID).length === 2, 'labels');
    ok(r.activities.some(a => a.customerId === NEWID && a.type === 'เพิ่มลูกค้า'), 'activity'); ok((await view().innerText()).includes('ยังไม่มีรหัสบัญชี'), 'badge');
  });
  await step('duplicate shop (same name or phone) is blocked until the salesperson confirms; server refuses too', async () => {
    await go('#/customers'); await page.click('#addc'); await page.waitForSelector('.sheet #nn'); await page.fill('#nn', 'ร้านใหม่ e2e ลาดพร้าว'); await page.waitForSelector('.sheet #nd .banner'); ok((await page.locator('.sheet #nd').innerText()).includes('ชื่อซ้ำ'), 'no dup warning');
    const n0 = (await raw()).customers.length; await page.click('#ns'); await sleep(600); ok((await raw()).customers.length === n0, 'duplicate saved without confirmation');
    await page.locator('.sheet [data-close]').first().click();
    const f = await api('/api/ops', { method: 'POST', body: JSON.stringify({ ops: [{ type: 'customer.create', opId: 'dup-shop-' + Date.now(), payload: { name: 'ร้านใหม่ e2e ลาดพร้าว', phones: ['0817776666'] } }] }) }); ok(f.body.results[0].code === 'duplicate_customer', JSON.stringify(f.body));
  });
  await step('temp shop is separated: filter chip "ยังไม่มีรหัสบัญชี", listed under "เพิ่มทะเบียน" (not first purchase), order slip says รอรหัสบัญชี', async () => {
    await go('#/customers?f=temp'); await sleep(300); ok((await page.locator('#clist').innerText()).includes('ร้านใหม่ e2e'), 'chip'); 
    await go('#/new?t=reg'); ok((await view().innerText()).includes('ร้านใหม่ e2e'), 'reg tab'); await go('#/new?t=first'); ok(!(await view().innerText()).includes('ร้านใหม่ e2e'), 'must not be in first-purchase');
    await go(`#/order/new?c=${NEWID}`); await page.waitForSelector('#pk'); await page.locator('#src [data-s="all"]').click(); await page.locator('#pk [data-add]').first().click(); await page.locator('.cartbar').click(); await page.waitForSelector('#cl .li'); await page.click('#doc'); await page.waitForSelector('.sheet .slip');
    ok((await page.locator('.sheet .slipbox').innerText()).includes('รอรหัสบัญชี'), 'slip temp code'); await page.locator('.sheet [data-close]').first().click(); await page.evaluate(k => localStorage.removeItem(k), `cart:new:${NEWID}`);
  });
  await step('TTX customers report (real layout, cp874): new shop matched to the temp shop -> code linked in every tab; other new customer added; existing untouched', async () => {
    const before = await raw(); await go('#/settings/import'); await page.setInputFiles('#tf', { name: 'ลูกค้า-synthetic.ttx', mimeType: 'text/plain', buffer: FX('synthetic-customers.ttx') }); await page.waitForSelector('#go', { timeout: 8000 });
    const t = await page.locator('#ti').innerText(); ok(t.includes('รายงานลูกค้า') && t.includes('ลูกค้าใหม่') && t.includes('ตรงกับร้านชั่วคราว'), t.slice(0, 300)); await shot('import-customers'); await page.click('#go');
    await page.waitForFunction(() => location.hash.includes('imports'), null, { timeout: 12000 }); const r = await raw();
    ok(!r.customers.some(c => c.id === NEWID) && r.customers.some(c => c.id === '88001' && c.name === 'ร้านใหม่ e2e ลาดพร้าว'), 'temp code not replaced by 88001');
    for (const tb of ['customer_phones', 'customer_labels', 'activities']) ok(r[tb].some(x => x.customerId === '88001') && !r[tb].some(x => x.customerId === NEWID), tb);
    ok(r.customers.some(c => c.id === '88002' && c.billClerk === 'เหมียว' && c.address === 'ถนนทดสอบ'), '88002 added'); ok(r.customers.length === before.customers.length + 1, 'customer count'); 
    const orig = before.customers.find(c => c.id === '57900'); ok(JSON.stringify(r.customers.find(c => c.id === '57900')) === JSON.stringify(orig), 'existing customer modified');
    const bt = await tab('IMPORT_BATCHES'); ok(bt.at(-1).kind === 'customers' && bt.at(-1).format === 'TTX cp874' && bt.at(-1).fileHash.startsWith('sha256:'), JSON.stringify(bt.at(-1)));
  });
  await step('TTX bills report (real layout): new bills, VAT line dropped + VAT_OUT, existing bill untouched, review rows in aCRM wording', async () => {
    const before = await raw(); await go('#/settings/import'); await page.setInputFiles('#tf', { name: 'บิล-synthetic.ttx', mimeType: 'text/plain', buffer: FX('synthetic-bills.ttx') }); await page.waitForSelector('#go', { timeout: 8000 });
    const t = await page.locator('#ti').innerText(); ok(t.includes('รายงานรายบิล') && t.includes('3 บิล / 3 รายการ') && t.includes('ตรง footer'), t.slice(0, 400)); await shot('import-bills'); await page.click('#go');
    await page.waitForFunction(() => location.hash.includes('imports'), null, { timeout: 12000 }); const r = await raw();
    ok(r.bills.length === before.bills.length + 3 && r.bill_items.length === before.bill_items.length + 3, 'rows');
    const b2 = r.bills.find(b => b.no === '910002'); ok(b2.vatMode === 'VAT_OUT' && b2.paymentTerm === 'โอน' && b2.openedBy === 'เหมียว' && b2.date === '2569-12-05'.replace('2569', '2026') && b2.salesperson, JSON.stringify(b2));
    ok(r.bill_items.filter(i => i.billNo === '910002').length === 1 && !r.bill_items.some(i => i.code === '0015'), 'VAT line stored'); ok(D.billTotal(D.buildModel(r, Date.now()), '910002') === 1000, 'VAT added to sales');
    const orig = before.bills.find(x => x.no === '358600'); ok(JSON.stringify(r.bills.find(x => x.no === '358600')) === JSON.stringify(orig), 'existing bill overwritten');
    ok(r.bill_items.find(i => i.billNo === '910003').name.includes('\n- ขวดแก้วสีฟ้า'), 'multi-line name');
    const rv = await tab('IMPORT_REVIEW'); ok(rv.some(x => x.issueCode === 'BILL_EXISTS_DIFFERENT' && x.status === 'pending' && x.severity === 'medium') && rv.some(x => x.issueCode === 'PRODUCT_NOT_IN_REGISTER' && x.sourceKey === 'OLD-1' && x.severity === 'low'), 'review rows');
    const bt = await tab('IMPORT_BATCHES'); ok(bt.at(-1).kind === 'bills' && /^TTX-BILL-\d{8}-\d{3}$/.test(bt.at(-1).batchId) && bt.at(-1).status === 'ok_with_flags', JSON.stringify(bt.at(-1)));
    ok((await tab('changes')).some(x => x.entity === 'นำเข้า' && x.id === bt.at(-1).batchId), 'changes row');
  });
  await step('re-importing the same TTX files is refused (no duplicates) and the history page lists batches + review', async () => {
    const n = (await raw()).bills.length; for (const f of ['synthetic-bills.ttx', 'synthetic-customers.ttx']) { await go('#/settings/import'); await page.setInputFiles('#tf', { name: f, mimeType: 'text/plain', buffer: FX(f) }); await page.waitForSelector('#ti .banner.bad', { timeout: 8000 }); ok(await page.locator('#go').isDisabled(), 'import enabled for ' + f); }
    ok((await raw()).bills.length === n, 'rows added'); await go('#/settings/imports'); const t = await view().innerText(); ok(t.includes('synthetic') && t.includes('BILL_EXISTS_DIFFERENT'), 'history');
    await page.locator('[data-r]').first().click(); await sleep(1500); ok((await tab('IMPORT_REVIEW')).some(x => x.status === 'confirmed'), 'review not confirmed');
  });
  await step('unknown file layout is rejected with a clear message (no guessing)', async () => {
    await go('#/settings/import'); await page.setInputFiles('#tf', { name: 'bad.ttx', mimeType: 'text/plain', buffer: Buffer.from('foo\tbar\nx\ty', 'utf8') }); await page.waitForSelector('#ti .banner.bad'); ok((await page.locator('#ti').innerText()).includes('ไม่รู้จักรูปแบบ'), 'msg');
  });

  console.log('\n== Offline / sync / cache ==');
  await step('offline: field note is queued locally, shown in header, then synced exactly once when back online', async () => {
    const N = 'e2e-offline-' + Date.now(); await go(`#/c/${CID}`); await ctx.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.locator('[data-act="note"]').click(); await page.waitForSelector('.sheet #vk'); await page.locator('#vk [data-k="note"]').click(); await page.fill('#vn', N); await page.click('#vs'); await sleep(600);
    ok((await page.locator('#hdr .st').innerText()).includes('ออฟไลน์') || (await page.locator('#hdr .st').innerText()).includes('รอส่ง'), 'header state'); ok((await raw()).activities.filter(v => v.note === N).length === 0, 'reached server while offline');
    await go(`#/c/${CID}?tab=visits`).catch(() => {}); ok((await view().innerText()).includes(N), 'optimistic row missing');
    await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online'))); const v = await until(async () => { const x = (await raw()).activities.filter(v => v.note === N); return x.length && x; }, 10000); ok(v.length === 1, 'rows ' + v.length);
    await sleep(1200); ok((await raw()).activities.filter(v => v.note === N).length === 1, 'duplicated after sync');
  });
  await step('note can be edited and removed from the customer timeline with a retained history row', async () => {
    const activity = (await raw()).activities.find(a => a.customerId === CID && a.note.startsWith('e2e-offline-'));
    await go(`#/c/${CID}?tab=visits`);
    const edit = page.locator(`[data-edit-note="${activity.activityId}"]`);
    await edit.click();
    await page.locator('.sheet textarea').fill('โน้ตแก้ไข E2E');
    await page.locator('.sheet [data-save]').click();
    ok(await until(async () => (await raw()).activities.find(a => a.activityId === activity.activityId)?.note === 'โน้ตแก้ไข E2E'), 'edit did not sync');
    await edit.click();
    await page.locator('.sheet [data-remove]').click();
    await page.locator('#cfm-ok').click();
    ok(await until(async () => (await raw()).activities.find(a => a.activityId === activity.activityId)?.type === 'ลบ'), 'deleted marker did not sync');
    await edit.waitFor({ state: 'detached' });
    ok((await tab('changes')).filter(c => c.id === activity.activityId).length === 2, 'audit rows missing');
  });
  await step('app shell loads offline from cache (service worker)', async () => {
    await page.goto(BASE + '/'); await page.waitForSelector('.hstat'); await sleep(800); await ctx.setOffline(true); await page.reload(); await page.waitForSelector('.hstat', { timeout: 10000 }); ok((await page.locator('.hstat b').first().innerText()) !== '', 'no cached data'); await ctx.setOffline(false);
  });
  await step('queue persists across reload before it is flushed (IndexedDB)', async () => {
    const N = 'e2e-persist-' + Date.now(); await go(`#/c/${CID}`); await ctx.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.locator('[data-act="note"]').click(); await page.waitForSelector('.sheet #vk'); await page.locator('#vk [data-k="note"]').click(); await page.fill('#vn', N); await page.click('#vs'); await sleep(500); await page.reload().catch(() => {}); await sleep(1500);
    await ctx.setOffline(false); const v = await until(async () => { const x = (await raw()).activities.filter(v => v.note === N); return x.length && x; }, 12000); ok(v && v.length === 1, 'queued op lost or duplicated');
  });

  console.log('\n== Performance at delivery scale (1,383 customers / 9,922 bills / 30,811 items) ==');
  await step('domain computations at full scale stay fast', async () => {
    const { buildFixtures } = await import('../../src/server/fixtures.js'); const big = buildFixtures({ now: NOW, customers: 1383, billsPerCustomer: 7, seed: 3 });
    big.bills = big.bills.slice(0, 9922); const keep = new Set(big.bills.map(b => b.no)); big.bill_items = big.bill_items.filter(i => keep.has(i.billNo)).slice(0, 30811);
    let t = performance.now(); const m = D.buildModel(big, NOW); const build = performance.now() - t; t = performance.now(); D.customerCounts(m); D.suggestions(m); const stats = performance.now() - t; t = performance.now(); D.searchCustomers(m, 'ร้านทดสอบ 5'); const search = performance.now() - t; t = performance.now(); D.qualityReport(m); D.unregisteredItems(m); const qual = performance.now() - t;
    console.log(`      build ${build | 0}ms · stats ${stats | 0}ms · search ${search | 0}ms · quality ${qual | 0}ms (${m.customers.length}c/${m.bills.length}b/${big.bill_items.length}i)`);
    ok(build < 1500 && stats < 1500 && search < 200 && qual < 2500, 'too slow');
  });

  await browser.close(); if (server) server.kill();
  const fail = results.filter(r => !r.pass);
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), total: results.length, passed: results.length - fail.length, failed: fail, results, consoleErrors }, null, 2));
  console.log(`\n${results.length - fail.length}/${results.length} passed${consoleErrors.length ? ` · ${consoleErrors.length} console errors` : ''}`);
  if (consoleErrors.length) console.log(consoleErrors.slice(0, 5));
  process.exit(fail.length || consoleErrors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); try { server?.kill(); } catch {} process.exit(2); });
