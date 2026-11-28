// Shared write-model. expandOp() turns one user action into table mutations keyed by HEADER NAMES.
// The Worker executes them against Google Sheets; the app runs the same list against its local copy
// (optimistic UI / offline queue). Rows follow the conventions aCRM already wrote into this sheet
// (Thai activity types, visit status COMPLETED, follow-up tasks type "ติดตาม", order status รอส่ง/ส่งแล้ว ...).
// Every row that has an opId column gets a deterministic opId so a re-sent op is detected and skipped.
import { nowIso, num, parseJson, todayStr, dayNum, dayStr, ORDER_ST_LIST, ORDER_ST, tempCustomerId, isTempId, NEW_PREFIX } from './domain.js';

export const CUSTOMER_EDITABLE = ['name','type','address','contactName','paymentTerm','billClerk','activeFlag','lineId','keepNote','customerNote','specialConditions','storeHours','taxInvoiceRequired','taxName','taxAddress','taxBranch','taxId','receiptRequired','documentNote','birthday'];
export const ADMIN_OPS = new Set(['settings.save', 'label.rename', 'label.delete', 'import.commit', 'review.update', 'customer.assignCode']);
export const MAX_IMPORT_ROWS = 4000;
export const APP_SOURCE = 'CRM App';
export const ACTIVITY_TYPES = ['โทร', 'นำทาง', 'โน้ต'];

export class OpError extends Error {
  constructor(msg, code = 'bad_request', extra) { super(msg); this.code = code; this.extra = extra; }
}
const need = (cond, msg) => { if (!cond) throw new OpError(msg); };
const str = v => (v === undefined || v === null ? '' : String(v));
const mapLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
const okLat = v => Number.isFinite(+v) && Math.abs(+v) <= 90 && String(v).trim() !== '';
const okLng = v => Number.isFinite(+v) && Math.abs(+v) <= 180 && String(v).trim() !== '';
const timeOfDay = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const isDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && dayStr(dayNum(date)) === date;
const dueStamp = d => `${String(d).slice(0, 10)} 00:00:00`;          // same text form aCRM used in tasks.dueAt

export function expandOp(op, ctx) {
  need(op && typeof op === 'object', 'op ไม่ถูกต้อง');
  need(str(op.opId).length >= 8, 'opId ต้องมีอย่างน้อย 8 ตัวอักษร');
  const p = op.payload || {};
  const ts = nowIso(ctx.now);
  const oid = op.opId;
  const by = ctx.by || ctx.user || '';
  const M = [];
  const dedupe = { tab: null };
  const act = (type, customerId, { refType = '', refId = '', note = '', suffix = '' } = {}) => ({
    tab: 'activities', op: 'append',
    row: { activityId: `A-${oid}${suffix}`, customerId, type, at: ts, refType, refId, note, updatedAt: ts, data: JSON.stringify({ cid: customerId, id: `A-${oid}${suffix}`, _lastOpId: oid }), opId: `${oid}${suffix ? ':' + suffix : ':a'}`.replace('::', ':') },
  });
  const checkGps = () => { const has = p.lat !== undefined && p.lat !== '' && p.lat !== null; if (has) need(okLat(p.lat) && okLng(p.lng), 'พิกัดไม่ถูกต้อง'); return has; };

  switch (op.type) {
    case 'visit.log': {
      need(str(p.customerId), 'ต้องระบุลูกค้า');
      const kind = p.kind || 'visit';
      need(['visit', 'note', 'appointment'].includes(kind), 'ประเภทไม่ถูกต้อง');
      const hasGps = checkGps();
      if (kind === 'note') {                                   // aCRM: a plain note is an activity "โน้ต"
        need(str(p.note).trim(), 'กรุณาพิมพ์โน้ต');
        M.push(act('โน้ต', p.customerId, { note: str(p.note) }));
        dedupe.tab = 'activities'; dedupe.id = `${oid}:a`;
        return { mutations: M, dedupe, result: {} };
      }
      if (kind === 'appointment') {                            // aCRM: appointments are follow-up tasks "ติดตาม"
        need(/^\d{4}-\d{2}-\d{2}/.test(str(p.plannedAt)), 'ต้องระบุวันที่นัดหมาย');
        const time = str(p.time);
        need(!time || timeOfDay.test(time), 'เวลานัดไม่ถูกต้อง');
        const taskId = `T-${oid}`;
        M.push({ tab: 'tasks', op: 'append', row: { taskId, customerId: p.customerId, type: 'ติดตาม', title: str(p.title) || 'ติดตาม', dueAt: dueStamp(p.plannedAt), status: 'open', note: str(p.note), owner: by, updatedAt: ts, data: JSON.stringify({ time, _lastOpId: oid }), opId: oid, createdAt: ts, completedAt: '' } });
        M.push(act('ติดตาม', p.customerId, { refType: 'task', refId: taskId, note: str(p.note), suffix: '' }));
        dedupe.tab = 'tasks'; dedupe.id = oid;
        return { mutations: M, dedupe, result: { taskId } };
      }
      const visitId = `V-${oid}`;
      M.push({ tab: 'visits', op: 'append', row: { visitId, customerId: p.customerId, at: ts, lat: hasGps ? str(p.lat) : '', lng: hasGps ? str(p.lng) : '', source: APP_SOURCE, note: str(p.note), fileId: str(p.fileId), status: 'COMPLETED', plannedAt: '', completedAt: ts, outcome: str(p.outcome), opId: oid, updatedAt: ts, data: JSON.stringify({ by, deviceId: str(ctx.deviceId), reason: '', photoIds: [] }) } });
      M.push(act('เข้าพบ', p.customerId, { refType: 'visit', refId: visitId, note: str(p.note) }));
      if (hasGps) M.push({ tab: 'gps', op: 'append', row: { gpsId: `G-${oid}`, customerId: p.customerId, at: ts, lat: str(p.lat), lng: str(p.lng), accuracy: str(p.accuracy), source: 'visit', visitId, note: '', updatedAt: ts, data: JSON.stringify({ by }), opId: `${oid}:g` } });
      dedupe.tab = 'visits'; dedupe.id = oid;
      return { mutations: M, dedupe, result: { visitId } };
    }
    case 'note.update': {
      const id = str(p.activityId);
      const note = str(p.note).trim();
      need(id && str(p.customerId), 'ต้องระบุบันทึกและลูกค้า');
      need(p.remove || note, 'กรุณาพิมพ์โน้ต');
      const patch = p.remove ? { type: 'ลบ', updatedAt: ts } : { note, updatedAt: ts };
      M.push({
        tab: 'activities', op: 'update', key: { col: 'activityId', val: id }, patch, mustExist: true, log: true,
        match: { customerId: str(p.customerId), type: 'โน้ต' },
      });
      dedupe.tab = 'changes'; dedupe.id = oid;
      return { mutations: M, dedupe, result: {} };
    }
    case 'visit.update':
    case 'task.update': {
      const task = op.type === 'task.update';
      const key = task ? 'taskId' : 'visitId';
      const id = str(p[key]), customerId = str(p.customerId);
      const from = str(p.from);
      need(id && customerId, 'ต้องระบุบันทึกและลูกค้า');
      need(!/^(?:cancelled|canceled)$/i.test(from), 'รายการนี้ถูกยกเลิกแล้ว');
      const patch = { updatedAt: ts };
      let mergeData;
      if (p.remove) {
        patch.status = task ? 'cancelled' : 'CANCELLED';
      } else {
        patch.note = str(p.note).trim();
        if (p.date !== undefined) {
          const date = str(p.date), time = str(p.time);
          need(isDate(date), 'วันที่นัดไม่ถูกต้อง');
          need(!time || timeOfDay.test(time), 'เวลานัดไม่ถูกต้อง');
          if (task) {
            need(from.toLowerCase() === 'open', 'แก้วันนัดได้เฉพาะงานที่ยังค้าง');
            patch.dueAt = dueStamp(date);
            mergeData = { time };
          } else {
            need(from.toLowerCase() === 'planned', 'แก้วันนัดได้เฉพาะรายการนัดหมาย');
            patch.plannedAt = dueStamp(date);
          }
        }
      }
      M.push({
        tab: task ? 'tasks' : 'visits', op: 'update', key: { col: key, val: id }, patch, mergeData, mustExist: true, log: true,
        match: { customerId, status: from },
      });
      dedupe.tab = 'changes'; dedupe.id = oid;
      return { mutations: M, dedupe, result: {} };
    }
    case 'task.complete': {
      need(str(p.taskId), 'ต้องระบุงาน');
      const patch = { status: 'done', completedAt: ts, updatedAt: ts };
      if (p.note) patch.note = [str(p.base), str(p.note)].filter(Boolean).join('\n');
      M.push({ tab: 'tasks', op: 'update', key: { col: 'taskId', val: p.taskId }, patch, mustExist: true });
      M.push(act('ติดตาม', str(p.customerId), { refType: 'task', refId: p.taskId, note: `เสร็จ ${str(p.note)}`.trim() }));
      dedupe.tab = 'activities'; dedupe.id = `${oid}:a`;
      return { mutations: M, dedupe, result: {} };
    }
    case 'visit.complete': {                                   // legacy planned visits only
      need(str(p.visitId), 'ต้องระบุ visitId');
      const hasGps = checkGps();
      const patch = { status: 'COMPLETED', at: ts, completedAt: ts, updatedAt: ts, outcome: str(p.outcome) };
      if (p.note) patch.note = str(p.note);
      if (hasGps) { patch.lat = str(p.lat); patch.lng = str(p.lng); }
      M.push({ tab: 'visits', op: 'update', key: { col: 'visitId', val: p.visitId }, patch, mustExist: true });
      M.push(act('เข้าพบ', str(p.customerId), { refType: 'visit', refId: p.visitId, note: str(p.note) }));
      dedupe.tab = 'activities'; dedupe.id = `${oid}:a`;
      return { mutations: M, dedupe, result: {} };
    }
    case 'activity.log': {                                     // aCRM logged taps on call / navigate
      need(str(p.customerId), 'ต้องระบุลูกค้า');
      need(ACTIVITY_TYPES.includes(p.type), 'ประเภทกิจกรรมไม่ถูกต้อง');
      M.push(act(p.type, p.customerId, { note: str(p.note) }));
      dedupe.tab = 'activities'; dedupe.id = `${oid}:a`;
      return { mutations: M, dedupe, result: {} };
    }
    case 'customer.create': {
      const name = str(p.name).trim();
      need(name.length >= 2, 'ต้องระบุชื่อร้าน');
      const hasGps = checkGps();
      const id = tempCustomerId(oid, ctx.now);
      const phones = [...new Set((p.phones || []).map(x => str(x).trim()).filter(Boolean))];
      const labels = [...new Set((p.labels || []).map(x => str(x).trim()).filter(Boolean))];
      M.push({ tab: 'customers', op: 'guardDuplicate', name, phones, force: !!p.force });
      M.push({ tab: 'customers', op: 'appendUnique', col: 'id', blockOnDuplicate: true, log: 'create',
        rows: [{ id, name, type: str(p.type), address: str(p.address), contactName: str(p.contactName), paymentTerm: str(p.paymentTerm), billClerk: str(p.billClerk), activeFlag: '', gpsLat: hasGps ? str(p.lat) : '', gpsLng: hasGps ? str(p.lng) : '', mapLink: hasGps ? mapLink(p.lat, p.lng) : '', lineId: str(p.lineId), keepNote: '', customerNote: str(p.customerNote), specialConditions: '', storeHours: str(p.storeHours), taxInvoiceRequired: '', taxName: '', taxAddress: '', taxBranch: '', taxId: '', receiptRequired: '', documentNote: '', photoFolderId: '', storePhotoFileIds: '', birthday: '' }] });
      if (phones.length) M.push({ tab: 'customer_phones', op: 'appendUniqueComposite', cols: ['customerId', 'seq'], rows: phones.map((ph, i) => ({ customerId: id, seq: String(i + 1), phone: ph })) });
      if (labels.length) M.push({ tab: 'customer_labels', op: 'appendUniqueComposite', cols: ['customerId', 'seq'], rows: labels.map((l, i) => ({ customerId: id, seq: String(i + 1), label: l })) });
      if (hasGps) M.push({ tab: 'gps', op: 'append', row: { gpsId: `G-${oid}`, customerId: id, at: ts, lat: str(p.lat), lng: str(p.lng), accuracy: str(p.accuracy), source: 'store', visitId: '', note: 'พิกัดร้านใหม่', updatedAt: ts, data: JSON.stringify({ by }), opId: `${oid}:g` } });
      M.push(act('เพิ่มลูกค้า', id, { refType: 'customer', refId: id, note: 'เพิ่มร้านใหม่จากภาคสนาม (ยังไม่มีรหัสบัญชี)' }));
      dedupe.tab = 'activities'; dedupe.id = `${oid}:a`;
      return { mutations: M, dedupe, result: { customerId: id } };
    }
    case 'customer.assignCode': {                              // link a field-created shop to its accounting code
      const from = str(p.customerId), to = str(p.newId).trim();
      need(isTempId(from), 'ผูกรหัสได้เฉพาะร้านที่ยังไม่มีรหัสบัญชี (รหัสขึ้นต้น N-)');
      need(/^[0-9A-Za-z][0-9A-Za-z\-*]{0,19}$/.test(to) && !to.startsWith(NEW_PREFIX), 'รหัสบัญชีไม่ถูกต้อง');
      M.push({ tab: 'customers', op: 'mustNotExist', col: 'id', val: to, message: `รหัส ${to} มีในระบบแล้ว` });
      for (const t of ['customers', 'customer_phones', 'customer_labels', 'bills', 'orders', 'visits', 'tasks', 'activities', 'gps', 'photos']) {
        M.push({ tab: t, op: 'updateAll', col: t === 'customers' ? 'id' : t === 'bills' || t === 'orders' ? 'customerId' : 'customerId', from, to });
      }
      M.push({ tab: 'changes', op: 'logOnly', entity: 'customers', id: to, action: 'ผูกรหัสบัญชี', before: JSON.stringify({ id: from }), after: JSON.stringify({ id: to }) });
      dedupe.tab = 'changes'; dedupe.id = oid;
      return { mutations: M, dedupe, result: { customerId: to } };
    }
    case 'customer.geo': {
      need(str(p.customerId), 'ต้องระบุลูกค้า');
      need(okLat(p.lat) && okLng(p.lng), 'พิกัดไม่ถูกต้อง');
      const lat = String(+(+p.lat).toFixed(7)), lng = String(+(+p.lng).toFixed(7));
      M.push({ tab: 'customers', op: 'update', key: { col: 'id', val: p.customerId }, patch: { gpsLat: lat, gpsLng: lng, mapLink: mapLink(lat, lng) }, mustExist: true, log: true });
      M.push({ tab: 'gps', op: 'append', row: { gpsId: `G-${oid}`, customerId: p.customerId, at: ts, lat, lng, accuracy: str(p.accuracy), source: 'store', visitId: str(p.visitId), note: 'อัปเดตพิกัดร้าน', updatedAt: ts, data: JSON.stringify({ by }), opId: oid } });
      dedupe.tab = 'gps'; dedupe.id = oid;
      return { mutations: M, dedupe, result: {} };
    }
    case 'customer.update': {
      need(str(p.customerId), 'ต้องระบุลูกค้า');
      const patch = {};
      for (const [k, v] of Object.entries(p.patch || {})) { need(CUSTOMER_EDITABLE.includes(k), `ไม่อนุญาตให้แก้คอลัมน์ ${k}`); patch[k] = str(v); }
      need(Object.keys(patch).length, 'ไม่มีข้อมูลที่จะแก้ไข');
      M.push({ tab: 'customers', op: 'update', key: { col: 'id', val: p.customerId }, patch, mustExist: true, log: true });
      M.push(act('เปลี่ยนข้อมูลสำคัญ', p.customerId, { refType: 'customer', refId: p.customerId, note: Object.keys(patch).join(',') }));
      dedupe.tab = 'activities'; dedupe.id = `${oid}:a`;
      return { mutations: M, dedupe, result: {} };
    }
    case 'customer.phones': {
      need(str(p.customerId), 'ต้องระบุลูกค้า');
      const phones = (p.phones || []).map(x => str(x).trim()).filter(Boolean);
      M.push({ tab: 'customer_phones', op: 'replace', key: { col: 'customerId', val: p.customerId }, rows: phones.map((ph, i) => ({ customerId: p.customerId, seq: String(i + 1), phone: ph })), log: true });
      M.push(act('เปลี่ยนข้อมูลสำคัญ', p.customerId, { refType: 'customer', refId: p.customerId, note: 'phones' }));
      dedupe.tab = 'activities'; dedupe.id = `${oid}:a`;
      return { mutations: M, dedupe, result: {} };
    }
    case 'customer.labels': {
      need(str(p.customerId), 'ต้องระบุลูกค้า');
      const labels = [...new Set((p.labels || []).map(x => str(x).trim()).filter(Boolean))];
      M.push({ tab: 'customer_labels', op: 'replace', key: { col: 'customerId', val: p.customerId }, rows: labels.map((l, i) => ({ customerId: p.customerId, seq: String(i + 1), label: l })), log: true });
      M.push(act('เปลี่ยนข้อมูลสำคัญ', p.customerId, { refType: 'customer', refId: p.customerId, note: 'labels' }));
      dedupe.tab = 'activities'; dedupe.id = `${oid}:a`;
      return { mutations: M, dedupe, result: {} };
    }
    case 'photo.add': {
      need(str(p.customerId), 'ต้องระบุลูกค้า');
      const photoType = p.photoType || 'visit';
      need(['store', 'visit', 'other'].includes(photoType), 'ประเภทรูปไม่ถูกต้อง');
      const hasGps = checkGps();
      const fileId = str(ctx.fileId || p.fileId);
      M.push({ tab: 'photos', op: 'append', row: { photoId: `P-${oid}`, customerId: p.customerId, visitId: str(p.visitId), at: ts, fileId, folderId: str(ctx.folderId), photoType, caption: str(p.caption), lat: hasGps ? str(p.lat) : '', lng: hasGps ? str(p.lng) : '', source: APP_SOURCE, updatedAt: ts, data: JSON.stringify({ by, deviceId: str(ctx.deviceId) }), opId: oid } });
      if (photoType === 'store' && fileId) M.push({ tab: 'customers', op: 'appendCsv', key: { col: 'id', val: p.customerId }, field: 'storePhotoFileIds', value: fileId, log: true });
      dedupe.tab = 'photos'; dedupe.id = oid;
      return { mutations: M, dedupe, result: { fileId } };
    }
    case 'order.save': {
      const o = p.order || {};
      need(str(o.no), 'ต้องมีเลขที่ออเดอร์');
      need(str(o.customerId), 'ต้องระบุลูกค้า');
      const status = o.status || ORDER_ST.draft;
      need(ORDER_ST_LIST.includes(status), 'สถานะออเดอร์ไม่ถูกต้อง');
      const lines = (p.lines || []).map((l, i) => {
        const qty = num(l.qty), price = num(l.price);
        need(qty >= 0 && price >= 0, `บรรทัด ${i + 1}: จำนวน/ราคาต้องไม่ติดลบ`);
        return { orderNo: o.no, line: String(i + 1), code: str(l.code), name: str(l.name), qty: String(qty), price: String(price), unit: str(l.unit), amount: String(Math.round(qty * price * 100) / 100) };
      });
      if (status === ORDER_ST.pending) need(lines.length > 0 && lines.some(l => num(l.qty) > 0), 'ออเดอร์ที่ยืนยันต้องมีสินค้า');
      M.push({ tab: 'orders', op: 'upsert', key: { col: 'no', val: o.no }, guard: { col: 'customerId', val: o.customerId, code: 'order_no_conflict' }, row: { no: o.no, date: str(o.date) || todayStr(ctx.now), customerId: o.customerId, customerNameOverride: str(o.customerNameOverride), paymentTerm: str(o.paymentTerm), vatMode: str(o.vatMode) || 'NONE', status, billNo: str(o.billNo), note: str(o.note), createdBy: by, deviceId: str(ctx.deviceId), opId: oid, updatedAt: ts }, keepOnUpdate: ['createdBy'], log: true });
      M.push({ tab: 'order_items', op: 'replace', key: { col: 'orderNo', val: o.no }, rows: lines });
      if (status === ORDER_ST.pending) M.push(act('รับออเดอร์', o.customerId, { refType: 'order', refId: o.no, note: o.no }));
      dedupe.tab = 'orders'; dedupe.id = oid;
      return { mutations: M, dedupe, result: { no: o.no } };
    }
    case 'order.status': {
      const no = str(p.no), customerId = str(p.customerId);
      const transitions = {
        [ORDER_ST.draft]: [ORDER_ST.cancelled],
        [ORDER_ST.pending]: [ORDER_ST.delivered, ORDER_ST.cancelled],
      };
      need(no && customerId, 'ต้องระบุออเดอร์และลูกค้า');
      need(transitions[p.from]?.includes(p.status), 'เปลี่ยนสถานะออเดอร์นี้ไม่ได้');
      M.push({
        tab: 'orders', op: 'update', key: { col: 'no', val: no }, patch: { status: p.status, updatedAt: ts }, mustExist: true, log: true,
        match: { customerId, status: p.from },
      });
      dedupe.tab = 'changes'; dedupe.id = oid;
      return { mutations: M, dedupe, result: {} };
    }
    case 'settings.save': {
      const d = p.data || {};
      const allowed = ['visitDef', 'dormDays', 'lateDays', 'nearDays', 'newDays', 'comm', 'vatRate'];
      const clean = {};
      for (const k of Object.keys(d)) { need(allowed.includes(k), `ไม่รู้จักการตั้งค่า ${k}`); const n = num(d[k]); need(n >= 0 && n <= 3650, `ค่า ${k} ไม่อยู่ในช่วงที่ยอมรับ`); clean[k] = n; }
      need(Object.keys(clean).length, 'ไม่มีค่าที่จะบันทึก');
      M.push({ tab: 'systemSettings', op: 'mergeSettings', row: { id: `rules-${ts}`, updatedAt: ts }, data: clean, log: true });
      dedupe.tab = 'changes'; dedupe.id = oid;
      return { mutations: M, dedupe, result: {} };
    }
    case 'label.rename': {
      const from = str(p.from).trim(), to = str(p.to).trim();
      need(from && to && from !== to, 'ชื่อป้ายกำกับไม่ถูกต้อง');
      M.push({ tab: 'customer_labels', op: 'renameLabel', from, to, log: true });
      dedupe.tab = 'changes'; dedupe.id = oid;
      return { mutations: M, dedupe, result: {} };
    }
    case 'label.delete': {
      const label = str(p.label).trim();
      need(label, 'ต้องระบุป้ายกำกับ');
      M.push({ tab: 'customer_labels', op: 'deleteLabel', label, log: true });
      dedupe.tab = 'changes'; dedupe.id = oid;
      return { mutations: M, dedupe, result: {} };
    }
    case 'review.update': {
      need(str(p.reviewId), 'ต้องระบุ reviewId');
      need(['pending', 'confirmed', 'ignored'].includes(p.status), 'สถานะไม่ถูกต้อง');
      M.push({ tab: 'IMPORT_REVIEW', op: 'update', key: { col: 'reviewId', val: p.reviewId }, patch: { status: p.status, reviewedBy: by, reviewedAt: ts, resolutionNote: str(p.note) }, mustExist: true, log: true });
      dedupe.tab = 'changes'; dedupe.id = oid;
      return { mutations: M, dedupe, result: {} };
    }
    case 'import.commit': {
      const b = p.batch || {};
      need(str(b.batchId), 'ต้องมี batchId');
      const bills = p.bills || [], items = p.items || [], reviews = p.reviews || [], customers = p.customers || [], links = p.orderLinks || [];
      need(bills.length + items.length + reviews.length + customers.length * 3 + links.length <= MAX_IMPORT_ROWS, `ข้อมูลต่อรอบเกิน ${MAX_IMPORT_ROWS} แถว`);
      if (p.first) {
        M.push({ tab: 'IMPORT_BATCHES', op: 'appendUnique', col: 'fileHash', blockOnDuplicate: true, rows: [{ batchId: b.batchId, at: ts, kind: str(b.kind) || 'bills', fileName: str(b.fileName), fileHash: str(b.fileHash), source: str(b.source) || 'TTX ในแอป', format: str(b.format) || 'TTX cp874', status: str(b.status) || 'ok', summary: str(b.summary), user: by, deviceId: str(ctx.deviceId) }] });
        M.push({ tab: 'changes', op: 'logOnly', entity: 'นำเข้า', id: b.batchId, action: `นำเข้า TTX ${b.kind === 'customers' ? 'ลูกค้า' : 'บิล'} · ${b.batchId}`, before: '', after: '{}' });
      }
      if (bills.length) M.push({ tab: 'bills', op: 'appendUnique', col: 'no', rows: bills.map(x => ({ no: str(x.no), date: str(x.date), customerId: str(x.customerId), customerNameOverride: str(x.customerNameOverride), paymentTerm: str(x.paymentTerm), openedBy: str(x.openedBy), salesperson: str(x.salesperson), vatMode: str(x.vatMode) || 'NONE', source: str(x.source) || str(b.fileName), updatedAt: ts })) });
      if (items.length) M.push({ tab: 'bill_items', op: 'appendUniqueComposite', cols: ['billNo', 'line'], rows: items.map(x => ({ billNo: str(x.billNo), line: str(x.line), code: str(x.code), name: str(x.name), qty: str(x.qty), price: str(x.price), amount: str(x.amount) })) });
      if (customers.length) {
        M.push({ tab: 'customers', op: 'appendUnique', col: 'id', rows: customers.map(c => ({ ...c.customer, id: str(c.customer.id) })) });
        const ph = customers.flatMap(c => (c.phones || []).map((phone, i) => ({ customerId: str(c.customer.id), seq: String(i + 1), phone })));
        if (ph.length) M.push({ tab: 'customer_phones', op: 'appendUniqueComposite', cols: ['customerId', 'seq'], rows: ph });
        M.push({ tab: 'activities', op: 'appendUnique', col: 'activityId', rows: customers.map(c => ({ activityId: `A-${b.batchId}-${c.customer.id}`, customerId: str(c.customer.id), type: 'เพิ่มลูกค้า', at: ts, refType: 'customer', refId: str(c.customer.id), note: 'เพิ่มลูกค้า (นำเข้าจาก TTX)', updatedAt: ts, data: JSON.stringify({ cid: str(c.customer.id), _lastOpId: oid }), opId: `${b.batchId}:${c.customer.id}` })) });
      }
      for (const l of links) M.push({ tab: 'orders', op: 'update', key: { col: 'no', val: l.no }, patch: { billNo: l.billNo, status: ORDER_ST.delivered, note: `เชื่อมบิล ${l.billNo}`, updatedAt: ts }, log: true });
      if (reviews.length) M.push({ tab: 'IMPORT_REVIEW', op: 'appendUnique', col: 'reviewId', rows: reviews.map((r, i) => ({ reviewId: str(r.reviewId) || `${b.batchId}-R${i + 1}`, batchId: b.batchId, sourceFile: str(b.fileName), entityType: str(r.entityType), sourceKey: str(r.sourceKey), issueCode: str(r.issueCode), severity: str(r.severity) || 'low', sourceValue: str(r.sourceValue), existingValue: str(r.existingValue), suggestedAction: str(r.suggestedAction), status: 'pending', reviewedBy: '', reviewedAt: '', resolutionNote: '', createdAt: ts })) });
      dedupe.tab = null;
      return { mutations: M, dedupe, result: {} };
    }
    default:
      throw new OpError(`ไม่รู้จักประเภทคำสั่ง ${op.type}`);
  }
}

// ---- local mirror: apply mutations to an in-memory raw dataset ({tab: objects[]}) ----
export function applyMutationsLocal(raw, mutations) {
  for (const m of mutations) {
    const rows = raw[m.tab] || (raw[m.tab] = []);
    switch (m.op) {
      case 'append': rows.push({ ...m.row }); break;
      case 'appendUnique': for (const r of m.rows) if (!rows.some(x => x[m.col] === r[m.col])) rows.push({ ...r }); break;
      case 'appendUniqueComposite': for (const r of m.rows) if (!rows.some(x => m.cols.every(c => x[c] === r[c]))) rows.push({ ...r }); break;
      case 'update': {
        const row = rows.find(x => x[m.key.col] === String(m.key.val));
        if (row && Object.entries(m.match || {}).every(([key, value]) => row[key] === value)) {
          Object.assign(row, m.patch);
          if (m.mergeData) row.data = JSON.stringify({ ...parseJson(row.data), ...m.mergeData });
        }
        break;
      }
      case 'updateWhere': for (const r of rows) if (String(r[m.key.col] || '').includes(m.key.contains)) Object.assign(r, m.patch); break;
      case 'updateAll': for (const r of rows) if (r[m.col] === m.from) r[m.col] = m.to; break;
      case 'upsert': { const r = rows.find(x => x[m.key.col] === String(m.key.val)); if (r) { const keep = {}; for (const k of m.keepOnUpdate || []) keep[k] = r[k]; Object.assign(r, m.row, keep); } else rows.push({ ...m.row }); break; }
      case 'replace': { raw[m.tab] = rows.filter(x => x[m.key.col] !== String(m.key.val)).concat(m.rows.map(r => ({ ...r }))); break; }
      case 'appendCsv': { const r = rows.find(x => x[m.key.col] === String(m.key.val)); if (r) { const cur = String(r[m.field] || '').split(',').filter(Boolean); if (!cur.includes(m.value)) cur.push(m.value); r[m.field] = cur.join(','); } break; }
      case 'mergeSettings': { const cur = rows.length ? parseJson(rows.reduce((a, b) => (String(a.updatedAt) >= String(b.updatedAt) ? a : b)).data, {}) : {}; rows.push({ ...m.row, data: JSON.stringify({ ...cur, ...m.data }) }); break; }
      case 'renameLabel': {
        const dupOwners = new Set(rows.filter(x => x.label === m.to).map(x => x.customerId));
        raw[m.tab] = rows.filter(x => !(x.label === m.from && dupOwners.has(x.customerId))).map(x => (x.label === m.from ? { ...x, label: m.to } : x));
        break;
      }
      case 'deleteLabel': raw[m.tab] = rows.filter(x => x.label !== m.label); break;
      default: break;   // guardDuplicate / mustNotExist / logOnly: server-side only
    }
  }
}
