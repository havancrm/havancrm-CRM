// Synthetic data for Preview / tests ONLY (never touches the real sheet). Shape == real schema.
import { todayStr, dayNum, dayStr, nowIso } from '../../public/js/shared/domain.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

const TYPES = ['นวด/สปา', 'เพ็ทช็อป/กรูมมิ่ง', 'คาร์แคร์/ติดฟิล์ม', 'ร้านเสริมสวย', 'ซาลอน'];
const LABELS = ['นวด', 'ถนนพระราม2', 'ถนนบรมราชชนนี', 'ถนนราชพฤกษ์', 'ลาดพร้าว', 'VIP'];
const CLERKS = ['หยง', 'เหมียว', 'ฝน'];
export const PRODUCTS = [
  ['1001', 'ครีมโกรกผมสีดำ A1'], ['1002', 'ครีมโกรกผมสีน้ำตาลเข้ม A2'], ['4012', 'แชมพูออยล์'], ['4025', 'แชมพู อโวคาโด้'],
  ['5029', 'ครีมนวดอโวคาโด้'], ['9617', 'โลชั่น 3,200 ml. กลิ่นน้ำนมข้าว'], ['8217*', 'สบู่เหลว 1,000 ml. กลิ่นมะลิ'], ['9861', 'เจลอาบน้ำ 500 ml. กลิ่นลาเวนเดอร์'],
  ['9841', 'โฟมล้างหน้า 250 ml. กลิ่นมิ้นต์'], ['9837', 'ครีมนวดผม 500 ml. กลิ่นพีช'], ['9839', 'แชมพูสระผม 500 ml. กลิ่นพีช'], ['9617-4', 'โลชั่น 3,200 ml. กลิ่นน้ำนมข้าว ลด 4 บาท'],
  ...Array.from({ length: 24 }, (_, i) => [String(3000 + i), `สินค้าทดสอบ ${i + 1} ขนาด ${100 + i * 10} ml.`]),
];
// Old billed codes (not in today's register). 9833* has a deliberately conflicting name.
const LEGACY_ITEMS = [
  ['8217', 'สบู่เหลว 1,000 ml. กลิ่นมะลิ'], ['8741*', 'เจลอาบน้ำ 500 ml. กลิ่นลาเวนเดอร์'],
  ['9833*', 'ทรีทเมนต์เคราติน 2,000 ml.'],            // register 9841 = โฟมล้างหน้า 250 ml → must NOT be paired
  ['7777', 'สินค้าเลิกผลิตรุ่นเก่า'],
];

export function buildFixtures({ now = Date.now(), customers = 80, billsPerCustomer = 8, seed = 7 } = {}) {
  const R = rng(seed), pick = a => a[Math.floor(R() * a.length)];
  const today = dayNum(todayStr(now));
  const out = {
    customers: [], customer_phones: [], customer_labels: [], bills: [], bill_items: [],
    products: PRODUCTS.map(([code, name]) => ({ code, name })), orders: [], order_items: [],
    visits: [], tasks: [], activities: [], gps: [], photos: [], changes: [], IMPORT_BATCHES: [], IMPORT_REVIEW: [],
    ACCESS: [
      { email: 'dev@local', active: 'TRUE', note: 'dev admin', role: 'admin' },
      { email: 'sales@local', active: 'TRUE', note: 'sales', role: 'sales' },
      { email: 'off@local', active: 'FALSE', note: 'disabled', role: 'sales' },
    ],
    systemSettings: [{ id: 'rules-2026-11-26T09:50:00+07:00', updatedAt: '2026-11-26T09:50:00+07:00', data: JSON.stringify({ comm: 8, visitDef: 30, dormDays: 365, lateDays: 90, vatRate: 7 }) }],
  };
  let billNo = 358600;
  for (let i = 0; i < customers; i++) {
    const id = String(57900 + i);
    const closed = i % 23 === 7;
    out.customers.push({
      id, name: `ร้านทดสอบ ${i + 1} ${pick(['บางนา', 'ลาดพร้าว', 'พัฒนาการ', 'ราชพฤกษ์'])}`, type: pick(TYPES),
      address: `ซอย ${i + 1} ถนนทดสอบ`, contactName: i % 5 ? `คุณ ทดสอบ${i}` : '', paymentTerm: pick(['เงินสด', 'เครดิต 30 วัน']),
      billClerk: pick(CLERKS), activeFlag: closed ? 'FALSE' : 'TRUE',
      gpsLat: i % 4 ? (13.6 + R() * 0.3).toFixed(6) : '', gpsLng: i % 4 ? (100.4 + R() * 0.3).toFixed(6) : '',
      mapLink: '', lineId: i % 6 === 0 ? `line${i}` : '', keepNote: i % 3 === 0 ? 'จอดรถหน้าร้านไม่ได้ ให้จอดซอยข้าง' : '', customerNote: '', specialConditions: '', storeHours: '09:00-18:00',
      taxInvoiceRequired: '', taxName: '', taxAddress: '', taxBranch: '', taxId: '', receiptRequired: '', documentNote: '', photoFolderId: '', storePhotoFileIds: '',
      birthday: i % 9 === 0 ? `19${70 + (i % 20)}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}` : '',
    });
    out.customer_phones.push({ customerId: id, seq: '1', phone: `08${String(10000000 + i * 137).slice(0, 8)}` });
    out.customer_labels.push({ customerId: id, seq: '1', label: pick(LABELS) });
    if (i % 3 === 0) out.customer_labels.push({ customerId: id, seq: '2', label: pick(LABELS) });

    // purchase history: regular cadence per customer; lapsed/new customers get shifted windows
    const cadence = 14 + (i % 6) * 9;
    const lapsed = i % 11 === 3, isNew = i % 13 === 5, overdue = i % 7 === 2 && !lapsed && !isNew;
    const nBills = isNew ? 1 + (i % 2) : billsPerCustomer;
    let d = today - (lapsed ? 200 + (i % 50) : isNew ? 20 + (i % 30) : overdue ? Math.round(cadence * 1.8) : (i % cadence) + 1);
    const dates = [];
    for (let b = 0; b < nBills; b++) { dates.push(d); d -= cadence + Math.floor(R() * 4); }
    dates.reverse();
    for (const dd of dates) {
      const no = String(billNo++);
      const hasVat = billNo % 97 === 0;
      out.bills.push({ no, date: dayStr(dd), customerId: id, customerNameOverride: '', paymentTerm: 'เงินสด', openedBy: pick(CLERKS), salesperson: 'อาร์ต', vatMode: hasVat ? 'INCLUDED' : 'NONE', source: 'fixture', updatedAt: nowIso(now) });
      const nItems = 1 + Math.floor(R() * 4);
      let line = 1, sum = 0;
      for (let k = 0; k < nItems; k++) {
        const useLegacy = (billNo % 41 === 0 && k === 0) ? pick(LEGACY_ITEMS) : null;
        const p = useLegacy || pick(PRODUCTS.slice(0, 12));
        const qty = 1 + Math.floor(R() * 10), price = 50 + Math.floor(R() * 20) * 10;
        out.bill_items.push({ billNo: no, line: String(line++), code: p[0], name: p[1], qty: String(qty), price: String(price), amount: String(qty * price) });
        sum += qty * price;
      }
      if (hasVat) { const v = Math.round(sum * 0.07); out.bill_items.push({ billNo: no, line: String(line++), code: '', name: 'VAT 7%', qty: '1', price: String(v), amount: String(v) }); }
    }
    if (i % 4 === 1) out.visits.push({ visitId: `V-seed-${i}`, customerId: id, at: nowIso(now - (3 + i % 40) * 86400000), lat: '13.7', lng: '100.5', source: 'app', note: 'เข้าพบทดสอบ', fileId: '', status: 'done', plannedAt: '', completedAt: nowIso(now - (3 + i % 40) * 86400000), outcome: '', opId: `seed-v-${i}`, updatedAt: nowIso(now), data: '{"kind":"visit"}' });
    if (i % 10 === 2) out.visits.push({ visitId: `V-seed-p${i}`, customerId: id, at: '', lat: '', lng: '', source: 'app', note: 'นัดทดสอบ', fileId: '', status: 'planned', plannedAt: dayStr(today + 2 + (i % 5)), completedAt: '', outcome: '', opId: `seed-p-${i}`, updatedAt: nowIso(now), data: '{"kind":"appointment"}' });
  }
  return out;
}
