import * as D from '../shared/domain.js';
import { esc, icon, fmtDate, fmtDateTime, sheet, debounce, toast, confirmBox } from '../ui.js';
import { photoUrl, enqueue, S } from '../data.js';
import { billLinesHtml, openBill, emptyMsg, pager, bindPager } from './common.js';
import { visitSheet, geoPhotoSheet, editCustomerSheet, completeTaskSheet, assignCodeSheet } from './forms.js';

function daysToBirthday(b, today) {
  const m = /^(?:(\d{4})-)?(\d{2})-(\d{2})/.exec(String(b || ''));
  if (!m) return null;
  const y = +today.slice(0, 4);
  let next = D.dayNum(`${y}-${m[2]}-${m[3]}`);
  const t = D.dayNum(today);
  if (next < t) next = D.dayNum(`${y + 1}-${m[2]}-${m[3]}`);
  return Number.isFinite(next) ? next - t : null;
}

export default function customer({ m, params, query }) {
  const id = params[0], c = m.custById.get(id);
  if (!c) return { html: `<div class="banner bad">ไม่พบลูกค้า ${esc(id)}</div>`, title: 'ลูกค้า' };
  const tab = ['overview', 'info', 'history', 'visits'].includes(query.tab) ? query.tab : 'overview';
  const st = D.customerStats(m, id);
  const phones = D.custPhones(m, id), labels = D.custLabels(m, id);
  const hasGps = D.hasGps(c);
  const navHref = hasGps ? `https://www.google.com/maps/dir/?api=1&destination=${c.gpsLat},${c.gpsLng}` : c.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.name + ' ' + c.address)}` : '';

  const hero = `<div class="c hd">
    <div class="hdn">${esc(c.name)}</div>
    <div class="t" style="margin-top:3px">รหัส ${esc(c.id)}${c.type ? ' · ' + esc(c.type) : ''}</div>
    <div class="chips" style="margin-top:8px"><span class="pill ${st.status === 'current' ? 'p-grn' : st.status === 'closed' ? 'p-gry' : 'p-amb'}">${D.STATUS_TH[st.status]}</span>${D.isTempId(id) ? '<span class="pill p-amb">ยังไม่มีรหัสบัญชี</span>' : ''}${labels.map(l => `<a class="pill p-blu" href="#/customers?label=${encodeURIComponent(l)}">${esc(l)}</a>`).join('')}</div>
    <div class="quick customer-quick" style="margin-top:10px">
      <button class="btn line" data-act="note">${icon('pin')}บันทึก</button>
      <button class="btn line" data-act="geo">${icon('camera')}รูป+พิกัด</button>
      <a class="btn line" href="#/order/new?c=${encodeURIComponent(id)}">${icon('cart')}รับออเดอร์</a>
      ${phones.length ? `<button class="btn line" data-act="call">${icon('phone')}โทร</button>` : `<button class="btn line" disabled>${icon('phone')}โทร</button>`}
      ${navHref ? `<a class="btn line" href="${esc(navHref)}" target="_blank" rel="noopener">${icon('nav')}นำทาง</a>` : `<button class="btn line" disabled>${icon('nav')}นำทาง</button>`}
    </div></div>
    <div class="tabs">${[['overview', 'ภาพรวม'], ['info', 'ข้อมูล'], ['history', 'ประวัติซื้อ'], ['visits', 'เข้าพบ']].map(([k, t]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;

  let body = '', after = () => {};
  if (tab === 'overview') ({ body, after } = overview(m, c, st, hasGps));
  else if (tab === 'info') { body = info(m, c, phones, labels); after = root => { root.querySelector('#edit').onclick = () => editCustomerSheet(c.id); root.querySelector('#assign')?.addEventListener('click', () => assignCodeSheet(c.id)); }; }
  else if (tab === 'history') ({ body, after } = history(m, c));
  else ({ body, after } = visitsTab(m, c));

  return {
    title: c.name,
    html: `${hero}${body}`,
    after(root) {
      root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { history.replaceState(null, '', `#/c/${encodeURIComponent(id)}?tab=${b.dataset.tab}`); window.dispatchEvent(new HashChangeEvent('hashchange')); });
      root.querySelector('[data-act="note"]')?.addEventListener('click', () => visitSheet(id));
      root.querySelector('a.btn[target]')?.addEventListener('click', () => { enqueue('activity.log', { customerId: id, type: 'นำทาง', note: hasGps ? `${c.gpsLat},${c.gpsLng}` : 'ค้นจากที่อยู่' }).catch(() => {}); });
      root.querySelector('[data-act="geo"]')?.addEventListener('click', () => geoPhotoSheet(id));
      root.querySelector('[data-act="call"]')?.addEventListener('click', () => {
        const logCall = ph => enqueue('activity.log', { customerId: id, type: 'โทร', note: ph }).catch(() => {});
        if (phones.length === 1) { logCall(phones[0]); location.href = `tel:${phones[0].replace(/[^\d+]/g, '')}`; return; }
        const sh = sheet(`<h3>โทรหา ${esc(c.name)}</h3><div class="list">${phones.map(p => `<a class="li" data-ph="${esc(p)}" href="tel:${esc(p.replace(/[^\d+]/g, ''))}" style="color:inherit">${icon('phone')}<div class="grow t">${esc(p)}</div></a>`).join('')}</div>`);
        sh.el.addEventListener('click', e => { const a = e.target.closest('[data-ph]'); if (a) logCall(a.dataset.ph); });
      });
      return after(root);
    },
  };
}

function overview(m, c, st, hasGps) {
  const lb = D.lastBillOf(m, c.id);
  const reg = D.regularItems(m, c.id, 8);
  const lastVisits = (m.visitsByCust.get(c.id) || []).filter(D.visitDone);
  const lv = lastVisits[lastVisits.length - 1];
  const bd = daysToBirthday(c.birthday, m.today);
  const gpsRows = m.gpsByCust.get(c.id) || [];
  const lastGps = gpsRows[gpsRows.length - 1];
  const fileIds = String(c.storePhotoFileIds || '').split(',').map(s => s.trim()).filter(Boolean);
  const cyc = st.status === 'closed' ? 'เลิกกิจการ' : !st.eligible ? 'ยังไม่มีรอบ' : st.dueDiff < 0 ? `<b class="rd">เกินรอบ ${-st.dueDiff} วัน</b> (ครบรอบ ${fmtDate(st.dueDate)})` : st.dueDiff === 0 ? '<b>ถึงรอบวันนี้</b>' : `ถึงรอบ ${fmtDate(st.dueDate)} (อีก ${st.dueDiff} วัน)`;
  const pre = [c.specialConditions && `<div><b>เงื่อนไขพิเศษ</b><br>${esc(c.specialConditions)}</div>`, c.storeHours && `<div class="sm muted">เวลาเปิด-ปิด ${esc(c.storeHours)}</div>`, lv?.note && `<div class="sm muted">เข้าพบล่าสุด ${fmtDate(D.dateOf(lv.at))}: ${esc(lv.note)}</div>`].filter(Boolean);
  const body = `
    <div class="card soft"><div class="row between"><div class="sm muted">ซื้อล่าสุด</div><div class="b">${st.lastDate ? `${fmtDate(st.lastDate)} · ${st.daysSince} วันที่แล้ว` : '—'}</div></div>
      <div class="sm" style="margin-top:4px">รอบลูกค้า: ${cyc}</div>
      <div class="row between sm muted" style="margin-top:6px"><span>${st.bills} บิล · ยอดรวม ${D.money(st.total)} ฿</span><span>เข้าพบล่าสุด ${st.lastVisit ? fmtDate(st.lastVisit) : 'ยังไม่เคย'}</span></div></div>
    <div class="sec"><span>บันทึกก่อนเข้าร้าน</span><button class="btn ghost sm" data-pre-note>${icon('plus')} เพิ่มบันทึก</button></div>
    <div class="card soft">${c.keepNote ? esc(c.keepNote).replace(/\n/g, '<br>') : '<span class="muted">ยังไม่มีบันทึกก่อนเข้าร้าน</span>'}</div>
    ${pre.length ? `<div class="banner" style="background:var(--blue-soft);color:var(--ink)">${pre.join('<div style="height:6px"></div>')}</div>` : ''}
    <div class="sec"><span>บิลล่าสุด</span>${lb ? `<a href="#/c/${encodeURIComponent(c.id)}?tab=history">ทั้งหมด</a>` : ''}</div>
    ${lb ? `<div class="card" data-bill="${esc(lb.no)}" style="cursor:pointer"><div class="row between"><span class="b">บิล ${esc(lb.no)}</span><span class="b num">${D.money(D.billTotal(m, lb.no))} ฿</span></div><div class="xs muted">${fmtDate(lb.date)} · ${esc(lb.paymentTerm || '')}</div>${billLinesHtml(m, lb.no)}</div>` : emptyMsg('ยังไม่มีบิล')}
    <div class="sec">สินค้าที่สั่งประจำ</div>
    ${reg.length ? `<div class="list">${reg.map(r => `<div class="li" style="cursor:default"><div class="grow"><div class="t" style="font-weight:500">${esc(r.name)}</div><div class="s">ซื้อ ${r.bills} บิล · ล่าสุด ${D.num(r.lastQty)} × ${D.money(r.lastPrice)}</div></div></div>`).join('')}</div>` : emptyMsg('ยังไม่มีข้อมูลสินค้าที่ซื้อซ้ำ')}
    <div class="sec">วันเกิด</div>
    <div class="card soft">${c.birthday ? `${esc(fmtDate(c.birthday))}${bd !== null ? ` · ${bd === 0 ? '<b style="color:var(--ok)">วันนี้!</b>' : `อีก ${bd} วัน`}` : ''}` : '<span class="muted">ยังไม่มีข้อมูลวันเกิด</span>'}</div>
    <div class="sec">รูปหน้าร้าน</div>
    <div class="photo" id="sp">${fileIds.length ? 'กำลังโหลดรูป…' : 'ยังไม่มีรูปหน้าร้าน'}</div>
    <div class="sec">พิกัดร้าน</div>
    <div class="card soft row between"><div>${hasGps ? `<span class="badge ok">มีพิกัด</span> <span class="sm muted">${(+c.gpsLat).toFixed(5)}, ${(+c.gpsLng).toFixed(5)}</span>` : `<span class="badge warn">ยังไม่มีพิกัด</span>`}${lastGps ? `<div class="xs faint">อัปเดตล่าสุด ${fmtDateTime(lastGps.at)}${lastGps.accuracy ? ` · ±${esc(lastGps.accuracy)} ม.` : ''}</div>` : ''}</div>
      <button class="btn ghost sm" data-act="geo2">${hasGps ? 'อัปเดต' : 'เพิ่มพิกัด'}</button></div>`;
  return {
    body,
    after(root) {
      root.querySelector('[data-bill]')?.addEventListener('click', e => openBill(m, e.currentTarget.dataset.bill));
      root.querySelector('[data-pre-note]').onclick = () => {
        const form = sheet(`<h3>บันทึกก่อนเข้าร้าน</h3><textarea class="inp" aria-label="บันทึกก่อนเข้าร้าน" rows="4">${esc(c.keepNote || '')}</textarea><button class="btn grad block" data-save>บันทึก</button>`);
        const save = form.el.querySelector('[data-save]');
        save.onclick = async () => {
          save.disabled = true;
          try {
            await enqueue('customer.update', { customerId: c.id, patch: { keepNote: form.el.querySelector('textarea').value.trim() } });
            form.close();
            toast('บันทึกแล้ว');
          } catch (error) {
            toast(error.message);
            save.disabled = false;
          }
        };
      };
      root.querySelector('[data-act="geo2"]')?.addEventListener('click', () => geoPhotoSheet(c.id));
      if (fileIds.length) photoUrl(fileIds[fileIds.length - 1]).then(u => { const el = root.querySelector('#sp'); if (el) el.innerHTML = u ? `<img src="${u}" alt="รูปหน้าร้าน">` : 'โหลดรูปไม่สำเร็จ'; });
    },
  };
}

function info(m, c, phones, labels) {
  const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v).replace(/\n/g, '<br>')}</dd>` : '');
  const temp = D.isTempId(c.id) ? `<div class="banner" style="margin-bottom:10px"><b>ร้านนี้ยังไม่มีรหัสจากระบบบัญชี</b> (รหัสชั่วคราว ${esc(c.id)}) ${S.user?.isAdmin ? `<button class="btn sm" id="assign" style="margin-top:8px">ผูกรหัสบัญชี</button>` : '· ให้ผู้ดูแลผูกรหัสเมื่อมีรหัสบัญชี'}</div>` : '';
  return `${temp}<div class="row between"><div class="sec" style="margin:0">ข้อมูลลูกค้า</div><button class="btn ghost sm" id="edit">${icon('edit')} แก้ไข</button></div>
    <dl class="kv">${row('รหัส', c.id)}${row('ชื่อร้าน', c.name)}${row('ประเภท', c.type)}${row('ผู้ติดต่อ', c.contactName)}${row('เบอร์โทร', phones.join(', '))}${row('LINE', c.lineId)}${row('ที่อยู่', c.address)}${row('เวลาเปิด-ปิด', c.storeHours)}${row('เงื่อนไขชำระ', c.paymentTerm)}${row('เสมียนบิล', c.billClerk)}${row('ป้ายกำกับ', labels.join(', '))}${row('บันทึกก่อนเข้าร้าน', c.keepNote)}${row('หมายเหตุลูกค้า', c.customerNote)}${row('เงื่อนไขพิเศษ', c.specialConditions)}${row('วันเกิด', c.birthday)}${row('แผนที่', c.mapLink)}</dl>
    <div class="sec">เอกสาร / ภาษี</div>
    <dl class="kv">${row('ใบกำกับภาษี', c.taxInvoiceRequired)}${row('ชื่อใบกำกับ', c.taxName)}${row('ที่อยู่ใบกำกับ', c.taxAddress)}${row('สาขา', c.taxBranch)}${row('เลขผู้เสียภาษี', c.taxId)}${row('ใบเสร็จ', c.receiptRequired)}${row('หมายเหตุเอกสาร', c.documentNote)}</dl>`;
}

function history(m, c) {
  const bills = [...(m.billsByCust.get(c.id) || [])].reverse();
  const rowHtml = b => { const items = m.itemsByBill.get(b.no) || []; return `<div class="li" data-bill="${esc(b.no)}"><div class="grow"><div class="t">บิล ${esc(b.no)}</div><div class="s ell">${fmtDate(b.date)} · ${items.length} รายการ · ${esc(items.slice(0, 2).map(i => i.name).join(', '))}</div></div><div class="r b num">${D.money(D.billTotal(m, b.no))}</div></div>`; };
  const body = `<label class="search">${icon('search')}<input id="hq" type="search" placeholder="ค้นหาเลขบิล หรือชื่อสินค้า" autocomplete="off"></label><div class="muted sm" id="hc" style="margin:8px 0">${bills.length} บิล · รวม ${D.money(D.customerStats(m, c.id).total)} ฿</div><div id="hl" class="list"></div>`;
  return {
    body,
    after(root) {
      const inp = root.querySelector('#hq'), list = root.querySelector('#hl'), cnt = root.querySelector('#hc');
      const draw = () => {
        const t = D.normText(inp.value);
        const rows = t ? bills.filter(b => b.no.includes(inp.value.trim()) || (m.itemsByBill.get(b.no) || []).some(i => D.normText(i.name).includes(t) || D.normText(i.code) === t)) : bills;
        cnt.textContent = t ? `พบ ${rows.length} บิล` : `${bills.length} บิล · รวม ${D.money(D.customerStats(m, c.id).total)} ฿`;
        list.innerHTML = rows.length ? pager(rows, rowHtml, { id: 'hb' }) : emptyMsg('ไม่พบบิล');
        bindPager(list, rows, rowHtml, { id: 'hb' });
      };
      draw();
      inp.addEventListener('input', debounce(draw));
      root.addEventListener('click', e => { const b = e.target.closest('[data-bill]'); if (b) openBill(m, b.dataset.bill); });
    },
  };
}

function visitsTab(m, c) {
  const ev = [];
  for (const v of m.visitsByCust.get(c.id) || []) ev.push({ k: D.visitPlanned(v) ? 'planned' : 'visit', t: v.at || v.plannedAt, v });
  for (const t of m.tasksByCust.get(c.id) || []) ev.push({ k: String(t.status).toLowerCase() === 'open' ? 'task' : 'taskdone', t: t.completedAt || t.dueAt, v: t });
  const visitIds = new Set((m.visitsByCust.get(c.id) || []).map(v => v.visitId));
  const taskIds = new Set((m.tasksByCust.get(c.id) || []).map(t => t.taskId));
  for (const a of m.activitiesByCust.get(c.id) || []) {
    if (a.type === 'ลบ' || (a.refType === 'visit' && visitIds.has(a.refId)) || (a.refType === 'task' && taskIds.has(a.refId))) continue;
    ev.push({ k: 'act', t: a.at, v: a });
  }
  ev.sort((a, b) => String(b.t).localeCompare(String(a.t)));
  const badge = e => ({ visit: ['เข้าพบ', 'ok'], planned: ['นัดหมาย', 'warn'], task: ['ติดตาม', 'warn'], taskdone: ['ติดตามแล้ว', ''], act: [e.v.type, 'gray'] }[e.k]);
  const photos = (m.photosByCust.get(c.id) || []).length;
  const nVisits = ev.filter(e => e.k === 'visit').length, open = ev.filter(e => e.k === 'task' || e.k === 'planned').length;
  const row = e => {
    const [t, cls] = badge(e), v = e.v;
    const time = D.parseJson(v.data).time;
    const when = e.k === 'task' ? 'นัด ' + fmtDate(v.dueAt) + (time ? ' · ' + esc(time) : '') : e.k === 'planned' ? 'นัด ' + fmtDate(v.plannedAt) : fmtDateTime(e.t);
    const note = e.k === 'task' || e.k === 'taskdone' ? v.note || v.title : v.note;
    return `<div class="li" style="cursor:default;align-items:flex-start"><div class="grow"><div class="row"><span class="badge ${cls}">${esc(t)}</span><span class="xs faint">${when}</span></div>
      <div class="sm" style="margin-top:4px;white-space:pre-line">${esc(note || '—')}</div>${v.outcome ? `<div class="xs muted">ผล: ${esc(v.outcome)}</div>` : ''}${e.k === 'visit' && v.lat ? `<div class="xs faint">${icon('pin')} ${(+v.lat).toFixed(4)}, ${(+v.lng).toFixed(4)}</div>` : ''}</div>
      ${e.k === 'act' && v.type === 'โน้ต' ? `<button class="btn ghost sm" data-edit-note="${esc(v.activityId)}">แก้ไข</button>` : ''}
      ${e.k === 'task' ? `<button class="btn ghost sm" data-done="${esc(v.taskId)}">เสร็จแล้ว</button>` : ''}</div>`;
  };
  const body = `<div class="row"><button class="btn grad grow" data-act="note2">${icon('plus')} บันทึกเข้าพบ / โน้ต / นัดหมาย</button></div>
    <div class="muted sm" style="margin-top:8px">เข้าพบ ${nVisits} ครั้ง · รูป ${photos} · งานติดตามค้าง ${open}</div>
    <div class="list" style="margin-top:6px">${ev.map(row).join('') || emptyMsg('ยังไม่มีบันทึกเข้าพบ')}</div>`;
  return {
    body,
    after(root) {
      root.querySelector('[data-act="note2"]').onclick = () => visitSheet(c.id);
      root.querySelectorAll('[data-edit-note]').forEach(button => {
        button.onclick = () => editNote(c.id, ev.find(e => e.v.activityId === button.dataset.editNote).v);
      });
      root.querySelectorAll('[data-done]').forEach(b => b.onclick = () => completeTaskSheet((m.tasksByCust.get(c.id) || []).find(t => t.taskId === b.dataset.done)));
    },
  };
}

function editNote(customerId, activity) {
  const form = sheet(`<h3>แก้ไขโน้ต</h3><label class="field"><span>ข้อความ</span><textarea class="inp" rows="4">${esc(activity.note)}</textarea></label>
    <div class="row"><button class="btn ghost" data-remove>ลบโน้ต</button><button class="btn grad grow" data-save>บันทึก</button></div>`);
  const buttons = [...form.el.querySelectorAll('[data-save],[data-remove]')];
  const submit = async remove => {
    buttons.forEach(button => button.disabled = true);
    try {
      await enqueue('note.update', { customerId, activityId: activity.activityId, note: form.el.querySelector('textarea').value, remove });
      form.close();
      toast(remove ? 'บันทึกการลบแล้ว' : 'บันทึกการแก้ไขแล้ว');
    } catch (error) {
      toast(error.message);
      buttons.forEach(button => button.disabled = false);
    }
  };
  form.el.querySelector('[data-save]').onclick = () => submit(false);
  form.el.querySelector('[data-remove]').onclick = async () => {
    if (await confirmBox('ลบโน้ตนี้จากประวัติของร้าน?', 'ลบโน้ต')) await submit(true);
  };
}
