import * as D from '../shared/domain.js';
import { rowsToObjects, TABS, TOTAL_COLUMNS } from '../shared/schema.js';
import { esc, icon, fmtDate, fmtDateTime, toast, confirmBox, sheet, download, debounce, uuid } from '../ui.js';
import { S, api, enqueue, flush, retryFailed, discardOp, refresh, clearCache, logout, pendingCount } from '../data.js';
import { VERSION } from '../version.js';
import { emptyMsg, pager, bindPager, openBill } from './common.js';
import { parseTtx, analyze, decodeBuffer } from '../ttx.js';

const back = '<div style="height:0"></div>';
const adminOnly = () => (S.user?.isAdmin ? '' : `<div class="banner">ฟังก์ชันนี้สำหรับผู้ดูแลระบบ (ตั้ง role = admin ในแท็บ ACCESS)</div>`);

export default function settings(ctx) {
  const sub = ctx.params[0];
  const page = { cycle, labels, import: importPage, quality, imports, codes, sync }[sub];
  if (sub && !page) return { html: `<div class="empty">ไม่พบหน้านี้</div>` };
  return page ? page(ctx) : index(ctx);
}

function index({ m }) {
  const q = D.qualityReport(m).issues.filter(i => i.severity !== 'info').length;
  const row = (go, ic, t, s) => `<div class="li" data-go="#/settings/${go}">${icon(ic)}<div class="grow"><div class="t">${t}</div><div class="s">${s}</div></div>${icon('chev')}</div>`;
  return {
    title: 'ตั้งค่า',
    html: `<div class="stack"><div class="card soft"><div class="b">${esc(S.user?.email || '')}</div><div class="xs muted">สิทธิ์: ${esc(S.user?.role || '-')}${S.user?.isAdmin ? ' (ผู้ดูแล)' : ''} · เวอร์ชัน ${esc(VERSION)}</div></div>
    <div class="list">
      ${row('cycle', 'clock', 'รอบซื้อ / เกณฑ์ลูกค้าห่างหาย', `ห่างหาย > ${m.settings.lateDays} วัน · เข้าพบทุก ${m.settings.visitDef} วัน`)}
      ${row('labels', 'tag', 'ป้ายกำกับ', 'จัดการป้ายกำกับลูกค้า')}
      ${row('import', 'import', 'นำเข้า TTX', 'นำเข้าบิลจากไฟล์ (ผู้ดูแล)')}
      ${row('quality', 'shield', 'ตรวจคุณภาพข้อมูล', q ? `พบ ${q} รายการที่ควรตรวจ` : 'ไม่พบปัญหาสำคัญ')}
      ${row('imports', 'report', 'ตรวจประวัติการนำเข้า', 'รอบนำเข้าและรายการรอตรวจ')}
      ${row('codes', 'warn', 'ตรวจรหัส/ชื่อสินค้าที่ไม่ตรงทะเบียน', 'เฉพาะแสดงรายการ ไม่ตัดสินว่าผิด')}
      ${row('sync', 'refresh', 'ซิงก์ และบัญชี', pendingCount() ? `รอส่ง ${pendingCount()} รายการ` : 'ข้อมูลล่าสุด')}
    </div></div>`,
  };
}

// ---------------- cycle settings ----------------
function cycle({ m }) {
  const f = [['lateDays', 'ลูกค้าห่างหาย เมื่อไม่ซื้อเกิน (วัน)', 'ปัจจุบัน = ซื้อภายในกี่วัน'], ['dormDays', 'ถือว่าหลับยาว เมื่อไม่ซื้อเกิน (วัน)', ''], ['visitDef', 'ควรเข้าพบทุก (วัน)', 'ใช้คำนวณ “ขาดเข้าพบ”'], ['soonDays', 'แจ้ง “ใกล้ถึงรอบซื้อ” ล่วงหน้า (วัน)', ''], ['minCycleBills', 'จำนวนวันที่ซื้ออย่างน้อยก่อนคำนวณรอบ', 'น้อยกว่านี้จะไม่เดารอบ'], ['newDays', 'ลูกค้าใหม่ = ซื้อครั้งแรกภายใน (วัน)', '']];
  return {
    title: 'รอบซื้อ / ลูกค้าห่างหาย',
    html: `<div class="stack">${adminOnly()}${f.map(([k, t, h]) => `<label class="field"><span>${t}</span><input class="inp" inputmode="numeric" data-k="${k}" value="${esc(m.settings[k])}">${h ? `<span class="xs faint" style="margin-top:3px">${h}</span>` : ''}</label>`).join('')}
    <button class="btn grad block" id="sv" ${S.user?.isAdmin ? '' : 'disabled'}>บันทึกการตั้งค่า</button>
    <div class="xs faint">ค่าบันทึกเป็นแถวใหม่ในแท็บ systemSettings (แถวล่าสุดมีผล) ค่าอื่นที่มีอยู่เดิม เช่น comm, vatRate จะไม่ถูกแตะ</div></div>`,
    after(root) {
      root.querySelector('#sv').onclick = async e => {
        const data = {}; root.querySelectorAll('[data-k]').forEach(i => { const v = D.num(i.value); if (String(v) !== String(m.settings[i.dataset.k])) data[i.dataset.k] = v; });
        if (!Object.keys(data).length) return toast('ไม่มีการเปลี่ยนแปลง');
        e.target.disabled = true;
        try { await enqueue('settings.save', { data }); toast('บันทึกแล้ว'); history.back(); } catch (er) { toast(er.message); e.target.disabled = false; }
      };
    },
  };
}

// ---------------- labels ----------------
function labels({ m }) {
  const cnt = new Map(); for (const rows of m.labels.values()) for (const r of rows) if (r.label) cnt.set(r.label, (cnt.get(r.label) || 0) + 1);
  const rows = [...cnt.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th'));
  return {
    title: 'ป้ายกำกับ',
    html: `<div class="stack">${adminOnly()}<div class="muted sm">ใช้ป้ายกำกับแทนชื่อเรียกพิเศษของลูกค้า · ${rows.length} ป้าย · เพิ่ม/ลบป้ายของแต่ละร้านได้ที่หน้าข้อมูลลูกค้า (แก้ไข)</div>
    <label class="search">${icon('search')}<input id="lq" type="search" placeholder="ค้นหาป้ายกำกับ" autocomplete="off"></label>
    <div class="list" id="ll">${rows.map(([l, n]) => `<div class="li" data-lbl="${esc(l)}" data-go="#/customers?label=${encodeURIComponent(l)}"><div class="grow t">${esc(l)}</div><span class="badge">${n} ร้าน</span>${S.user?.isAdmin ? `<button class="btn ghost sm" data-ren="${esc(l)}">แก้ชื่อ</button><button class="btn ghost sm" data-del="${esc(l)}" style="color:var(--bad)">ลบ</button>` : ''}</div>`).join('') || emptyMsg('ยังไม่มีป้ายกำกับ')}</div></div>`,
    after(root) {
      root.querySelector('#lq').addEventListener('input', e => { const t = D.normText(e.target.value); root.querySelectorAll('#ll [data-lbl]').forEach(li => { li.classList.toggle('hide', !!t && !D.normText(li.dataset.lbl).includes(t)); }); });
      root.addEventListener('click', async e => {
        const r = e.target.closest('[data-ren]'), d = e.target.closest('[data-del]');
        if (r) {
          e.stopPropagation(); e.preventDefault();
          const s = sheet(`<h3>เปลี่ยนชื่อป้าย “${esc(r.dataset.ren)}”</h3><div class="stack"><input class="inp" id="nn" value="${esc(r.dataset.ren)}"><div class="xs muted">ถ้าชื่อใหม่ซ้ำกับป้ายที่มีอยู่ ระบบจะรวมเข้าด้วยกัน (ร้านที่มีทั้งสองป้ายจะเหลือป้ายเดียว)</div><button class="btn grad block" id="go">บันทึก</button></div>`);
          s.el.querySelector('#go').onclick = async () => { const to = s.el.querySelector('#nn').value.trim(); if (!to || to === r.dataset.ren) return; try { await enqueue('label.rename', { from: r.dataset.ren, to }); s.close(); toast('เปลี่ยนชื่อแล้ว'); } catch (er) { toast(er.message); } };
        } else if (d) {
          e.stopPropagation(); e.preventDefault();
          if (await confirmBox(`ลบป้าย “${d.dataset.del}” ออกจากลูกค้าทุกร้าน?`, 'ลบป้าย')) try { await enqueue('label.delete', { label: d.dataset.del }); toast('ลบแล้ว'); } catch (er) { toast(er.message); }
        }
      }, true);
    },
  };
}

// ---------------- data quality ----------------
const SEV = { error: ['bad', 'ต้องแก้'], warn: ['warn', 'ควรตรวจ'], info: ['', 'ข้อมูล'] };
function quality({ m }) {
  const q = D.qualityReport(m);
  const groups = new Map(); for (const i of q.issues) { if (!groups.has(i.code)) groups.set(i.code, []); groups.get(i.code).push(i); }
  const ref = D.REFERENCE_COUNTS;
  return {
    title: 'ตรวจคุณภาพข้อมูล',
    html: `<div class="stack"><div class="card"><div class="b" style="margin-bottom:6px">จำนวนข้อมูลเทียบข้อมูลอ้างอิงวันส่งมอบฐาน</div>
      ${Object.keys(ref).map(k => `<div class="row between sm"><span>${k}</span><span class="num">${q.counts[k]} / ${ref[k]} ${q.counts[k] === ref[k] ? '<span class="badge ok">ตรง</span>' : '<span class="badge warn">ต่าง</span>'}</span></div>`).join('')}</div>
      ${S.schemaIssues.length ? `<div class="banner bad">โครงสร้างแท็บไม่ตรง: ${S.schemaIssues.map(x => `${esc(x.tab)} ขาด ${esc(x.missing.join(','))}`).join(' · ')}</div>` : `<div class="banner ok">Header ของ ${TABS.length} แท็บที่โหลด (14 แท็บหลัก) ตรงตามโครงสร้าง</div>`}
      <div class="list">${[...groups.entries()].map(([code, a]) => `<div class="li" data-code="${code}"><div class="grow"><div class="t">${esc(code)}</div><div class="s">${esc(a[0].detail)}</div></div><div class="r"><span class="badge ${SEV[a[0].severity][0]}">${a.length}</span></div></div>`).join('') || emptyMsg('ไม่พบปัญหา')}</div>
      <button class="btn line block" id="ex">${icon('dl')} ส่งออกรายการตรวจสอบ (CSV)</button></div>`,
    after(root) {
      root.querySelector('#ex').onclick = () => download(`quality-${m.today}.csv`, D.toCsv(q.issues.map(i => ({ code: i.code, severity: i.severity, detail: i.detail, key: i.key || i.billNo || i.customerId || '' })), ['code', 'severity', 'detail', 'key']));
      root.addEventListener('click', e => {
        const li = e.target.closest('[data-code]'); if (!li) return;
        const a = groups.get(li.dataset.code);
        const s = sheet(`<div class="row between"><h3 style="margin:0">${esc(li.dataset.code)} (${a.length})</h3><button class="btn ghost sm" data-close>ปิด</button></div><label class="search" style="margin-top:10px">${icon('search')}<input id="iq" type="search" placeholder="ค้นหาในรายการ" autocomplete="off"></label><div class="list" id="il" style="margin-top:10px">${a.slice(0, 200).map(i => `<div class="li" data-t="${esc(i.detail.toLowerCase())}" ${i.billNo ? `data-b="${esc(i.billNo)}"` : i.customerId ? `data-go="#/c/${encodeURIComponent(i.customerId)}"` : 'style="cursor:default"'}><div class="grow sm">${esc(i.detail)}</div></div>`).join('')}</div>${a.length > 200 ? `<div class="xs faint">แสดง 200 จาก ${a.length} (ส่งออก CSV เพื่อดูทั้งหมด)</div>` : ''}`);
        s.el.querySelector('#iq').addEventListener('input', ev => { const t = ev.target.value.trim().toLowerCase(); s.el.querySelectorAll('#il [data-t]').forEach(x => x.classList.toggle('hide', !!t && !x.dataset.t.includes(t))); });
        s.el.addEventListener('click', ev => { const b = ev.target.closest('[data-b]'); if (b) { s.close(); openBill(m, b.dataset.b); } if (ev.target.closest('[data-go]')) s.close(); });
      });
    },
  };
}

// ---------------- unregistered codes ----------------
function codes({ m }) {
  const rows = D.unregisteredItems(m), sum = D.unregisteredSummary(rows);
  return {
    title: 'รหัสที่ไม่ตรงทะเบียน',
    html: `<div class="stack"><div class="banner" style="background:var(--blue-soft);color:var(--ink)">รายการนี้แสดงรหัสในประวัติบิลที่ไม่มีในทะเบียนสินค้าปัจจุบัน <b>ไม่ได้หมายความว่ารหัสเก่าผิด</b> ประวัติบิลเก็บชื่อ จำนวน ราคา และยอดจริงในอดีตไว้ครบ ระบบไม่เดารหัสใหม่ให้ (ยกเว้นคู่ที่ผู้ใช้ยืนยัน ${D.LEGACY_PAIRS.length} คู่ และชื่อไม่ขัดแย้ง)</div>
      <div class="row between"><span class="b">${sum.length} รหัส · ${rows.length} บรรทัด</span><button class="btn line sm" id="ex">${icon('dl')} ส่งออก CSV</button></div>
      <label class="search">${icon('search')}<input id="cq" type="search" placeholder="ค้นหารหัส ชื่อสินค้า เลขบิล ลูกค้า" autocomplete="off"></label><div id="cl"></div></div>`,
    after(root) {
      const cols = ['billNo', 'date', 'customerId', 'customerName', 'clerk', 'line', 'code', 'name', 'qty', 'price', 'amount', 'legacy'];
      root.querySelector('#ex').onclick = () => download(`unregistered-codes-${m.today}.csv`, D.toCsv(rows, cols));
      const inp = root.querySelector('#cq'), box = root.querySelector('#cl');
      const draw = () => {
        const t = D.normText(inp.value);
        if (!t) {
          const row = s => `<div class="li" data-c="${esc(s.code)}"><div class="grow"><div class="t">${esc(s.names[0] || '')}${s.names.length > 1 ? ` <span class="xs faint">+${s.names.length - 1} ชื่อ</span>` : ''}</div><div class="s">รหัส ${esc(s.code)} · ${s.bills} บิล · ${s.lines} บรรทัด${s.legacy ? ' · ' + esc(s.legacy) : ''}</div></div><div class="r num">${D.money(s.amount)}</div></div>`;
          box.innerHTML = sum.length ? `<div class="list">${pager(sum, row, { id: 'uc' })}</div>` : emptyMsg('ทุกรายการในบิลตรงทะเบียน'); bindPager(box, sum, row, { id: 'uc' });
        } else {
          const r = rows.filter(x => D.normText(`${x.code}${x.name}${x.billNo}${x.customerName}${x.clerk}`).includes(t));
          const row = x => `<div class="li" data-b="${esc(x.billNo)}"><div class="grow"><div class="t ell" style="font-weight:500">${esc(x.name)}</div><div class="s ell">บิล ${esc(x.billNo)} · ${fmtDate(x.date)} · ${esc(x.customerId)} ${esc(x.customerName)} · เสมียน ${esc(x.clerk)} · บรรทัด ${esc(x.line)}</div></div><div class="r"><div class="num">${D.money(x.amount)}</div><div class="xs faint">${esc(x.code)}</div></div></div>`;
          box.innerHTML = r.length ? `<div class="list">${pager(r, row, { id: 'ur' })}</div>` : emptyMsg('ไม่พบ'); bindPager(box, r, row, { id: 'ur' });
        }
      };
      draw(); inp.addEventListener('input', debounce(draw));
      box.addEventListener('click', e => {
        const c = e.target.closest('[data-c]'), b = e.target.closest('[data-b]');
        if (b) return openBill(m, b.dataset.b);
        if (c) { inp.value = c.dataset.c; draw(); }
      });
    },
  };
}

// ---------------- import history / review ----------------
async function imports({ m }) {
  if (!S.user?.isAdmin) return { title: 'ประวัติการนำเข้า', html: adminOnly() };
  let batches = [], reviews = [];
  try { const [b, r] = await Promise.all([api('/api/tab/IMPORT_BATCHES'), api('/api/tab/IMPORT_REVIEW')]); batches = rowsToObjects(b.valueRanges[0].values).reverse(); reviews = rowsToObjects(r.valueRanges[0].values); } catch (e) { return { title: 'ประวัติการนำเข้า', html: `<div class="banner bad">โหลดไม่สำเร็จ: ${esc(e.message)}</div>` }; }
  const open = reviews.filter(r => r.status === 'open' || !r.status);
  return {
    title: 'ประวัติการนำเข้า',
    html: `<div class="stack"><div class="sec" style="margin-top:0">รอบนำเข้า (${batches.length})</div>
      <div class="list">${batches.map(b => `<div class="li" style="cursor:default"><div class="grow"><div class="t ell">${esc(b.fileName || b.batchId)}</div><div class="s">${fmtDateTime(b.at)} · ${esc(b.format)} · ${esc(b.user)}</div><div class="xs faint">${esc(b.summary)}</div></div><span class="badge ok">${esc(b.status)}</span></div>`).join('') || emptyMsg('ยังไม่มีการนำเข้า')}</div>
      <div class="row between"><div class="sec" style="margin:0">รายการรอตรวจ (${open.length} / ${reviews.length})</div><button class="btn line sm" id="ex">${icon('dl')} CSV</button></div>
      <label class="search">${icon('search')}<input id="rq" type="search" placeholder="ค้นหารายการตรวจ (รหัสปัญหา เลขบิล)" autocomplete="off"></label>
      <div class="list" id="rl">${reviews.slice().reverse().slice(0, 200).map(r => `<div class="li" data-rv="${esc((r.issueCode + ' ' + r.sourceKey + ' ' + r.entityType + ' ' + r.sourceValue).toLowerCase())}" style="cursor:default;align-items:flex-start"><div class="grow"><div class="t" style="font-weight:500">${esc(r.issueCode)} · ${esc(r.entityType)} ${esc(r.sourceKey)}</div><div class="s">${esc(r.sourceValue)} ${r.existingValue ? '· ' + esc(r.existingValue) : ''}</div><div class="xs faint">${esc(r.suggestedAction)}</div></div>${(r.status === 'open' || !r.status) ? `<button class="btn ghost sm" data-r="${esc(r.reviewId)}">ตรวจแล้ว</button>` : `<span class="badge gray">${esc(r.status)}</span>`}</div>`).join('') || emptyMsg('ไม่มีรายการรอตรวจ')}</div></div>`,
    after(root) {
      root.querySelector('#rq').addEventListener('input', e => { const t = e.target.value.trim().toLowerCase(); root.querySelectorAll('#rl [data-rv]').forEach(li => li.classList.toggle('hide', !!t && !li.dataset.rv.includes(t))); });
      root.querySelector('#ex').onclick = () => download(`import-review-${m.today}.csv`, D.toCsv(reviews, ['reviewId', 'batchId', 'sourceFile', 'entityType', 'sourceKey', 'issueCode', 'severity', 'sourceValue', 'existingValue', 'suggestedAction', 'status', 'reviewedBy', 'reviewedAt', 'resolutionNote']));
      root.addEventListener('click', async e => { const b = e.target.closest('[data-r]'); if (!b) return; try { await enqueue('review.update', { reviewId: b.dataset.r, status: 'resolved' }); await flush(); toast('บันทึกแล้ว'); location.reload(); } catch (er) { toast(er.message); } });
    },
  };
}

// ---------------- TTX import ----------------
function importPage({ m }) {
  return {
    title: 'นำเข้า TTX',
    html: `<div class="stack">${adminOnly()}<div class="banner" style="background:var(--blue-soft);color:var(--ink)">นำเข้าเฉพาะบิลใหม่ที่ยังไม่มีเลขบิลในฐาน ไม่เขียนทับบิลเดิม · ไฟล์ซ้ำ (ลายนิ้วมือไฟล์เดียวกัน) จะถูกปฏิเสธ · ทุกอย่างที่ผิดปกติลงแท็บ IMPORT_REVIEW</div>
      <label class="btn line block" for="tf">${icon('import')} เลือกไฟล์ TTX</label><input type="file" id="tf" accept=".ttx,.txt,.csv,.tsv,text/*" class="hide" ${S.user?.isAdmin ? '' : 'disabled'}><div id="ti"></div></div>`,
    after(root) {
      const out = root.querySelector('#ti');
      root.querySelector('#tf').onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        out.innerHTML = '<div class="empty">กำลังอ่านไฟล์…</div>';
        const buf = await f.arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
        const parsed = parseTtx(decodeBuffer(buf));
        if (parsed.error) { out.innerHTML = `<div class="banner bad">${esc(parsed.error)}</div>`; return; }
        let known = [];
        try { known = rowsToObjects((await api('/api/tab/IMPORT_BATCHES')).valueRanges[0].values); } catch (er) { out.innerHTML = `<div class="banner bad">${esc(er.message)}</div>`; return; }
        const dup = known.find(b => b.fileHash === hash);
        const a = analyze(m, parsed, f.name);
        out.innerHTML = `${dup ? `<div class="banner bad">ไฟล์นี้เคยนำเข้าแล้ว (${esc(dup.fileName)} · ${fmtDateTime(dup.at)}) — ไม่สามารถนำเข้าซ้ำ</div>` : ''}
          <div class="card"><div class="b">${esc(f.name)}</div><div class="xs faint">ตัวคั่น ${parsed.delimiter} · ${parsed.bills.length} บิล · ${parsed.items.length} รายการ</div>
          <dl class="kv" style="margin-top:8px"><dt>บิลใหม่</dt><dd>${a.newBills.length} บิล / ${a.newItems.length} รายการ</dd><dt>มีแล้ว (เหมือนเดิม)</dt><dd>${a.same.length}</dd><dt>มีแล้ว (ยอดต่าง)</dt><dd>${a.diff.length} (ไม่เขียนทับ ลงรายการตรวจ)</dd><dt>ลูกค้าไม่พบ</dt><dd>${a.unknownCust.length}</dd><dt>รหัสไม่ตรงทะเบียน</dt><dd>${a.codes.size} รหัส</dd><dt>แถวที่อ่านไม่ได้</dt><dd>${parsed.bad.length}</dd><dt>รายการตรวจ</dt><dd>${a.reviews.length}</dd></dl></div>
          <button class="btn grad block" id="go" style="margin-top:12px" ${dup || (!a.newBills.length && !a.reviews.length) ? 'disabled' : ''}>นำเข้า ${a.newBills.length} บิลใหม่</button><div id="pr" class="xs muted" style="margin-top:8px"></div>`;
        out.querySelector('#go').onclick = async btn => {
          btn.target.disabled = true; const pr = out.querySelector('#pr');
          const batch = { batchId: `IMP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${uuid().slice(0, 6)}`, fileName: f.name, fileHash: hash, format: 'TTX', kind: 'bills', summary: `บิลใหม่ ${a.newBills.length} · รายการ ${a.newItems.length} · ตรวจ ${a.reviews.length}` };
          const chunks = []; let cur = { bills: [], items: [] }, n = 0;
          for (const b of a.newBills) { const its = a.itemsByBill.get(b.no); if (n + its.length + 1 > 2800) { chunks.push(cur); cur = { bills: [], items: [] }; n = 0; } cur.bills.push(b); cur.items.push(...its); n += its.length + 1; }
          chunks.push(cur);
          for (let i = 0; i < a.reviews.length; i += 800) chunks.push({ bills: [], items: [], reviews: a.reviews.slice(i, i + 800) });
          try {
            for (let i = 0; i < chunks.length; i++) {
              pr.textContent = `กำลังนำเข้า ${i + 1}/${chunks.length}…`;
              const r = await api('/api/ops', { method: 'POST', body: { deviceId: S.deviceId, ops: [{ type: 'import.commit', opId: `${batch.batchId}-${i}`, at: Date.now(), payload: { first: i === 0, batch, ...chunks[i] } }] } });
              const res = r.results[0]; if (res.status === 'error') throw new Error(res.message);
            }
            pr.innerHTML = '<span style="color:var(--ok)">นำเข้าเรียบร้อย กำลังโหลดข้อมูลใหม่…</span>'; await refresh(); toast('นำเข้าเรียบร้อย'); location.hash = '#/settings/imports';
          } catch (er) { pr.innerHTML = `<span style="color:var(--bad)">หยุดที่ผิดพลาด: ${esc(er.message)} (บิลที่นำเข้าไปแล้วไม่ซ้ำเมื่อลองใหม่)</span>`; btn.target.disabled = false; }
        };
      };
    },
  };
}

// ---------------- sync / account ----------------
function sync({ m }) {
  const q = S.queue;
  return {
    title: 'ซิงก์ และบัญชี',
    html: `<div class="stack">
      <div class="card"><dl class="kv"><dt>บัญชี</dt><dd>${esc(S.user?.email || '')}</dd><dt>เวอร์ชันแอป</dt><dd>${esc(VERSION)}</dd><dt>เวอร์ชันเซิร์ฟเวอร์</dt><dd>${esc(S.health?.version || '')} (${esc(S.health?.mode || '')})</dd><dt>อุปกรณ์</dt><dd>${esc(S.deviceId)}</dd><dt>สถานะ</dt><dd>${S.online ? 'ออนไลน์' : 'ออฟไลน์'}</dd><dt>ซิงก์ล่าสุด</dt><dd>${S.lastSync ? fmtDateTime(D.nowIso(S.lastSync)) : '—'}</dd><dt>ข้อมูล</dt><dd>${m.customers.length} ลูกค้า · ${m.bills.length} บิล · ${m.raw.bill_items.length} รายการ · ${m.products.length} สินค้า</dd></dl></div>
      <button class="btn grad block" id="sn">${icon('refresh')} ซิงก์ตอนนี้</button>
      <div class="sec">งานที่รอส่ง (${q.length})</div>
      <div class="list">${q.map(o => `<div class="li" style="cursor:default;align-items:flex-start"><div class="grow"><div class="t" style="font-weight:500">${esc(o.type)}</div><div class="xs faint">${fmtDateTime(D.nowIso(o.at))}${o.error ? ` · <span style="color:var(--bad)">${esc(o.error)}</span>` : ' · รอส่ง'}</div></div>${o.error ? `<button class="btn ghost sm" data-dis="${esc(o.opId)}">ทิ้ง</button>` : ''}</div>`).join('') || emptyMsg('ไม่มีงานค้าง')}</div>
      ${S.failed.length ? `<button class="btn line block" id="rt">ส่งงานที่ค้างอีกครั้ง</button>` : ''}
      ${S.user?.isAdmin ? `<button class="btn line block" id="dg">ตรวจโครงสร้างฐานข้อมูล 18 แท็บ</button><div id="dgo"></div>` : ''}
      <button class="btn line block" id="cc">ล้างแคชในเครื่อง (งานที่รอส่งไม่หาย)</button>
      <button class="btn line block" id="lo" style="color:var(--bad)">ออกจากระบบ</button></div>`,
    after(root) {
      root.querySelector('#sn').onclick = async e => { e.target.disabled = true; try { await flush(); await refresh(); toast('ซิงก์แล้ว'); } catch (er) { toast(er.message); } e.target.disabled = false; };
      root.querySelector('#rt')?.addEventListener('click', () => retryFailed().then(() => toast('ส่งอีกครั้งแล้ว')));
      root.addEventListener('click', async e => { const d = e.target.closest('[data-dis]'); if (d && await confirmBox('ทิ้งงานนี้? ข้อมูลที่ยังไม่ได้ส่งจะหายไป', 'ทิ้ง')) { await discardOp(d.dataset.dis); location.reload(); } });
      root.querySelector('#dg')?.addEventListener('click', async () => {
        const box = root.querySelector('#dgo'); box.innerHTML = '<div class="empty">กำลังตรวจ…</div>';
        try {
          const r = await api('/api/diagnostics');
          box.innerHTML = `<div class="banner ${r.ok ? 'ok' : 'bad'}" style="margin-top:8px">${r.ok ? `ครบ ${r.tabs} แท็บ / ${r.expectedColumns} คอลัมน์ตามโครงสร้าง` : 'พบแท็บที่ไม่ตรงโครงสร้าง'}</div><div class="list">${r.checks.map(c => `<div class="li" style="cursor:default"><div class="grow">${esc(c.tab)}</div>${c.ok ? '<span class="badge ok">ตรง</span>' : `<span class="badge bad">ขาด ${esc(c.missing.join(','))}</span>`}${c.extra.length ? `<span class="badge gray">เพิ่ม ${esc(c.extra.join(','))}</span>` : ''}</div>`).join('')}</div>`;
        } catch (er) { box.innerHTML = `<div class="banner bad">${esc(er.message)}</div>`; }
      });
      root.querySelector('#cc').onclick = async () => { await clearCache(); if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k); toast('ล้างแคชแล้ว'); setTimeout(() => location.reload(), 600); };
      root.querySelector('#lo').onclick = async () => { await logout(); location.reload(); };
    },
  };
}
