// Shared write-model. expandOp() turns one user action into table mutations keyed by HEADER NAMES.
// The Worker executes them against Google Sheets; the app runs the same list against its local copy
// (optimistic UI / offline queue). Every row that has an opId column gets a deterministic opId so a
// re-sent op can be detected and skipped (no duplicate saves).
import { nowIso, num, parseJson, dateOf, todayStr } from './domain.js';

export const CUSTOMER_EDITABLE = ['name','type','address','contactName','paymentTerm','billClerk','activeFlag','lineId','keepNote','customerNote','specialConditions','storeHours','taxInvoiceRequired','taxName','taxAddress','taxBranch','taxId','receiptRequired','documentNote','birthday'];
export const ADMIN_OPS = new Set(['settings.save', 'label.rename', 'label.delete', 'import.commit', 'review.update']);
export const MAX_IMPORT_ROWS = 4000;

export class OpError extends Error {
  constructor(msg, code = 'bad_request') { super(msg); this.code = code; }
}
const need = (cond, msg) => { if (!cond) throw new OpError(msg); };
const str = v => (v === undefined || v === null ? '' : String(v));
const mapLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
const okLat = v => Number.isFinite(+v) && Math.abs(+v) <= 90 && String(v).trim() !== '';
const okLng = v => Number.isFinite(+v) && Math.abs(+v) <= 180 && String(v).trim() !== '';

// ctx: { now:Date.now(), user:'email', deviceId }
export function expandOp(op, ctx) {
  need(op && typeof op === 'object', 'op ไม่ถูกต้อง');
  need(str(op.opId).length >= 8, 'opId ต้องมีอย่างน้อย 8 ตัวอักษร');
  const p = op.payload || {};
  const ts = nowIso(ctx.now);
  const oid = op.opId;
  const M = [];            // mutations
  const dedupe = { tab: null }; // which tab/opId decides duplicate

  switch (op.type) {
    case 'visit.log': {
      need(str(p.customerId), 'ต้องระบุลูกค้า');
      const kind = p.kind || 'visit';
      need(['visit', 'checkin', 'note', 'appointment'].includes(kind), 'ประเภทไม่ถูกต้อง');
      const hasGps = p.lat !== undefined && p.lat !== '' && p.lat !== null;
      if (hasGps) need(okLat(p.lat) && okLng(p.lng), 'พิกัดไม่ถูกต้อง');
      const visitId = `V-${oid}`;
      const data = JSON.stringify({ kind, contactMade: !!p.contactMade, ...(p.extra || {}) });
      if (kind === 'appointment') {
        need(/^\d{4}-\d{2}-\d{2}/.test(str(p.plannedAt)), 'ต้องระบุวันที่นัดหมาย');
        M.push({ tab: 'visits', op: 'append', row: { visitId, customerId: p.customerId, at: '', lat: '', lng: '', source: 'app', note: str(p.note), fileId: '', status: 'planned', plannedAt: str(p.plannedAt), completedAt: '', outcome: '', opId: oid, updatedAt: ts, data } });
        M.push({ tab: 'tasks', op: 'append', row: { taskId: `T-${oid}`, customerId: p.customerId, type: 'appointment', title: str(p.title) || 'นัดหมายเข้าพบ', dueAt: str(p.plannedAt), status: 'open', note: str(p.note), owner: ctx.user, updatedAt: ts, data: JSON.stringify({ visitId }), opId: `${oid}:t`, createdAt: ts, completedAt: '' } });
        M.push({ tab: 'activities', op: 'append', row: { activityId: `A-${oid}`, customerId: p.customerId, type: 'appointment', at: ts, refType: 'visit', refId: visitId, note: str(p.note), updatedAt: ts, data: '', opId: `${oid}:a` } });
      } else {
        M.push({ tab: 'visits', op: 'append', row: { visitId, customerId: p.customerId, at: ts, lat: hasGps ? str(p.lat) : '', lng: hasGps ? str(p.lng) : '', source: 'app', note: str(p.note), fileId: str(p.fileId), status: 'done', plannedAt: '', completedAt: ts, outcome: str(p.outcome), opId: oid, updatedAt: ts, data } });
        M.push({ tab: 'activities', op: 'append', row: { activityId: `A-${oid}`, customerId: p.customerId, type: kind === 'note' ? 'note' : 'visit', at: ts, refType: 'visit', refId: visitId, note: str(p.note), updatedAt: ts, data: '', opId: `${oid}:a` } });
        if (hasGps) M.push({ tab: 'gps', op: 'append', row: { gpsId: `G-${oid}`, customerId: p.customerId, at: ts, lat: str(p.lat), lng: str(p.lng), accuracy: str(p.accuracy), source: 'visit', visitId, note: '', updatedAt: ts, data: '', opId: `${oid}:g` } });
      }
      dedupe.tab = 'visits'; dedupe.id = oid;
      return { mutations: M, dedupe, result: { visitId } };
    }
    case 'visit.complete': {
      need(str(p.visitId), 'ต้องระบุ visitId');
      const hasGps = p.lat !== undefined && p.lat !== '' && p.lat !== null;
      if (hasGps) need(okLat(p.lat) && okLng(p.lng), 'พิกัดไม่ถูกต้อง');
      const patch = { status: 'done', at: ts, completedAt: ts, updatedAt: ts, outcome: str(p.outcome) };
      if (p.note) patch.note = str(p.note);
      if (hasGps) { patch.lat = str(p.lat); patch.lng = str(p.lng); }
      M.push({ tab: 'visits', op: 'update', key: { col: 'visitId', val: p.visitId }, patch, mustExist: true });
      M.push({ tab: 'tasks', op: 'updateWhere', key: { col: 'data', contains: `"visitId":"${p.visitId}"` }, patch: { status: 'done', completedAt: ts, updatedAt: ts } });
      M.push({ tab: 'activities', op: 'append', row: { activityId: `A-${oid}`, customerId: str(p.customerId), type: 'visit', at: ts, refType: 'visit', refId: p.visitId, note: str(p.note), updatedAt: ts, data: '', opId: `${oid}:a` } });
      dedupe.tab = 'activities'; dedupe.id = `${oid}:a`;
      return { mutations: M, dedupe, result: {} };
    }
    case 'customer.geo': {
      need(str(p.customerId), 'ต้องระบุลูกค้า');
      need(okLat(p.lat) && okLng(p.lng), 'พิกัดไม่ถูกต้อง');
      const lat = String(+(+p.lat).toFixed(7)), lng = String(+(+p.lng).toFixed(7));
      M.push({ tab: 'customers', op: 'update', key: { col: 'id', val: p.customerId }, patch: { gpsLat: lat, gpsLng: lng, mapLink: mapLink(lat, lng) }, mustExist: true, log: true });
      M.push({ tab: 'gps', op: 'append', row: { gpsId: `G-${oid}`, customerId: p.customerId, at: ts, lat, lng, accuracy: str(p.accuracy), source: 'store-update', visitId: str(p.visitId), note: 'อัปเดตพิกัดร้าน', updatedAt: ts, data: '', opId: oid } });
      dedupe.tab = 'gps'; dedupe.id = oid;
      return { mutations: M, dedupe, result: {} };
    }
    case 'customer.update': {
      need(str(p.customerId), 'ต้องระบุลูกค้า');
      const patch = {};
      for (const [k, v] of Object.entries(p.patch || {})) {
        need(CUSTOMER_EDITABLE.includes(k), `ไม่อนุญาตให้แก้คอลัมน์ ${k}`);
        patch[k] = str(v);
      }
      need(Object.keys(patch).length, 'ไม่มีข้อมูลที่จะแก้ไข');
      M.push({ tab: 'customers', op: 'update', key: { col: 'id', val: p.customerId }, patch, mustExist: true, log: true });
      M.push({ tab: 'activities', op: 'append', row: { activityId: `A-${oid}`, customerId: p.customerId, type: 'customer-update', at: ts, refType: 'customer', refId: p.customerId, note: Object.keys(patch).join(','), updatedAt: ts, data: '', opId: oid } });
      dedupe.tab = 'activities'; dedupe.id = oid;
      return { mutations: M, dedupe, result: {} };
    }
    case 'customer.phones': {
      need(str(p.customerId), 'ต้องระบุลูกค้า');
      const phones = (p.phones || []).map(x => str(x).trim()).filter(Boolean);
      M.push({ tab: 'customer_phones', op: 'replace', key: { col: 'customerId', val: p.customerId }, rows: phones.map((ph, i) => ({ customerId: p.customerId, seq: String(i + 1), phone: ph })), log: true });
      M.push({ tab: 'activities', op: 'append', row: { activityId: `A-${oid}`, customerId: p.customerId, type: 'customer-update', at: ts, refType: 'customer', refId: p.customerId, note: 'phones', updatedAt: ts, data: '', opId: oid } });
      dedupe.tab = 'activities'; dedupe.id = oid;
      return { mutations: M, dedupe, result: {} };
    }
    case 'customer.labels': {
      need(str(p.customerId), 'ต้องระบุลูกค้า');
      const labels = [...new Set((p.labels || []).map(x => str(x).trim()).filter(Boolean))];
      M.push({ tab: 'customer_labels', op: 'replace', key: { col: 'customerId', val: p.customerId }, rows: labels.map((l, i) => ({ customerId: p.customerId, seq: String(i + 1), label: l })), log: true });
      M.push({ tab: 'activities', op: 'append', row: { activityId: `A-${oid}`, customerId: p.customerId, type: 'customer-update', at: ts, refType: 'customer', refId: p.customerId, note: 'labels', updatedAt: ts, data: '', opId: oid } });
      dedupe.tab = 'activities'; dedupe.id = oid;
      return { mutations: M, dedupe, result: {} };
    }
    case 'photo.add': {
      need(str(p.customerId), 'ต้องระบุลูกค้า');
      const photoType = p.photoType || 'visit';
      need(['store', 'visit', 'other'].includes(photoType), 'ประเภทรูปไม่ถูกต้อง');
      const hasGps = p.lat !== undefined && p.lat !== '' && p.lat !== null;
      if (hasGps) need(okLat(p.lat) && okLng(p.lng), 'พิกัดไม่ถูกต้อง');
      // fileId is filled by the server after the Drive upload (ctx.fileId); the client mirror leaves it blank.
      const fileId = str(ctx.fileId || p.fileId);
      M.push({ tab: 'photos', op: 'append', row: { photoId: `P-${oid}`, customerId: p.customerId, visitId: str(p.visitId), at: ts, fileId, folderId: str(ctx.folderId), photoType, caption: str(p.caption), lat: hasGps ? str(p.lat) : '', lng: hasGps ? str(p.lng) : '', source: 'app', updatedAt: ts, data: '', opId: oid } });
      if (photoType === 'store' && fileId) M.push({ tab: 'customers', op: 'appendCsv', key: { col: 'id', val: p.customerId }, field: 'storePhotoFileIds', value: fileId, log: true });
      dedupe.tab = 'photos'; dedupe.id = oid;
      return { mutations: M, dedupe, result: { fileId } };
    }
    case 'order.save': {
      const o = p.order || {};
      need(str(o.no), 'ต้องมีเลขที่ออเดอร์');
      need(str(o.customerId), 'ต้องระบุลูกค้า');
      const status = o.status || 'draft';
      need(['draft', 'confirmed', 'cancelled'].includes(status), 'สถานะออเดอร์ไม่ถูกต้อง');
      const lines = (p.lines || []).map((l, i) => {
        const qty = num(l.qty), price = num(l.price);
        need(qty >= 0 && price >= 0, `บรรทัด ${i + 1}: จำนวน/ราคาต้องไม่ติดลบ`);
        return { orderNo: o.no, line: String(i + 1), code: str(l.code), name: str(l.name), qty: String(qty), price: String(price), unit: str(l.unit), amount: String(Math.round(qty * price * 100) / 100) };
      });
      if (status === 'confirmed') need(lines.length > 0 && lines.some(l => num(l.qty) > 0), 'ออเดอร์ที่ยืนยันต้องมีสินค้า');
      M.push({ tab: 'orders', op: 'upsert', key: { col: 'no', val: o.no }, row: { no: o.no, date: str(o.date) || todayStr(ctx.now), customerId: o.customerId, customerNameOverride: str(o.customerNameOverride), paymentTerm: str(o.paymentTerm), vatMode: str(o.vatMode) || 'NONE', status, billNo: str(o.billNo), note: str(o.note), createdBy: ctx.user, deviceId: str(ctx.deviceId), opId: oid, updatedAt: ts }, keepOnUpdate: ['createdBy'], log: true });
      M.push({ tab: 'order_items', op: 'replace', key: { col: 'orderNo', val: o.no }, rows: lines });
      dedupe.tab = 'orders'; dedupe.id = oid;
      return { mutations: M, dedupe, result: { no: o.no } };
    }
    case 'settings.save': {
      const d = p.data || {};
      const allowed = ['visitDef', 'dormDays', 'lateDays', 'soonDays', 'minCycleBills', 'newDays', 'comm', 'vatRate'];
      const clean = {};
      for (const k of Object.keys(d)) {
        need(allowed.includes(k), `ไม่รู้จักการตั้งค่า ${k}`);
        const n = num(d[k]);
        need(n >= 0 && n <= 3650, `ค่า ${k} ไม่อยู่ในช่วงที่ยอมรับ`);
        clean[k] = n;
      }
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
      need(['open', 'resolved', 'ignored'].includes(p.status), 'สถานะไม่ถูกต้อง');
      M.push({ tab: 'IMPORT_REVIEW', op: 'update', key: { col: 'reviewId', val: p.reviewId }, patch: { status: p.status, reviewedBy: ctx.user, reviewedAt: ts, resolutionNote: str(p.note) }, mustExist: true, log: true });
      dedupe.tab = 'changes'; dedupe.id = oid;
      return { mutations: M, dedupe, result: {} };
    }
    case 'import.commit': {
      const b = p.batch || {};
      need(str(b.batchId), 'ต้องมี batchId');
      const bills = p.bills || [], items = p.items || [], reviews = p.reviews || [];
      need(bills.length + items.length + reviews.length <= MAX_IMPORT_ROWS, `ข้อมูลต่อรอบเกิน ${MAX_IMPORT_ROWS} แถว`);
      if (p.first) {
        M.push({ tab: 'IMPORT_BATCHES', op: 'appendUnique', col: 'fileHash', rows: [{ batchId: b.batchId, at: ts, kind: str(b.kind) || 'bills', fileName: str(b.fileName), fileHash: str(b.fileHash), source: 'app', format: str(b.format) || 'TTX', status: 'imported', summary: str(b.summary), user: ctx.user, deviceId: str(ctx.deviceId) }], blockOnDuplicate: true });
      }
      if (bills.length) M.push({ tab: 'bills', op: 'appendUnique', col: 'no', rows: bills.map(x => ({ no: str(x.no), date: str(x.date), customerId: str(x.customerId), customerNameOverride: str(x.customerNameOverride), paymentTerm: str(x.paymentTerm), openedBy: str(x.openedBy), salesperson: str(x.salesperson), vatMode: str(x.vatMode) || 'NONE', source: str(x.source) || b.batchId, updatedAt: ts })) });
      if (items.length) M.push({ tab: 'bill_items', op: 'appendUniqueComposite', cols: ['billNo', 'line'], rows: items.map(x => ({ billNo: str(x.billNo), line: str(x.line), code: str(x.code), name: str(x.name), qty: str(x.qty), price: str(x.price), amount: str(x.amount) })) });
      if (reviews.length) M.push({ tab: 'IMPORT_REVIEW', op: 'appendUnique', col: 'reviewId', rows: reviews.map((r, i) => ({ reviewId: str(r.reviewId) || `${b.batchId}-R${i + 1}`, batchId: b.batchId, sourceFile: str(b.fileName), entityType: str(r.entityType), sourceKey: str(r.sourceKey), issueCode: str(r.issueCode), severity: str(r.severity) || 'info', sourceValue: str(r.sourceValue), existingValue: str(r.existingValue), suggestedAction: str(r.suggestedAction), status: 'open', reviewedBy: '', reviewedAt: '', resolutionNote: '', createdAt: ts })) });
      dedupe.tab = null; // bills/items/batches are unique-keyed instead
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
      case 'update': { const r = rows.find(x => x[m.key.col] === String(m.key.val)); if (r) Object.assign(r, m.patch); break; }
      case 'updateWhere': for (const r of rows) if (String(r[m.key.col] || '').includes(m.key.contains)) Object.assign(r, m.patch); break;
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
    }
  }
}
export { dateOf };
