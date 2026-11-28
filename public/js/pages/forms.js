// Shared sheets for field work. ONE visit form covers check-in, visit log, note and appointment.
import * as D from '../shared/domain.js';
import { esc, icon, sheet, toast, getGps, distanceKm, compressImage, confirmBox } from '../ui.js';
import { S, enqueue } from '../data.js';

const OUTCOMES = ['', 'ได้ออเดอร์', 'ไม่มีออเดอร์', 'ร้านปิด/ไม่พบผู้ตัดสินใจ', 'ขอคิดดู/ติดตามต่อ', 'อื่นๆ'];
const errMsg = e => e?.message || String(e);

export function visitSheet(customerId, { kind = 'visit' } = {}) {
  const m = S.model, c = m.custById.get(customerId);
  let cur = kind, photo = null, gps = null, skipGps = false;
  const s = sheet(`<div class="row between"><h3 style="margin:0">บันทึก · ${esc(c?.name || customerId)}</h3><button class="btn ghost sm" data-close>ปิด</button></div>
    <div class="stack" style="margin-top:12px">
    <div class="seg" id="vk"><button data-k="visit">เข้าพบ</button><button data-k="note">โน้ต</button><button data-k="appointment">นัดหมาย</button></div>
    <label class="field"><span id="nl">รายละเอียด</span><textarea class="inp" id="vn" placeholder="เช่น คุยกับเจ้าของร้าน สินค้าที่สนใจ สิ่งที่ต้องติดตาม"></textarea></label>
    <label class="field" id="ow"><span>ผลการเข้าพบ</span><select class="inp" id="vo">${OUTCOMES.map(o => `<option>${esc(o)}</option>`).join('')}</select></label>
    <div class="row hide" id="dw"><label class="field grow"><span>วันที่นัด</span><input class="inp" type="date" id="vd" min="${m.today}"></label><label class="field grow"><span>เวลา (ถ้ามี)</span><input class="inp" type="time" id="vt"></label></div>
    <label class="row" id="gw"><input type="checkbox" id="vg" checked> <span>แนบพิกัด GPS ปัจจุบัน</span></label>
    <div class="xs muted" id="gs"></div>
    <div id="pw"><label class="btn line block" for="vp">${icon('camera')} ถ่าย/เลือกรูป (ไม่บังคับ)</label><input type="file" id="vp" accept="image/*" capture="environment" class="hide"><img id="pv" class="photo hide" style="margin-top:8px" alt="ตัวอย่างรูป"></div>
    <button class="btn grad block" id="vs">บันทึก</button></div>`);
  const q = x => s.el.querySelector(x);
  const apply = () => {
    s.el.querySelectorAll('#vk button').forEach(b => b.classList.toggle('on', b.dataset.k === cur));
    q('#ow').classList.toggle('hide', cur !== 'visit'); q('#dw').classList.toggle('hide', cur !== 'appointment');
    q('#gw').classList.toggle('hide', cur !== 'visit'); q('#pw').classList.toggle('hide', cur !== 'visit');
    q('#vg').checked = cur === 'visit';
    q('#nl').textContent = cur === 'appointment' ? 'เรื่องที่นัด / สิ่งที่ต้องทำ' : cur === 'note' ? 'โน้ต' : 'รายละเอียดการเข้าพบ';
    q('#vs').textContent = cur === 'appointment' ? 'บันทึกนัดหมาย' : 'บันทึก';
  };
  const probe = async () => {
    if (cur !== 'visit' || !q('#vg').checked) { q('#gs').textContent = ''; return; }
    q('#gs').textContent = 'กำลังอ่านพิกัด…';
    try {
      gps = await getGps(); skipGps = false;
      let t = `พิกัดพร้อม (±${gps.accuracy} ม.)`;
      if (c && D.hasGps(c)) { const d = distanceKm(gps, { lat: +c.gpsLat, lng: +c.gpsLng }) * 1000; t += ` · ห่างจากพิกัดร้าน ${d < 1000 ? Math.round(d) + ' ม.' : (d / 1000).toFixed(1) + ' กม.'}`; }
      q('#gs').textContent = t;
    } catch (e) { gps = null; skipGps = true; q('#gs').innerHTML = `<span style="color:var(--warn)">${esc(errMsg(e))} — กดบันทึกอีกครั้งเพื่อบันทึกโดยไม่มีพิกัด</span>`; }
  };
  s.el.querySelectorAll('#vk button').forEach(b => b.onclick = () => { cur = b.dataset.k; apply(); probe(); });
  apply(); probe();
  q('#vg').onchange = () => { skipGps = false; probe(); };
  q('#vp').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { photo = await compressImage(f); const pv = q('#pv'); pv.src = photo.preview; pv.classList.remove('hide'); } catch { toast('อ่านรูปไม่สำเร็จ'); } };
  q('#vs').onclick = async () => {
    const note = q('#vn').value.trim();
    if (cur === 'note' && !note) return toast('กรุณาพิมพ์โน้ต');
    if (cur === 'appointment' && !q('#vd').value) return toast('กรุณาเลือกวันที่นัด');
    if (cur === 'visit' && q('#vg').checked && !gps && !skipGps) { await probe(); if (!gps) return; }
    const btn = q('#vs'); btn.disabled = true;
    try {
      const p = { customerId, kind: cur, note, outcome: q('#vo')?.value || '' };
      if (cur === 'appointment') Object.assign(p, { plannedAt: q('#vd').value, time: q('#vt').value });
      else if (cur === 'visit' && q('#vg').checked && gps) Object.assign(p, { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy });
      const op = await enqueue('visit.log', p);
      if (photo && cur === 'visit') await enqueue('photo.add', { customerId, visitId: `V-${op.opId}`, photoType: 'visit', imageBase64: photo.base64, mime: photo.mime, ...(gps && q('#vg').checked ? { lat: gps.lat, lng: gps.lng } : {}) });
      s.close(); toast(cur === 'appointment' ? 'บันทึกนัดหมายแล้ว' : 'บันทึกแล้ว');
    } catch (e) { toast(errMsg(e)); btn.disabled = false; }
  };
  return s;
}

export function completeTaskSheet(task) {
  const s = sheet(`<h3>ทำงานติดตามเสร็จ</h3><div class="stack">
    <div class="muted sm">${esc(task.note || task.title || 'ติดตาม')} · นัด ${esc(String(task.dueAt).slice(0, 10))}</div>
    <label class="field"><span>ผลการติดตาม / โน้ต (ไม่บังคับ)</span><textarea class="inp" id="cn"></textarea></label>
    <button class="btn grad block" id="cs">บันทึกว่าเสร็จแล้ว</button></div>`);
  s.el.querySelector('#cs').onclick = async e => {
    e.target.disabled = true;
    try { await enqueue('task.complete', { taskId: task.taskId, customerId: task.customerId, base: task.note, note: s.el.querySelector('#cn').value.trim() }); s.close(); toast('บันทึกแล้ว'); }
    catch (er) { toast(errMsg(er)); e.target.disabled = false; }
  };
}

export function geoPhotoSheet(customerId) {
  const m = S.model, c = m.custById.get(customerId);
  let photo = null, type = 'store';
  const has = c && D.hasGps(c);
  const s = sheet(`<div class="row between"><h3 style="margin:0">รูป + พิกัดร้าน</h3><button class="btn ghost sm" data-close>ปิด</button></div><div class="stack" style="margin-top:12px">
    <div class="card"><div class="b">พิกัดร้าน</div><div class="sm muted" style="margin:4px 0 8px">${has ? `ปัจจุบัน ${(+c.gpsLat).toFixed(5)}, ${(+c.gpsLng).toFixed(5)}` : 'ยังไม่มีพิกัด'}</div><div class="xs muted" id="gg"></div>
      <button class="btn block" id="gb" style="margin-top:6px">${icon('pin')} ${has ? 'อัปเดตเป็นตำแหน่งปัจจุบัน' : 'บันทึกตำแหน่งปัจจุบันเป็นพิกัดร้าน'}</button></div>
    <div class="card"><div class="b">รูปภาพ <span class="faint sm">(ไม่บังคับ)</span></div>
      <div class="seg" id="pt" style="margin:8px 0"><button data-t="store" class="on">รูปหน้าร้าน</button><button data-t="visit">รูปเข้าพบ</button></div>
      <label class="btn line block" for="gp">${icon('camera')} ถ่าย/เลือกรูป</label><input type="file" id="gp" accept="image/*" capture="environment" class="hide"><img id="gv" class="photo hide" style="margin-top:8px" alt="">
      <input class="inp" id="gc" placeholder="คำบรรยาย (ถ้ามี)" style="margin-top:8px">
      <button class="btn block hide" id="gs2" style="margin-top:8px">บันทึกรูป</button></div></div>`);
  const q = x => s.el.querySelector(x);
  q('#gb').onclick = async e => {
    e.target.disabled = true; q('#gg').textContent = 'กำลังอ่านพิกัด…';
    try {
      const g = await getGps();
      if (has) { const d = distanceKm(g, { lat: +c.gpsLat, lng: +c.gpsLng }) * 1000; if (d > 300 && !(await confirmBox(`ตำแหน่งใหม่ห่างจากพิกัดเดิม ${Math.round(d)} เมตร ต้องการเปลี่ยนพิกัดร้านหรือไม่?`, 'เปลี่ยนพิกัด'))) { e.target.disabled = false; q('#gg').textContent = ''; return; } }
      await enqueue('customer.geo', { customerId, lat: g.lat, lng: g.lng, accuracy: g.accuracy }); s.close(); toast(`บันทึกพิกัดแล้ว (±${g.accuracy} ม.)`);
    } catch (er) { q('#gg').innerHTML = `<span style="color:var(--bad)">${esc(errMsg(er))}</span>`; e.target.disabled = false; }
  };
  s.el.querySelectorAll('#pt button').forEach(b => b.onclick = () => { type = b.dataset.t; s.el.querySelectorAll('#pt button').forEach(x => x.classList.toggle('on', x === b)); });
  q('#gp').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { photo = await compressImage(f); q('#gv').src = photo.preview; q('#gv').classList.remove('hide'); q('#gs2').classList.remove('hide'); } catch { toast('อ่านรูปไม่สำเร็จ'); } };
  q('#gs2').onclick = async e => {
    e.target.disabled = true; let g = null; try { g = await getGps(6000); } catch {}
    try { await enqueue('photo.add', { customerId, photoType: type, caption: q('#gc').value.trim(), imageBase64: photo.base64, mime: photo.mime, ...(g ? { lat: g.lat, lng: g.lng } : {}) }); s.close(); toast('บันทึกรูปแล้ว'); }
    catch (er) { toast(errMsg(er)); e.target.disabled = false; }
  };
}

// ---- customer edit ----
const FIELDS = [
  ['name', 'ชื่อร้าน'], ['type', 'ประเภท'], ['address', 'ที่อยู่ / เส้นทาง', 'ta'], ['contactName', 'ผู้ติดต่อ'], ['paymentTerm', 'เงื่อนไขชำระ'], ['billClerk', 'เสมียนบิล'],
  ['lineId', 'LINE ID'], ['storeHours', 'เวลาเปิด-ปิด'], ['keepNote', 'บันทึกก่อนเข้าร้าน', 'ta'], ['customerNote', 'หมายเหตุลูกค้า', 'ta'], ['specialConditions', 'เงื่อนไขพิเศษ', 'ta'],
  ['birthday', 'วันเกิด', 'date'], ['taxInvoiceRequired', 'ต้องการใบกำกับภาษี'], ['taxName', 'ชื่อในใบกำกับภาษี'], ['taxAddress', 'ที่อยู่ใบกำกับภาษี', 'ta'], ['taxBranch', 'สาขา'], ['taxId', 'เลขประจำตัวผู้เสียภาษี'],
  ['receiptRequired', 'ต้องการใบเสร็จ'], ['documentNote', 'หมายเหตุเอกสาร', 'ta'],
];
// Detect how this sheet encodes active/closed so the same convention is written back.
export function activeConvention(m) {
  const vals = new Set(m.customers.map(c => String(c.activeFlag ?? '').trim().toUpperCase()));
  if (vals.has('TRUE') || vals.has('FALSE')) return ['TRUE', 'FALSE'];
  if (vals.has('1') || vals.has('0')) return ['1', '0'];
  if (vals.has('Y') || vals.has('N')) return ['Y', 'N'];
  return ['TRUE', 'FALSE'];
}
export function editCustomerSheet(customerId) {
  const m = S.model, c = m.custById.get(customerId); if (!c) return;
  const [yes, no] = activeConvention(m);
  const closed = D.isClosedFlag(c.activeFlag);
  const phones = D.custPhones(m, customerId), labels = D.custLabels(m, customerId);
  const all = [...new Set([...m.labels.values()].flat().map(l => l.label).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
  const inp = ([k, t, kind]) => kind === 'ta' ? `<label class="field"><span>${t}</span><textarea class="inp" data-k="${k}">${esc(c[k])}</textarea></label>` : `<label class="field"><span>${t}</span><input class="inp" ${kind === 'date' ? 'type="date"' : ''} data-k="${k}" value="${esc(c[k])}"></label>`;
  const s = sheet(`<div class="row between"><h3 style="margin:0">แก้ไขข้อมูลลูกค้า</h3><button class="btn ghost sm" data-close>ปิด</button></div><div class="stack" style="margin-top:12px">
    <div class="muted sm">รหัสลูกค้า ${esc(c.id)} (แก้ไม่ได้)</div>
    <label class="field"><span>สถานะ</span><select class="inp" id="ea"><option value="${yes}" ${closed ? '' : 'selected'}>ยังดำเนินกิจการ</option><option value="${no}" ${closed ? 'selected' : ''}>เลิกกิจการ</option></select></label>
    ${FIELDS.map(inp).join('')}
    <label class="field"><span>เบอร์โทร (บรรทัดละเบอร์)</span><textarea class="inp" id="ep">${esc(phones.join('\n'))}</textarea></label>
    <label class="field"><span>ป้ายกำกับ (คั่นด้วยจุลภาค)</span><input class="inp" id="el" list="all-labels" value="${esc(labels.join(', '))}"></label><datalist id="all-labels">${all.map(l => `<option value="${esc(l)}">`).join('')}</datalist>
    <button class="btn grad block" id="es">บันทึกการแก้ไข</button></div>`);
  s.el.querySelector('#es').onclick = async e => {
    e.target.disabled = true;
    try {
      const patch = {};
      s.el.querySelectorAll('[data-k]').forEach(el => { if (el.value !== String(c[el.dataset.k] ?? '')) patch[el.dataset.k] = el.value.trim(); });
      const a = s.el.querySelector('#ea').value; if (D.isClosedFlag(a) !== closed) patch.activeFlag = a;
      if (patch.name === '') { toast('ชื่อร้านต้องไม่ว่าง'); e.target.disabled = false; return; }
      let n = 0;
      if (Object.keys(patch).length) { await enqueue('customer.update', { customerId, patch }); n++; }
      const ph = s.el.querySelector('#ep').value.split('\n').map(x => x.trim()).filter(Boolean);
      if (ph.join('|') !== phones.join('|')) { await enqueue('customer.phones', { customerId, phones: ph }); n++; }
      const lb = s.el.querySelector('#el').value.split(',').map(x => x.trim()).filter(Boolean);
      if (lb.join('|') !== labels.join('|')) { await enqueue('customer.labels', { customerId, labels: lb }); n++; }
      s.close(); toast(n ? 'บันทึกแล้ว' : 'ไม่มีการเปลี่ยนแปลง');
    } catch (er) { toast(errMsg(er)); e.target.disabled = false; }
  };
}

// ---------------- create a shop in the field ----------------
export function newCustomerSheet({ onDone } = {}) {
  const m = S.model;
  const types = [...new Set(m.customers.map(c => c.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
  const terms = [...new Set(m.customers.map(c => c.paymentTerm).filter(Boolean))];
  const allLabels = [...new Set([...m.labels.values()].flat().map(l => l.label).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
  let gps = null;
  const s = sheet(`<div class="row between"><h3 style="margin:0">เพิ่มร้านใหม่</h3><button class="btn ghost sm" data-close>ปิด</button></div>
    <div class="banner" style="margin:10px 0;background:var(--blue-soft);color:var(--ink)">ร้านที่เพิ่มในภาคสนามจะได้ <b>รหัสชั่วคราว N-…</b> ยังไม่ใช่รหัสจากระบบบัญชี เมื่อมีรหัสบัญชีแล้วให้ผู้ดูแลกด “ผูกรหัสบัญชี”</div>
    <div class="stack">
    <label class="field"><span>ชื่อร้าน *</span><input class="inp" id="nn" autocomplete="off" placeholder="เช่น ส. ตัวอย่าง ซาลอน (ลาดพร้าว)"></label>
    <label class="field"><span>เบอร์โทร (บรรทัดละเบอร์)</span><textarea class="inp" id="np" style="min-height:60px" inputmode="tel"></textarea></label>
    <div id="nd"></div>
    <label class="field"><span>ประเภทร้าน</span><input class="inp" id="nt" list="n-types" placeholder="เช่น ร้านเสริมสวย"></label><datalist id="n-types">${types.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    <label class="field"><span>ที่อยู่ / เส้นทาง</span><textarea class="inp" id="na" style="min-height:60px"></textarea></label>
    <label class="field"><span>ผู้ติดต่อ</span><input class="inp" id="nc"></label>
    <label class="field"><span>เงื่อนไขชำระ</span><input class="inp" id="ny" list="n-terms" value="เงินสด"></label><datalist id="n-terms">${terms.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    <label class="field"><span>ป้ายกำกับ (คั่นด้วยจุลภาค)</span><input class="inp" id="nl" list="n-lbl"></label><datalist id="n-lbl">${allLabels.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    <label class="field"><span>หมายเหตุ</span><input class="inp" id="nm"></label>
    <div class="card soft"><div class="row between"><div class="sm" id="ng">พิกัดร้าน: ยังไม่ได้บันทึก (ไม่บังคับ)</div><button class="btn ghost sm" id="nb">${icon('pin')} ใช้ตำแหน่งนี้</button></div></div>
    <label class="row hide" id="nfw"><input type="checkbox" id="nf"> <span class="sm">ยืนยันว่าเป็นคนละร้านกับที่พบ</span></label>
    <button class="btn grad block" id="ns">บันทึกร้านใหม่</button></div>`);
  const q = x => s.el.querySelector(x);
  let dups = [];
  const check = () => {
    const phones = q('#np').value.split('\n').map(x => x.trim()).filter(Boolean);
    dups = q('#nn').value.trim().length >= 2 || phones.length ? D.findDuplicateCustomers(m, { name: q('#nn').value, phones }) : [];
    q('#nd').innerHTML = dups.length ? `<div class="banner ${dups.some(d => d.hard) ? 'bad' : ''}"><b>พบร้านที่อาจซ้ำ</b>${dups.slice(0, 4).map(d => `<div class="sm" style="margin-top:4px"><a href="#/c/${encodeURIComponent(d.c.id)}" data-close>${esc(d.c.name)}</a> · ${esc(d.c.id)} · ${d.reasons.join(', ')}</div>`).join('')}</div>` : '';
    q('#nfw').classList.toggle('hide', !dups.some(d => d.hard));
  };
  q('#nn').addEventListener('input', check); q('#np').addEventListener('input', check);
  q('#nb').onclick = async e => { e.target.disabled = true; q('#ng').textContent = 'กำลังอ่านพิกัด…'; try { gps = await getGps(); q('#ng').textContent = `พิกัดพร้อม ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} (±${gps.accuracy} ม.)`; } catch (er) { q('#ng').innerHTML = `<span style="color:var(--bad)">${esc(errMsg(er))}</span>`; } e.target.disabled = false; };
  q('#ns').onclick = async e => {
    const name = q('#nn').value.trim(); if (name.length < 2) return toast('กรุณาใส่ชื่อร้าน');
    const hard = dups.some(d => d.hard); if (hard && !q('#nf').checked) return toast('พบร้านซ้ำ — ตรวจรายการด้านบนก่อน');
    e.target.disabled = true;
    try {
      const payload = { name, type: q('#nt').value.trim(), address: q('#na').value.trim(), contactName: q('#nc').value.trim(), paymentTerm: q('#ny').value.trim(), phones: q('#np').value.split('\n').map(x => x.trim()).filter(Boolean), labels: q('#nl').value.split(',').map(x => x.trim()).filter(Boolean), customerNote: q('#nm').value.trim(), force: hard && q('#nf').checked };
      if (gps) Object.assign(payload, { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy });
      const op = await enqueue('customer.create', payload);
      const id = D.tempCustomerId(op.opId, op.at);
      s.close(); toast('เพิ่มร้านใหม่แล้ว'); (onDone || (cid => { location.hash = `#/c/${encodeURIComponent(cid)}`; }))(id);
    } catch (er) { toast(errMsg(er)); e.target.disabled = false; }
  };
}

export function assignCodeSheet(customerId) {
  const m = S.model, c = m.custById.get(customerId);
  const s = sheet(`<h3>ผูกรหัสบัญชี</h3><div class="stack"><div class="muted sm">${esc(c?.name || '')} · รหัสชั่วคราว ${esc(customerId)}</div>
    <label class="field"><span>รหัสลูกค้าจากระบบบัญชี</span><input class="inp" id="ac" inputmode="text" autocomplete="off" placeholder="เช่น 98765"></label><div id="am" class="sm"></div>
    <div class="xs muted">ระบบจะเปลี่ยนรหัสในทุกแท็บที่อ้างถึงร้านนี้ (ลูกค้า เบอร์ ป้าย บิล ออเดอร์ เข้าพบ งาน กิจกรรม พิกัด รูป) และจดบันทึกในแท็บ changes</div>
    <button class="btn grad block" id="as">ผูกรหัส</button></div>`);
  const inp = s.el.querySelector('#ac');
  inp.addEventListener('input', () => { const v = inp.value.trim(); const ex = m.custById.get(v); s.el.querySelector('#am').innerHTML = ex ? `<span style="color:var(--bad)">รหัสนี้มีแล้ว: ${esc(ex.name)}</span>` : ''; });
  s.el.querySelector('#as').onclick = async e => {
    const to = inp.value.trim(); if (!to) return toast('กรุณาใส่รหัส'); if (m.custById.has(to)) return toast('รหัสนี้มีในระบบแล้ว');
    e.target.disabled = true;
    try { await enqueue('customer.assignCode', { customerId, newId: to }); s.close(); toast('ผูกรหัสแล้ว'); setTimeout(() => { location.hash = `#/c/${encodeURIComponent(to)}`; }, 400); }
    catch (er) { toast(errMsg(er)); e.target.disabled = false; }
  };
}
