// Executes the mutations produced by expandOp() against a store. Idempotent per row (opId) and
// writes an audit row into `changes` for every mutation flagged `log`.
import { expandOp, OpError, ADMIN_OPS } from '../../public/js/shared/ops.js';
import { nowIso, parseJson } from '../../public/js/shared/domain.js';

const normName = s => String(s || '').toLowerCase().replace(/[\s\-_.,()\[\]/\\*]+/g, '');
const dg = s => String(s || '').replace(/\D+/g, '');
const clip = (s, n = 1500) => { const t = typeof s === 'string' ? s : JSON.stringify(s); return t.length > n ? t.slice(0, n) + '…' : t; };

async function rowOf(store, tab, col, val) {
  const c = await store.column(tab, col);
  const i = c.indexOf(String(val));
  return i < 0 ? 0 : i + 2; // sheet row number
}

export async function execOp(store, op, ctx) {
  if (ADMIN_OPS.has(op.type) && !ctx.isAdmin) throw new OpError('ต้องเป็นผู้ดูแลระบบ', 'forbidden');
  // Use the time the salesperson actually did it (offline queue), but only if it is plausible.
  const at = Number(op?.at);
  if (Number.isFinite(at) && at <= ctx.now + 300000 && at >= ctx.now - 30 * 86400000) ctx = { ...ctx, now: at };
  const ex = expandOp(op, ctx);
  const ts = nowIso(ctx.now);
  // Fast duplicate answer when the primary row is already stored.
  if (ex.dedupe.tab) {
    const col = await store.column(ex.dedupe.tab, 'opId');
    if (col.includes(ex.dedupe.id)) return { opId: op.opId, status: 'duplicate' };
  }
  // Photo upload (Drive) happens before expansion so the row carries the file id.
  let ex2 = ex;
  // order number taken by a different shop on another device -> allocate the next free number
  let renamedFrom = '';
  if (op.type === 'order.save') {
    const [nos, cids] = await Promise.all([store.column('orders', 'no'), store.column('orders', 'customerId')]);
    const i = nos.indexOf(String(op.payload.order.no));
    if (i >= 0 && cids[i] !== String(op.payload.order.customerId)) {
      const m = /^(\d{2})(\d{6})$/.exec(String(op.payload.order.no)); let n = m ? +m[1] : 0; let cand;
      do { n++; cand = m ? `${String(n).padStart(2, '0')}${m[2]}` : `${op.payload.order.no}-${n}`; } while (nos.includes(cand));
      renamedFrom = op.payload.order.no;
      op = { ...op, payload: { ...op.payload, order: { ...op.payload.order, no: cand } } };
      ex2 = expandOp(op, ctx);
    }
  }
  if (op.type === 'photo.add' && op.payload?.imageBase64) {
    const up = await store.uploadPhoto({ base64: op.payload.imageBase64, mime: op.payload.mime || 'image/jpeg', name: `${op.payload.customerId}-${op.opId}.jpg` });
    ex2 = expandOp(op, { ...ctx, fileId: up.fileId, folderId: up.folderId });
  }
  const log = [];
  const addLog = (entity, id, action, before, after) => log.push({ at: ts, entity, id: String(id), action, before: clip(before ?? ''), after: clip(after ?? ''), opId: op.opId, deviceId: ctx.deviceId || '', user: ctx.user });

  // Validate targets first so a bad key doesn't leave half an operation behind.
  for (const m of ex2.mutations) {
    if (m.mustExist) {
      const n = await rowOf(store, m.tab, m.key.col, m.key.val);
      if (!n) throw new OpError(`ไม่พบรายการ ${m.tab}.${m.key.col}=${m.key.val}`, 'not_found');
    }
  }

  const mutations = [...ex2.mutations];
  if (op.type === 'visit.log' && mutations.length > 1) {
    // Write the dedupe row last. A retry after any earlier append can finish
    // the visit without duplicating its already written activity or GPS row.
    mutations.push(mutations.shift());
  }
  for (const m of mutations) {
    switch (m.op) {
      case 'append': {
        if (m.row.opId !== undefined && m.row.opId !== '') {
          const have = await store.column(m.tab, 'opId');
          if (have.includes(m.row.opId)) break;
        }
        await store.appendRows(m.tab, [m.row]);
        break;
      }
      case 'appendUnique': {
        const have = new Set(await store.column(m.tab, m.col));
        const fresh = m.rows.filter(r => !have.has(String(r[m.col])));
        if (m.blockOnDuplicate && fresh.length < m.rows.length) throw new OpError('ไฟล์นี้เคยนำเข้าแล้ว (fileHash ซ้ำ)', 'duplicate_file');
        // also dedupe inside the payload itself
        const seen = new Set(), uniq = [];
        for (const r of fresh) { const k = String(r[m.col]); if (!seen.has(k)) { seen.add(k); uniq.push(r); } }
        if (uniq.length) await store.appendRows(m.tab, uniq);
        if (m.log === 'create') for (const r of uniq) addLog(m.tab, r[m.col], 'เพิ่มลูกค้า', '', JSON.stringify({ name: r.name }));
        break;
      }
      case 'appendUniqueComposite': {
        const cols = await Promise.all(m.cols.map(c => store.column(m.tab, c)));
        const have = new Set(cols[0].map((_, i) => cols.map(c => c[i] ?? '').join('|')));
        const uniq = [];
        for (const r of m.rows) { const k = m.cols.map(c => String(r[c])).join('|'); if (!have.has(k)) { have.add(k); uniq.push(r); } }
        if (uniq.length) await store.appendRows(m.tab, uniq);
        break;
      }
      case 'update': {
        const n = await rowOf(store, m.tab, m.key.col, m.key.val);
        if (!n) break;
        const before = await store.getRow(m.tab, n);
        if (m.match && Object.entries(m.match).some(([key, value]) => before[key] !== value)) {
          throw new OpError('รายการนี้ถูกเปลี่ยนหรือไม่ตรงกับลูกค้าที่เลือก', 'target_mismatch');
        }
        const patch = m.mergeData ? { ...m.patch, data: JSON.stringify({ ...parseJson(before.data), ...m.mergeData }) } : m.patch;
        const snapshot = Object.fromEntries(Object.keys(patch).map(key => [key, before[key]]));
        await store.updateRow(m.tab, n, patch);
        if (m.log) addLog(m.tab, m.key.val, 'update', snapshot, patch);
        break;
      }
      case 'updateWhere': {
        const col = await store.column(m.tab, m.key.col);
        for (let i = 0; i < col.length; i++) if (col[i].includes(m.key.contains)) await store.updateRow(m.tab, i + 2, m.patch);
        break;
      }
      case 'upsert': {
        const n = await rowOf(store, m.tab, m.key.col, m.key.val);
        if (n) {
          const before = await store.getRow(m.tab, n);
          if (before.opId === m.row.opId && m.row.opId) break;
          const patch = { ...m.row };
          for (const k of m.keepOnUpdate || []) delete patch[k];
          await store.updateRow(m.tab, n, patch);
          if (m.log) addLog(m.tab, m.key.val, 'update', clip({ status: before.status, note: before.note }), clip({ status: m.row.status, note: m.row.note }));
        } else {
          await store.appendRows(m.tab, [m.row]);
          if (m.log) addLog(m.tab, m.key.val, 'create', '', m.row.status);
        }
        break;
      }
      case 'replace': {
        const col = await store.column(m.tab, m.key.col);
        const rows = []; col.forEach((v, i) => { if (v === String(m.key.val)) rows.push(i + 2); });
        if (m.log) addLog(m.tab, m.key.val, 'replace', `${rows.length} rows`, `${m.rows.length} rows`);
        if (rows.length) await store.deleteRows(m.tab, rows);
        if (m.rows.length) await store.appendRows(m.tab, m.rows);
        break;
      }
      case 'appendCsv': {
        const n = await rowOf(store, m.tab, m.key.col, m.key.val);
        if (!n) break;
        const cur = await store.getRow(m.tab, n);
        const list = String(cur[m.field] || '').split(',').filter(Boolean);
        if (!list.includes(m.value)) { list.push(m.value); await store.updateRow(m.tab, n, { [m.field]: list.join(',') }); if (m.log) addLog(m.tab, m.key.val, 'update', cur[m.field], list.join(',')); }
        break;
      }
      case 'mergeSettings': {
        const [ups, datas] = await Promise.all([store.column(m.tab, 'updatedAt'), store.column(m.tab, 'data')]);
        let bi = -1;
        ups.forEach((u, i) => { if (bi < 0 || u >= ups[bi]) bi = i; });
        const cur = bi >= 0 ? parseJson(datas[bi], {}) : {};
        const next = { ...cur, ...m.data };
        await store.appendRows(m.tab, [{ ...m.row, data: JSON.stringify(next) }]);
        if (m.log) addLog(m.tab, m.row.id, 'create', cur, next);
        break;
      }
      case 'renameLabel': {
        const [ids, labels] = await Promise.all([store.column(m.tab, 'customerId'), store.column(m.tab, 'label')]);
        const owners = new Set(); labels.forEach((l, i) => { if (l === m.to) owners.add(ids[i]); });
        const del = [], ren = [];
        labels.forEach((l, i) => { if (l === m.from) (owners.has(ids[i]) ? del : ren).push(i + 2); });
        for (const n of ren) await store.updateRow(m.tab, n, { label: m.to });
        if (del.length) await store.deleteRows(m.tab, del);
        addLog(m.tab, m.from, 'rename', m.from, `${m.to} (${ren.length} renamed, ${del.length} merged)`);
        break;
      }
      case 'deleteLabel': {
        const labels = await store.column(m.tab, 'label'); const del = [];
        labels.forEach((l, i) => { if (l === m.label) del.push(i + 2); });
        if (del.length) await store.deleteRows(m.tab, del);
        addLog(m.tab, m.label, 'delete', m.label, `${del.length} rows`);
        break;
      }
      case 'guardDuplicate': {
        const [ids, names] = await Promise.all([store.column('customers', 'id'), store.column('customers', 'name')]);
        const nn = normName(m.name); const hits = [];
        names.forEach((n, i) => { if (normName(n) === nn) hits.push(`${ids[i]} ${n}`); });
        if (m.phones.length) {
          const [pc, pp] = await Promise.all([store.column('customer_phones', 'customerId'), store.column('customer_phones', 'phone')]);
          const want = m.phones.map(dg).filter(d => d.length >= 8);
          pp.forEach((p, i) => { if (want.includes(dg(p)) && !hits.some(h => h.startsWith(pc[i] + ' '))) hits.push(`${pc[i]} (เบอร์ ${p})`); });
        }
        if (hits.length && !m.force) throw new OpError(`พบร้านซ้ำ: ${hits.slice(0, 3).join(' · ')}`, 'duplicate_customer', { matches: hits.slice(0, 5) });
        break;
      }
      case 'mustNotExist': { if ((await store.column(m.tab, m.col)).includes(String(m.val))) throw new OpError(m.message || 'มีอยู่แล้ว', 'already_exists'); break; }
      case 'updateAll': {
        const col = await store.column(m.tab, m.col); const list = [];
        col.forEach((v, i) => { if (v === m.from) list.push({ row: i + 2, patch: { [m.col]: m.to } }); });
        await store.updateRows(m.tab, list);
        if (list.length) addLog(m.tab, m.from, 'ผูกรหัส', `${list.length} rows`, m.to);
        break;
      }
      case 'logOnly': addLog(m.entity, m.id, m.action, m.before, m.after); break;
      default: throw new OpError(`mutation ไม่รู้จัก ${m.op}`);
    }
  }
  if (log.length) await store.appendRows('changes', log);
  return { opId: op.opId, status: 'ok', ...ex2.result, ...(renamedFrom ? { renamedFrom, no: op.payload.order.no } : {}) };
}

export async function execBatch(store, ops, ctx) {
  const results = [];
  for (const op of ops) {
    try { results.push(await execOp(store, op, ctx)); }
    catch (e) { results.push({ opId: op?.opId, status: 'error', code: e.code || 'server_error', extra: e.extra, message: e instanceof OpError ? e.message : `ผิดพลาดที่เซิร์ฟเวอร์: ${String(e.message).slice(0, 160)}` }); }
  }
  return results;
}
