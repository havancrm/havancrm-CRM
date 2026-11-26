// Pure business logic. No DOM, no network. Shared by the app, the Worker and the tests.
// Rules (MASTER PROMPT §3): the sheet stores raw data only; every calculation lives here.
// Sales = SUM(bill_items.amount). VAT is NEVER added on top of a bill.
import { rowsToObjects } from './schema.js';

export const DEFAULT_SETTINGS = {
  comm: 8, visitDef: 30, dormDays: 365, lateDays: 90, vatRate: 7,
  soonDays: 7,        // "ใกล้ถึงรอบซื้อ" window
  minCycleBills: 3,   // purchase dates needed before a cycle is trusted
  newDays: 90,        // "ลูกค้าใหม่": first purchase within N days
};

// Pairs confirmed by the user (old code -> current code). Used ONLY to link history for
// re-ordering after the name check passes. Never auto-extended.
export const LEGACY_PAIRS = [
  { old: '8217', next: '8217*' },
  { old: '8741*', next: '9861' },
  { old: '9833*', next: '9841' },
  { old: '9834*', next: '9837' },
  { old: '9835*', next: '9839' },
];

export const REFERENCE_COUNTS = { customers: 1383, bills: 9922, bill_items: 30811, products: 366 };

// ---------- small helpers ----------
export const num = v => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,฿\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
export const money = n => (Math.round(num(n) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const pad = n => String(n).padStart(2, '0');
const DAY = 86400000;

// Bangkok "today" as YYYY-MM-DD (UTC+7, no DST)
export function todayStr(now = Date.now()) {
  const d = new Date(now + 7 * 3600000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function nowIso(now = Date.now()) {
  const d = new Date(now + 7 * 3600000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+07:00`;
}
export function dayNum(s) { // 'YYYY-MM-DD...' -> integer day number, NaN if invalid
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return NaN;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY);
}
export function dayStr(n) {
  const d = new Date(n * DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export const dateOf = s => String(s || '').slice(0, 10);

export function parseJson(s, fallback = {}) {
  if (!s) return fallback;
  if (typeof s === 'object') return s;
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : fallback; } catch { return fallback; }
}

export const isClosedFlag = v => {
  const s = String(v ?? '').trim().toLowerCase();
  return ['0', 'false', 'no', 'n', 'inactive', 'closed', 'ปิด', 'เลิก', 'เลิกกิจการ', 'ปิดกิจการ'].includes(s);
};

export function median(arr) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ---------- model ----------
// raw: { tabName: [objects by header] }  (or {tabName: matrix} via fromMatrices)
export function fromMatrices(tabs) {
  const raw = {};
  for (const [t, v] of Object.entries(tabs)) raw[t] = rowsToObjects(v);
  return raw;
}

export function parseSettings(rows) {
  let best = null;
  for (const r of rows || []) {
    if (!best || String(r.updatedAt) >= String(best.updatedAt)) best = r;
  }
  const d = best ? parseJson(best.data, {}) : {};
  return { ...DEFAULT_SETTINGS, ...d };
}

export function buildModel(raw, now = Date.now()) {
  const m = { raw, now, today: todayStr(now) };
  m.settings = parseSettings(raw.systemSettings);
  m.customers = (raw.customers || []);
  m.custById = new Map();
  for (const c of m.customers) if (!m.custById.has(c.id)) m.custById.set(c.id, c);
  m.products = raw.products || [];
  m.prodByCode = new Map(m.products.map(p => [p.code, p]));
  m.phones = groupBy(raw.customer_phones || [], 'customerId', (a, b) => num(a.seq) - num(b.seq));
  m.labels = groupBy(raw.customer_labels || [], 'customerId', (a, b) => num(a.seq) - num(b.seq));
  m.bills = (raw.bills || []);
  m.billByNo = new Map();
  for (const b of m.bills) if (!m.billByNo.has(b.no)) m.billByNo.set(b.no, b);
  m.itemsByBill = groupBy(raw.bill_items || [], 'billNo', (a, b) => num(a.line) - num(b.line));
  m.billTotals = new Map();
  for (const [no, items] of m.itemsByBill) m.billTotals.set(no, items.reduce((s, i) => s + num(i.amount), 0));
  m.billsByCust = groupBy(m.bills, 'customerId', (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.no < b.no ? -1 : 1));
  m.visitsByCust = groupBy(raw.visits || [], 'customerId', (a, b) => String(a.at || a.plannedAt).localeCompare(String(b.at || b.plannedAt)));
  m.tasksByCust = groupBy(raw.tasks || [], 'customerId');
  m.activitiesByCust = groupBy(raw.activities || [], 'customerId');
  m.gpsByCust = groupBy(raw.gps || [], 'customerId');
  m.photosByCust = groupBy(raw.photos || [], 'customerId');
  m.orders = raw.orders || [];
  m.orderItems = groupBy(raw.order_items || [], 'orderNo', (a, b) => num(a.line) - num(b.line));
  m._stats = new Map();
  return m;
}

function groupBy(rows, key, sort) {
  const g = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(r);
  }
  if (sort) for (const a of g.values()) a.sort(sort);
  return g;
}

export const billTotal = (m, no) => m.billTotals.get(no) || 0;
export const custName = (m, id) => (m.custById.get(id)?.name) || `(ไม่พบลูกค้า ${id})`;
export const custLabels = (m, id) => (m.labels.get(id) || []).map(l => l.label).filter(Boolean);
export const custPhones = (m, id) => (m.phones.get(id) || []).map(p => p.phone).filter(Boolean);
export const itemKey = i => (i.code ? `c:${i.code}` : `n:${i.name}`);

export function hasGps(c) {
  const la = parseFloat(c.gpsLat), lo = parseFloat(c.gpsLng);
  return Number.isFinite(la) && Number.isFinite(lo) && !(la === 0 && lo === 0) && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
}

export function visitDone(v) {
  const st = String(v.status || '').toLowerCase();
  if (['planned', 'cancelled', 'canceled', 'plan'].includes(st)) return false;
  return !!(v.completedAt || v.at);
}
export const visitPlanned = v => String(v.status || '').toLowerCase() === 'planned';

// ---------- per-customer stats ----------
export function customerStats(m, id) {
  if (m._stats.has(id)) return m._stats.get(id);
  const c = m.custById.get(id);
  const bills = m.billsByCust.get(id) || [];
  const s = m.settings;
  const dates = [...new Set(bills.map(b => dateOf(b.date)).filter(d => !isNaN(dayNum(d))))].sort();
  const last = dates.length ? dates[dates.length - 1] : '';
  const today = dayNum(m.today);
  const daysSince = last ? today - dayNum(last) : null;
  let total = 0;
  for (const b of bills) total += billTotal(m, b.no);

  // cycle = median gap between distinct purchase dates, only when enough history exists
  let cycle = null;
  if (dates.length >= s.minCycleBills) {
    const gaps = [];
    for (let i = 1; i < dates.length; i++) gaps.push(dayNum(dates[i]) - dayNum(dates[i - 1]));
    const med = median(gaps);
    if (Number.isFinite(med) && med > 0) cycle = Math.max(1, Math.round(med));
  }
  const dueDay = cycle && last ? dayNum(last) + cycle : null;
  let cycleState = 'none';
  if (dueDay !== null) {
    if (today > dueDay) cycleState = 'overdue';
    else if (dueDay - today <= s.soonDays) cycleState = 'soon';
    else cycleState = 'ok';
  }

  // last visit = latest completed visit row OR activity "เข้าพบ" (aCRM logs both)
  let lastVisit = '';
  for (const v of (m.visitsByCust.get(id) || []).filter(visitDone)) { const d = dateOf(v.completedAt || v.at); if (d > lastVisit) lastVisit = d; }
  for (const a of m.activitiesByCust.get(id) || []) if (a.type === 'เข้าพบ') { const d = dateOf(a.at); if (d > lastVisit) lastVisit = d; }
  const daysSinceVisit = lastVisit ? today - dayNum(lastVisit) : null;
  const visitDue = daysSinceVisit === null || daysSinceVisit > s.visitDef;

  let status;
  if (c && isClosedFlag(c.activeFlag)) status = 'closed';
  else if (!last) status = 'lapsed';           // never bought -> not a current customer
  else if (daysSince <= s.lateDays) status = 'current';
  else status = 'lapsed';

  const res = {
    id, bills: bills.length, total, firstDate: dates[0] || '', lastDate: last, daysSince,
    cycle, dueDay, dueDate: dueDay !== null ? dayStr(dueDay) : '', cycleState,
    lastVisit, daysSinceVisit, visitDue, status, neverBought: !last,
    dormant: !!last && daysSince > s.dormDays,
  };
  m._stats.set(id, res);
  return res;
}

export const STATUS_TH = { current: 'ปัจจุบัน', lapsed: 'ห่างหาย', closed: 'เลิกกิจการ' };

export function customerCounts(m) {
  const k = { all: 0, current: 0, lapsed: 0, closed: 0 };
  for (const c of m.customers) { k.all++; k[customerStats(m, c.id).status]++; }
  return k;
}

export function customersBy(m, filter) {
  return m.customers.filter(c => {
    const st = customerStats(m, c.id);
    if (filter === 'all' || !filter) return true;
    if (filter === 'new') return isFirstPurchaseNew(m, c) || isRecentlyRegistered(m, c);
    if (filter === 'temp') return isTempId(c.id);
    return st.status === filter;
  });
}

// ---- new customers: TWO different things (kept apart on purpose) ----
// (a) "ซื้อครั้งแรก"  : first purchase within N days (comes from bills)
// (b) "เพิ่งเพิ่มทะเบียน": the shop was added to the register within N days (activity "เพิ่มลูกค้า"),
//     whether or not it has bought yet. Shops created in the field have a temporary code N-xxxxxx.
export const NEW_PREFIX = 'N-';
export const isTempId = id => String(id || '').startsWith(NEW_PREFIX);
export function registeredAt(m, id) {
  if (!m._reg) {
    m._reg = new Map();
    for (const a of m.raw.activities || []) if (a.type === 'เพิ่มลูกค้า' && a.customerId) { const d = dateOf(a.at); if (d && (!m._reg.has(a.customerId) || d < m._reg.get(a.customerId))) m._reg.set(a.customerId, d); }
  }
  return m._reg.get(id) || '';
}
export function isFirstPurchaseNew(m, c, days = m.settings.newDays) {
  const st = customerStats(m, c.id);
  return !!st.firstDate && dayNum(m.today) - dayNum(st.firstDate) <= days;
}
export function isRecentlyRegistered(m, c, days = m.settings.newDays) {
  const r = registeredAt(m, c.id);
  return !!r && dayNum(m.today) - dayNum(r) <= days;
}
export const isNewCustomer = isFirstPurchaseNew;       // legacy alias (first purchase)

// Duplicate guard for a shop about to be created. Hard match = same normalised name or same phone.
export function findDuplicateCustomers(m, { name = '', phones = [] } = {}) {
  const n = normText(name), ds = (phones || []).map(digits).filter(d => d.length >= 8);
  const out = [];
  for (const e of buildSearchIndex(m)) {
    const reasons = [];
    if (n && e.name === n) reasons.push('ชื่อซ้ำ');
    else if (n.length >= 6 && dice(name, e.c.name) >= 0.88) reasons.push('ชื่อคล้ายมาก');
    if (ds.length && e.phones.some(p => p.length >= 8 && ds.includes(p))) reasons.push('เบอร์ซ้ำ');
    if (reasons.length) out.push({ c: e.c, reasons, hard: reasons.some(r => r !== 'ชื่อคล้ายมาก') });
  }
  return out;
}
// temp code N-yymmdd-XXXX, derived from the op id so a retried save yields the SAME code
export function tempCustomerId(opId, now = Date.now()) {
  const d = new Date(now + 7 * 3600000);
  let h = 2166136261; for (const ch of String(opId)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return `${NEW_PREFIX}${String(d.getUTCFullYear() + 543).slice(2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${h.toString(36).toUpperCase().padStart(4, '0').slice(-4)}`;
}

// ---------- sales ----------
// Sum of bill_items.amount only. Bill header carries no totals; VAT is never re-added.
export function salesBetween(m, from, to) {
  let total = 0, billCount = 0;
  const byMonth = new Map(), byClerk = new Map(), bySales = new Map(), byCust = new Map(), billsInRange = [];
  for (const b of m.bills) {
    const d = dateOf(b.date);
    if ((from && d < from) || (to && d > to)) continue;
    const t = billTotal(m, b.no);
    total += t; billCount++; billsInRange.push(b);
    const mo = d.slice(0, 7);
    byMonth.set(mo, (byMonth.get(mo) || 0) + t);
    const ck = b.openedBy || '-', sk = b.salesperson || '-';
    byClerk.set(ck, (byClerk.get(ck) || 0) + t);
    bySales.set(sk, (bySales.get(sk) || 0) + t);
    byCust.set(b.customerId, (byCust.get(b.customerId) || 0) + t);
  }
  return { total, billCount, byMonth, byClerk, bySales, byCust, bills: billsInRange };
}

export function periodRange(kind, today) {
  const t = dayNum(today);
  const y = +today.slice(0, 4), mo = +today.slice(5, 7);
  switch (kind) {
    case 'today': return [today, today];
    case '7d': return [dayStr(t - 6), today];
    case '30d': return [dayStr(t - 29), today];
    case 'month': return [`${y}-${pad(mo)}-01`, today];
    case 'lastmonth': {
      const py = mo === 1 ? y - 1 : y, pm = mo === 1 ? 12 : mo - 1;
      const end = dayStr(dayNum(`${y}-${pad(mo)}-01`) - 1);
      return [`${py}-${pad(pm)}-01`, end];
    }
    case 'year': return [`${y}-01-01`, today];
    default: return ['', ''];
  }
}

// ---------- order history helpers ----------
export function lastBillOf(m, id) {
  const bills = m.billsByCust.get(id) || [];
  return bills.length ? bills[bills.length - 1] : null;
}

// Regular items: most frequently bought across distinct bills (history codes kept as billed).
export function regularItems(m, id, limit = 12) {
  const agg = new Map();
  for (const b of m.billsByCust.get(id) || []) {
    const seen = new Set();
    for (const it of m.itemsByBill.get(b.no) || []) {
      if (num(it.amount) === 0 && num(it.price) === 0) continue; // free/bonus lines don't define "regular"
      const k = itemKey(it);
      let a = agg.get(k);
      if (!a) { a = { key: k, code: it.code, name: it.name, bills: 0, qty: 0, lastDate: '', lastPrice: 0 }; agg.set(k, a); }
      if (!seen.has(k)) { a.bills++; seen.add(k); }
      a.qty += num(it.qty);
      if (dateOf(b.date) >= a.lastDate) { a.lastDate = dateOf(b.date); a.lastPrice = num(it.price); a.lastQty = num(it.qty); }
    }
  }
  return [...agg.values()].filter(a => a.bills >= 2 || agg.size <= limit)
    .sort((x, y) => y.bills - x.bills || y.qty - x.qty).slice(0, limit);
}

export function billLines(m, no) {
  return (m.itemsByBill.get(no) || []).map(i => ({ ...i, inRegistry: !i.code || m.prodByCode.has(i.code) }));
}

// ---------- product registry / legacy codes ----------
const strip = s => String(s || '').toLowerCase().replace(/[\s*()\[\]\-_.,/\\]+/g, '');
export function dice(a, b) {
  a = strip(a).replace(/\d/g, ''); b = strip(b).replace(/\d/g, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bi = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = bi(a), B = bi(b); let inter = 0, nA = 0, nB = 0;
  for (const v of A.values()) nA += v;
  for (const v of B.values()) nB += v;
  for (const [g, v] of A) if (B.has(g)) inter += Math.min(v, B.get(g));
  return nA + nB ? (2 * inter) / (nA + nB) : 0;
}
// Sizes like "3,200 ml" / "500 กรัม". Same unit but different value => conflict.
export function sizeTokens(name) {
  const out = new Map();
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(ml|มล|ซีซี|cc|กรัม|g|กก|kg|ลิตร|l|ซม|cm)(?![a-z])/gi;
  let x;
  while ((x = re.exec(String(name || '')))) {
    let u = x[2].toLowerCase();
    u = { 'มล': 'ml', 'ซีซี': 'ml', 'cc': 'ml', 'กรัม': 'g', 'กก': 'kg', 'ลิตร': 'l' }[u] || u;
    out.set(u, parseFloat(x[1].replace(/,/g, '')));
  }
  return out;
}
export function namesConflict(a, b) {
  const A = sizeTokens(a), B = sizeTokens(b);
  for (const [u, v] of A) if (B.has(u) && B.get(u) !== v) return true;
  return dice(a, b) < 0.45;   // clearly different product text
}
// Resolve a legacy (billed) code to the current register entry, only for user-confirmed pairs
// AND only when the names in history don't contradict the register name.
export function resolveLegacy(m, code, billedName) {
  const pair = LEGACY_PAIRS.find(p => p.old === code);
  if (!pair) return null;
  const target = m.prodByCode.get(pair.next);
  if (!target) return { pair, target: null, ok: false, reason: 'ไม่พบรหัสใหม่ในทะเบียน' };
  if (namesConflict(billedName, target.name)) return { pair, target, ok: false, reason: 'ชื่อสินค้าขัดแย้งกัน ไม่จับคู่' };
  return { pair, target, ok: true };
}

// ---------- search ----------
export const normText = s => String(s || '').toLowerCase().replace(/[\s\-_.,()\[\]/\\*]+/g, '');
export const digits = s => String(s || '').replace(/\D+/g, '');

export function buildSearchIndex(m) {
  if (m._sidx) return m._sidx;
  m._sidx = m.customers.map(c => ({
    c,
    id: String(c.id),
    name: normText(c.name),
    contact: normText(c.contactName),
    addr: normText(c.address),
    labels: custLabels(m, c.id).map(normText),
    phones: custPhones(m, c.id).map(digits),
    extra: normText([c.type, c.lineId, c.keepNote, c.customerNote, c.taxName].join(' ')),
  }));
  return m._sidx;
}

export function searchCustomers(m, q, limit = 50) {
  const nq = normText(q), dq = digits(q);
  if (!nq) return [];
  const out = [];
  for (const e of buildSearchIndex(m)) {
    let s = 0;
    if (e.id === q.trim()) s = 100;
    else if (e.id.startsWith(q.trim()) && q.trim().length >= 2 && /^\d/.test(q)) s = 80;
    if (e.name.startsWith(nq)) s = Math.max(s, 90);
    else if (e.name.includes(nq)) s = Math.max(s, 70);
    if (e.contact.includes(nq)) s = Math.max(s, 60);
    if (e.labels.some(l => l === nq)) s = Math.max(s, 55);
    else if (e.labels.some(l => l.includes(nq))) s = Math.max(s, 45);
    if (dq.length >= 3 && e.phones.some(p => p.includes(dq))) s = Math.max(s, 75);
    if (e.addr.includes(nq)) s = Math.max(s, 40);
    if (e.extra.includes(nq)) s = Math.max(s, 30);
    if (s) out.push({ c: e.c, score: s });
  }
  out.sort((a, b) => b.score - a.score || String(a.c.name).localeCompare(String(b.c.name), 'th'));
  return out.slice(0, limit).map(x => x.c);
}

export function searchProducts(m, q, limit = 50) {
  const nq = normText(q);
  if (!nq) return [];
  const out = [];
  for (const p of m.products) {
    const c = normText(p.code), n = normText(p.name);
    let s = 0;
    if (c === nq) s = 100; else if (c.startsWith(nq)) s = 80; else if (n.includes(nq)) s = 60;
    if (s) out.push({ p, s });
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, limit).map(x => x.p);
}

export function searchBills(m, q, limit = 30) {
  const t = q.trim();
  if (t.length < 3) return [];
  const out = [];
  for (const b of m.bills) { if (b.no === t || b.no.startsWith(t)) out.push(b); if (out.length >= limit) break; }
  return out;
}

export function smartSearch(m, q) {
  return { customers: searchCustomers(m, q, 30), products: searchProducts(m, q, 10), bills: searchBills(m, q, 10) };
}

// ---------- visit planning / suggestions ----------
export function suggestions(m) {
  const overdue = [], soon = [], missed = [];
  for (const c of m.customers) {
    const st = customerStats(m, c.id);
    if (st.status === 'closed') continue;
    if (st.cycleState === 'overdue' && st.status !== 'lapsed') overdue.push({ c, st, days: m.today && dayNum(m.today) - st.dueDay });
    else if (st.cycleState === 'soon') soon.push({ c, st, days: st.dueDay - dayNum(m.today) });
    if (st.status === 'current' && st.visitDue) missed.push({ c, st });
  }
  overdue.sort((a, b) => b.days - a.days);
  soon.sort((a, b) => a.days - b.days);
  missed.sort((a, b) => (b.st.daysSinceVisit ?? 9999) - (a.st.daysSinceVisit ?? 9999));
  return { overdue, soon, missed };
}

// Calendar for a month: day -> [{c, reason}]. Reasons: 'นัดหมาย' (recorded by sales), 'ถึงรอบซื้อ' (computed).
export function monthCalendar(m, ym) {
  const days = new Map();
  const add = (d, c, reason) => {
    if (!d.startsWith(ym)) return;
    if (!days.has(d)) days.set(d, []);
    const arr = days.get(d);
    if (!arr.some(x => x.c.id === c.id && x.reason === reason)) arr.push({ c, reason });
  };
  for (const v of m.raw.visits || []) {
    if (visitPlanned(v) && v.plannedAt) { const c = m.custById.get(v.customerId); if (c) add(dateOf(v.plannedAt), c, 'นัดหมาย'); }
  }
  for (const t of m.raw.tasks || []) {
    if (String(t.status || '').toLowerCase() === 'open' && t.dueAt) { const c = m.custById.get(t.customerId); if (c) add(dateOf(t.dueAt), c, 'นัดหมาย'); }
  }
  for (const c of m.customers) {
    const st = customerStats(m, c.id);
    if (st.status === 'closed' || st.status === 'lapsed' || !st.dueDate) continue;
    add(st.dueDate, c, 'ถึงรอบซื้อ');
  }
  return days;
}

// ---------- data quality ----------
export function qualityReport(m) {
  const issues = [];
  const push = (code, severity, detail, ref = {}) => issues.push({ code, severity, detail, ...ref });
  const seen = (arr, keyFn) => { const s = new Set(), d = new Set(); for (const x of arr) { const k = keyFn(x); if (s.has(k)) d.add(k); s.add(k); } return d; };

  const counts = {
    customers: m.customers.length, bills: m.bills.length,
    bill_items: (m.raw.bill_items || []).length, products: m.products.length,
  };
  for (const k of Object.keys(REFERENCE_COUNTS)) {
    if (counts[k] !== REFERENCE_COUNTS[k]) push('COUNT_DIFF', 'info', `${k}: ในฐาน ${counts[k]} / ข้อมูลอ้างอิงวันส่งมอบ ${REFERENCE_COUNTS[k]} (อาจมีข้อมูลใหม่หลังส่งมอบ)`);
  }
  for (const id of seen(m.customers, c => c.id)) push('DUP_CUSTOMER_ID', 'error', `รหัสลูกค้าซ้ำ ${id}`, { key: id });
  for (const no of seen(m.bills, b => b.no)) push('DUP_BILL_NO', 'error', `เลขบิลซ้ำ ${no}`, { key: no });
  for (const k of seen(m.raw.bill_items || [], i => `${i.billNo}|${i.line}`)) push('DUP_BILL_LINE', 'error', `บรรทัดบิลซ้ำ ${k}`, { key: k });
  for (const k of seen(m.products, p => p.code)) push('DUP_PRODUCT_CODE', 'error', `รหัสสินค้าซ้ำในทะเบียน ${k}`, { key: k });

  for (const b of m.bills) {
    if (!m.custById.has(b.customerId)) push('BILL_NO_CUSTOMER', 'warn', `บิล ${b.no} อ้างลูกค้า ${b.customerId} ที่ไม่มีในฐาน`, { billNo: b.no });
    if (!m.itemsByBill.has(b.no)) push('BILL_NO_ITEMS', 'warn', `บิล ${b.no} ไม่มีรายการ`, { billNo: b.no });
    if (isNaN(dayNum(b.date))) push('BILL_BAD_DATE', 'warn', `บิล ${b.no} วันที่ไม่ถูกต้อง "${b.date}"`, { billNo: b.no });
  }
  for (const [no] of m.itemsByBill) if (!m.billByNo.has(no)) push('ITEM_NO_BILL', 'error', `รายการอ้างบิล ${no} ที่ไม่มีหัวบิล`, { billNo: no });

  // VAT guard: a bill that already carries a VAT/tax line must never get VAT added again.
  for (const [no, items] of m.itemsByBill) {
    if (items.some(i => /vat|ภาษีมูลค่าเพิ่ม/i.test(i.name || ''))) {
      push('BILL_HAS_VAT_LINE', 'info', `บิล ${no} มีรายการภาษีอยู่แล้ว (ระบบไม่คิดซ้ำ)`, { billNo: no });
    }
  }

  for (const c of m.customers) {
    const la = String(c.gpsLat ?? '').trim(), lo = String(c.gpsLng ?? '').trim();
    if ((la && !lo) || (!la && lo) || (la && !hasGps(c))) push('BAD_GPS', 'warn', `ลูกค้า ${c.id} พิกัดไม่ถูกต้อง (${la},${lo})`, { customerId: c.id });
    if (!String(c.name || '').trim()) push('CUSTOMER_NO_NAME', 'warn', `ลูกค้า ${c.id} ไม่มีชื่อ`, { customerId: c.id });
  }
  return { counts, issues };
}

// Items whose code is not in the CURRENT product register. Never declared "wrong":
// old codes are legitimate history. Output is what the settings page lists/exports.
export function unregisteredItems(m) {
  const rows = [];
  for (const [no, items] of m.itemsByBill) {
    const b = m.billByNo.get(no);
    for (const it of items) {
      if (!it.code || m.prodByCode.has(it.code)) continue;
      const lg = resolveLegacy(m, it.code, it.name);
      rows.push({
        billNo: no, date: b ? dateOf(b.date) : '', customerId: b?.customerId || '',
        customerName: b ? custName(m, b.customerId) : '', clerk: b?.openedBy || '',
        line: it.line, code: it.code, name: it.name, qty: it.qty, price: it.price, amount: it.amount,
        legacy: lg ? (lg.ok ? `คู่ที่ผู้ใช้ยืนยัน → ${lg.pair.next}` : `มีคู่ ${lg.pair.next} แต่ ${lg.reason}`) : '',
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : -1) || (a.billNo < b.billNo ? 1 : -1));
  return rows;
}
export function unregisteredSummary(rows) {
  const g = new Map();
  for (const r of rows) {
    let a = g.get(r.code);
    if (!a) { a = { code: r.code, names: new Set(), lines: 0, bills: new Set(), amount: 0, legacy: r.legacy }; g.set(r.code, a); }
    a.names.add(r.name); a.lines++; a.bills.add(r.billNo); a.amount += num(r.amount);
  }
  return [...g.values()].map(a => ({ ...a, names: [...a.names], bills: a.bills.size })).sort((x, y) => y.lines - x.lines);
}

// ---------- CSV ----------
export function toCsv(rows, cols) {
  const esc = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.map(esc).join(',')].concat(rows.map(r => cols.map(c => esc(r[c])).join(','))).join('\r\n');
}

// ---------- orders ----------
export const lineAmount = l => Math.round(num(l.qty) * num(l.price) * 100) / 100;
export const cartTotal = lines => lines.reduce((s, l) => s + lineAmount(l), 0);

// Order status words are the ones aCRM wrote into the sheet.
export const ORDER_ST = { draft: 'ร่าง', pending: 'รอส่ง', delivered: 'ส่งแล้ว', cancelled: 'ยกเลิก' };
export const ORDER_ST_LIST = Object.values(ORDER_ST);
// aCRM order number: NN + ddmmyy (Buddhist-era year), NN = running number of that day (01261169 = #1 on 26/11/69)
export function newOrderNo(orders, now = Date.now()) {
  const d = new Date(now + 7 * 3600000);
  const suffix = `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${String(d.getUTCFullYear() + 543).slice(2)}`;
  const re = new RegExp(`^(\\d{2})${suffix}$`);
  let max = 0;
  for (const o of orders || []) { const m = re.exec(String(o.no)); if (m) max = Math.max(max, +m[1]); }
  return `${pad(max + 1)}${suffix}`;
}

// Thai baht in words: 10600 -> "หนึ่งหมื่นหกร้อยบาทถ้วน"
export function bahtText(n) {
  n = Math.round(num(n) * 100) / 100;
  if (!n) return 'ศูนย์บาทถ้วน';
  const DG = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'], UN = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  const six = s => { let o = ''; const L = s.length; for (let i = 0; i < L; i++) { const d = +s[i], p = L - i - 1; if (!d) continue; if (p === 1 && d === 1) o += 'สิบ'; else if (p === 1 && d === 2) o += 'ยี่สิบ'; else if (p === 0 && d === 1 && L > 1 && +s[L - 2] > 0) o += 'เอ็ด'; else o += DG[d] + UN[p]; } return o; };
  const int = x => { const s = String(x); return s.length <= 6 ? six(s) : int(s.slice(0, -6)) + 'ล้าน' + six(s.slice(-6)); };
  const [b, st] = n.toFixed(2).split('.');
  return (+b ? int(b) + 'บาท' : '') + (+st ? six(st) + 'สตางค์' : 'ถ้วน');
}

// Delivery document (temporary delivery slip). NO product codes; customer code shown.
export function orderDocText(m, order, lines) {
  const c = m.custById.get(order.customerId);
  const out = [];
  out.push('ใบสั่งสินค้า / เอกสารส่งสินค้าชั่วคราว');
  out.push(`เลขที่: ${order.no}   วันที่: ${order.date}`);
  out.push(`รหัสลูกค้า: ${order.customerId}`);
  out.push(`ลูกค้า: ${order.customerNameOverride || c?.name || ''}`);
  if (c?.address) out.push(`ที่อยู่: ${c.address}`);
  if (order.paymentTerm) out.push(`เงื่อนไข: ${order.paymentTerm}`);
  out.push('-'.repeat(32));
  lines.forEach((l, i) => out.push(`${i + 1}. ${l.name}  x${num(l.qty)}${l.unit ? ' ' + l.unit : ''} @${money(l.price)} = ${money(lineAmount(l))}`));
  out.push('-'.repeat(32));
  out.push(`รวม ${money(cartTotal(lines))} บาท`);
  if (order.note) out.push(`หมายเหตุ: ${order.note}`);
  return out.join('\n');
}

// Orders waiting for their bill: match imported bills by customer + equal total + bill date within 7 days after the order.
export function matchOrdersToBills(m, newBills, newTotals) {
  const links = [];
  const used = new Set();
  for (const o of m.orders || []) {
    if (o.billNo || ![ORDER_ST.pending, ORDER_ST.delivered].includes(o.status)) continue;
    const tot = (m.orderItems.get(o.no) || []).reduce((s, i) => s + num(i.amount), 0);
    const od = dayNum(o.date);
    const cands = newBills.filter(b => !used.has(b.no) && b.customerId === o.customerId && Math.abs((newTotals.get(b.no) ?? NaN) - tot) < 0.01 && dayNum(b.date) >= od && dayNum(b.date) - od <= 7);
    if (cands.length === 1) { used.add(cands[0].no); links.push({ no: o.no, billNo: cands[0].no }); }
  }
  return links;
}
