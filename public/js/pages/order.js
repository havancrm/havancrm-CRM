// Order taking. The cart lives in localStorage on every change, so Back / reload / losing signal never loses it.
import * as D from '../shared/domain.js';
import { esc, icon, fmtDate, toast, sheet, confirmBox, debounce } from '../ui.js';
import { S, enqueue } from '../data.js';
import { emptyMsg, pager, bindPager } from './common.js';
import { pickCustomerSheet } from './orders.js';

const SRC = [['last', 'บิลล่าสุด'], ['bills', 'บิลย้อนหลัง'], ['regular', 'สั่งประจำ'], ['all', 'ทั้งหมด']];
const load = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full/blocked: cart still works in memory */ } };

// last price/qty this customer paid per code (newest bill wins)
function priceIndex(m, cid) {
  const idx = new Map();
  const bills = m.billsByCust.get(cid) || [];
  for (let i = bills.length - 1; i >= 0; i--) for (const it of m.itemsByBill.get(bills[i].no) || []) if (it.code && !idx.has(it.code)) idx.set(it.code, { price: D.num(it.price), qty: D.num(it.qty) });
  return idx;
}
// Turn a history line into an orderable product. Never guesses codes: only the registry and user-confirmed pairs.
function resolveLine(m, it, pidx) {
  if (!it.code) return { skip: true };
  if (m.prodByCode.has(it.code)) { const p = m.prodByCode.get(it.code); return { ok: true, code: p.code, name: p.name, price: D.num(it.price), qty: D.num(it.qty) || 1 }; }
  const lg = D.resolveLegacy(m, it.code, it.name);
  if (lg?.ok) return { ok: true, code: lg.target.code, name: lg.target.name, price: pidx.get(lg.target.code)?.price ?? D.num(it.price), qty: D.num(it.qty) || 1, via: `คู่เดิม ${it.code}` };
  return { ok: false, name: it.name, reason: 'ไม่อยู่ในทะเบียนปัจจุบัน' };
}

export default function order({ m, params, query }) {
  const key = params[0], isNew = key === 'new';
  const existing = isNew ? null : m.orders.find(o => o.no === key);
  if (!isNew && !existing) return { html: `<div class="banner bad">ไม่พบออเดอร์ ${esc(key)}</div>`, title: 'ออเดอร์' };
  const cid = isNew ? query.c : existing.customerId;
  if (!cid) return { html: `<div class="empty">เลือกลูกค้าเพื่อเริ่มออเดอร์<br><button class="btn" id="pc" style="margin-top:10px">เลือกลูกค้า</button></div>`, title: 'รับออเดอร์', after: r => { r.querySelector('#pc').onclick = () => pickCustomerSheet(m, id => { location.hash = `#/order/new?c=${encodeURIComponent(id)}`; }); } };
  const c = m.custById.get(cid);
  if (!c && isNew) return { html: `<div class="banner bad">ไม่พบลูกค้า ${esc(cid)}</div>`, title: 'รับออเดอร์' };
  const cartKey = isNew ? `cart:new:${cid}` : `cart:edit:${key}`;
  let cart = load(cartKey);
  if (!cart) {
    cart = existing
      ? { no: existing.no, customerId: cid, paymentTerm: existing.paymentTerm, note: existing.note, vatMode: existing.vatMode || 'NONE', status: existing.status, lines: (m.orderItems.get(existing.no) || []).map(i => ({ code: i.code, name: i.name, qty: D.num(i.qty), price: D.num(i.price), unit: i.unit })) }
      : { no: '', customerId: cid, paymentTerm: c?.paymentTerm || 'เงินสด', note: '', vatMode: 'NONE', status: 'draft', lines: [] };
  }
  const pidx = priceIndex(m, cid);
  const persist = () => store(cartKey, cart);
  const addLine = (p, qty) => {
    qty = D.num(qty) || 1;
    const ex = cart.lines.find(l => l.code === p.code && D.num(l.price) === D.num(p.price));
    if (ex) ex.qty = D.num(ex.qty) + qty; else cart.lines.push({ code: p.code, name: p.name, qty, price: D.num(p.price), unit: p.unit || '' });
    persist();
  };
  // pre-fill from a past bill (re-order). Unregistered lines are skipped, never guessed.
  let notice = cart.notice || '';
  if (isNew && query.from && !cart.fromApplied) {
    const skipped = [];
    for (const it of m.itemsByBill.get(query.from) || []) { const r = resolveLine(m, it, pidx); if (r.ok) addLine(r, r.qty); else if (!r.skip) skipped.push(r.name); }
    cart.fromApplied = true;
    if (skipped.length) { notice = `ข้าม ${skipped.length} รายการที่ไม่อยู่ในทะเบียนปัจจุบัน: ${skipped.join(', ')} (เลือกสินค้าทดแทนจากแท็บ “ทั้งหมด”)`; cart.notice = notice; }
    persist();
    history.replaceState(null, '', `#/order/new?c=${encodeURIComponent(cid)}`);
  }
  const title = c?.name || cid;
  return query.view === 'cart'
    ? { title: 'ตะกร้า', html: cartHtml(), after: root => cartMount(root) }
    : { title, html: pickerHtml(), after: root => pickerMount(root) };

  // ---------- picker ----------
  function pickerHtml() {
    return `<div class="stack">
      <div class="row between"><div class="grow"><div class="b ell">${esc(title)}</div><div class="xs muted">รหัส ${esc(cid)}${existing ? ` · ออเดอร์ ${esc(existing.no)}` : ''}</div></div></div>
      ${notice ? `<div class="banner row between" id="nt-b"><span>${esc(notice)}</span><button class="btn ghost sm" id="nt-x" aria-label="ปิด">${icon('x')}</button></div>` : ''}
      <div class="seg" id="src">${SRC.map(([k, t]) => `<button data-s="${k}">${t}</button>`).join('')}</div>
      <div id="pk"></div></div><div id="cb"></div>`;
  }
  function pickerMount(root) {
    let src = sessionStorage.getItem('osrc') || 'last', openBill = '', term = '';
    const inCart = code => cart.lines.filter(l => l.code === code).reduce((s, l) => s + D.num(l.qty), 0);
    const itemRow = r => {
      const n = r.code ? inCart(r.code) : 0;
      if (!r.ok) return `<div class="li" style="cursor:default;opacity:.65"><div class="grow"><div class="t ell" style="font-weight:500">${esc(r.name)}</div><div class="s">${esc(r.reason)} · เลือกสินค้าทดแทนจาก “ทั้งหมด”</div></div></div>`;
      return `<div class="li" data-add="${esc(r.code)}" data-q="${esc(r.qty || '')}" data-p="${esc(r.price ?? '')}"><div class="grow"><div class="t" style="font-weight:500">${esc(r.name)}</div><div class="s">${esc(r.code)}${r.price ? ' · ล่าสุด ' + D.money(r.price) : ''}${r.qty ? ' × ' + D.num(r.qty) : ''}${r.via ? ` · <span class="badge">${esc(r.via)}</span>` : ''}</div></div><div class="r">${n ? `<span class="badge ok">${n}</span> ` : ''}<span class="btn ghost sm" style="pointer-events:none">${icon('plus')}</span></div></div>`;
    };
    const fromLines = items => items.map(it => resolveLine(m, it, pidx)).filter(r => !r.skip);
    const draw = () => {
      root.querySelectorAll('#src button').forEach(b => b.classList.toggle('on', b.dataset.s === src));
      const pk = root.querySelector('#pk'); let rows = [], head = '';
      if (src === 'last') {
        const lb = D.lastBillOf(m, cid);
        if (!lb) { pk.innerHTML = emptyMsg('ลูกค้ารายนี้ยังไม่มีบิล'); return drawBar(); }
        head = `<div class="row between sm muted" style="margin-bottom:6px"><span>บิล ${esc(lb.no)} · ${fmtDate(lb.date)}</span><button class="btn ghost sm" data-all>เพิ่มทั้งบิล</button></div>`;
        rows = fromLines(m.itemsByBill.get(lb.no) || []);
      } else if (src === 'bills') {
        const bills = [...(m.billsByCust.get(cid) || [])].reverse().slice(0, 30);
        if (!openBill) { pk.innerHTML = bills.length ? `<div class="list">${bills.map(b => `<div class="li" data-ob="${esc(b.no)}"><div class="grow"><div class="t">บิล ${esc(b.no)}</div><div class="s">${fmtDate(b.date)} · ${(m.itemsByBill.get(b.no) || []).length} รายการ</div></div><div class="r num b">${D.money(D.billTotal(m, b.no))}</div></div>`).join('')}</div>` : emptyMsg('ยังไม่มีบิลย้อนหลัง'); return drawBar(); }
        head = `<div class="row between sm" style="margin-bottom:6px"><button class="btn ghost sm" data-ob="">${icon('back')} บิลอื่น</button><span class="muted">บิล ${esc(openBill)}</span><button class="btn ghost sm" data-all>เพิ่มทั้งบิล</button></div>`;
        rows = fromLines(m.itemsByBill.get(openBill) || []);
      } else if (src === 'regular') {
        const reg = D.regularItems(m, cid, 30);
        rows = fromLines(reg.map(r => ({ code: r.code, name: r.name, price: r.lastPrice, qty: r.lastQty })));
        if (!rows.length) { pk.innerHTML = emptyMsg('ยังไม่มีสินค้าที่สั่งประจำ'); return drawBar(); }
      } else {
        const list = term ? D.searchProducts(m, term, 80) : m.products.slice(0, 80);
        head = `<label class="search" style="margin-bottom:8px">${icon('search')}<input id="pq" type="search" value="${esc(term)}" placeholder="ค้นหาชื่อหรือรหัสสินค้า (${m.products.length} รายการ)" autocomplete="off"></label>`;
        rows = list.map(p => ({ ok: true, code: p.code, name: p.name, price: pidx.get(p.code)?.price || '', qty: pidx.get(p.code)?.qty || '' }));
        pk.innerHTML = head + (rows.length ? `<div class="list">${rows.map(itemRow).join('')}</div>` : emptyMsg('ไม่พบสินค้า'));
        const pq = pk.querySelector('#pq'); pq.addEventListener('input', debounce(() => { term = pq.value.trim(); const pos = pq.selectionStart; draw(); const n = root.querySelector('#pq'); n.focus(); n.setSelectionRange(pos, pos); }, 220));
        return drawBar();
      }
      pk.innerHTML = head + `<div class="list">${rows.map(itemRow).join('') || emptyMsg('ไม่มีรายการ')}</div>`;
      pk._rows = rows;
      drawBar();
    };
    const drawBar = () => {
      const n = cart.lines.length;
      root.querySelector('#cb').innerHTML = n ? `<button class="cartbar" data-go="#/order/${encodeURIComponent(key)}?${isNew ? `c=${encodeURIComponent(cid)}&` : ''}view=cart">${icon('cart')}<span class="grow b">ตะกร้า ${n} รายการ</span><span class="b num">${D.money(D.cartTotal(cart.lines))} ฿</span>${icon('chev')}</button>` : '';
    };
    root.addEventListener('click', e => {
      const sb = e.target.closest('#src button'); if (sb) { src = sb.dataset.s; sessionStorage.setItem('osrc', src); openBill = ''; draw(); return; }
      const ob = e.target.closest('[data-ob]'); if (ob) { openBill = ob.dataset.ob; draw(); return; }
      if (e.target.closest('[data-all]')) { const rows = root.querySelector('#pk')._rows || []; let n = 0; for (const r of rows) if (r.ok) { addLine(r, r.qty || 1); n++; } toast(`เพิ่ม ${n} รายการ`); draw(); return; }
      const add = e.target.closest('[data-add]');
      if (add) { const p = m.prodByCode.get(add.dataset.add); addLine({ code: p.code, name: p.name, price: add.dataset.p }, add.dataset.q || 1); draw(); }
    });
    root.querySelector('#nt-x')?.addEventListener('click', () => { delete cart.notice; persist(); root.querySelector('#nt-b').remove(); });
    draw();
  }

  // ---------- cart ----------
  function cartHtml() {
    const total = D.cartTotal(cart.lines);
    return `<div class="stack"><div class="row between"><div class="b ell">${esc(title)}</div><span class="xs faint">${esc(cid)}</span></div>
      ${existing?.status === 'confirmed' ? `<div class="banner">ออเดอร์นี้ยืนยันแล้ว การบันทึกจะอัปเดตออเดอร์เดิม</div>` : ''}
      <div id="cl"></div>
      <div class="row between"><span class="b">ยอดรวม</span><span class="b num" style="font-size:20px" id="ct">${D.money(total)} ฿</span></div>
      <div class="xs faint">ยอดรวม = จำนวน × ราคา ของแต่ละรายการ ระบบไม่บวกภาษีเพิ่ม</div>
      <label class="field"><span>เงื่อนไขชำระ</span><input class="inp" id="tm" value="${esc(cart.paymentTerm || '')}" list="terms"></label><datalist id="terms"><option value="เงินสด"><option value="เครดิต 30 วัน"><option value="เครดิต 15 วัน"></datalist>
      <label class="field"><span>หมายเหตุออเดอร์</span><textarea class="inp" id="nt">${esc(cart.note || '')}</textarea></label>
      <div class="row"><button class="btn line grow" id="sd">บันทึกร่าง</button><button class="btn grad grow" id="sc">ยืนยันออเดอร์</button></div>
      <div class="row"><button class="btn ghost grow" id="doc">${icon('report')} เอกสารส่งสินค้า</button>${existing ? `<button class="btn line" id="cx" style="color:var(--bad)">ยกเลิกออเดอร์</button>` : `<button class="btn line" id="clr" style="color:var(--bad)">ล้างตะกร้า</button>`}</div></div>`;
  }
  function cartMount(root) {
    const list = root.querySelector('#cl');
    const drawLines = () => {
      list.innerHTML = cart.lines.length ? `<div class="list">${cart.lines.map((l, i) => `<div class="li" style="cursor:default;align-items:flex-start"><div class="grow"><div class="t" style="font-weight:500">${esc(l.name)}</div><div class="xs faint">${esc(l.code || '')}</div>
        <div class="row" style="margin-top:6px;flex-wrap:wrap"><div class="qty"><button data-d="${i}" data-v="-1">−</button><input inputmode="decimal" data-q="${i}" value="${D.num(l.qty)}" aria-label="จำนวน"><button data-d="${i}" data-v="1">+</button></div><span class="muted">×</span><input class="inp" style="width:84px;min-height:36px;padding:6px 8px" inputmode="decimal" data-p="${i}" value="${D.num(l.price)}" aria-label="ราคา"><span class="b num" data-a="${i}" style="margin-left:auto">${D.money(D.lineAmount(l))}</span></div></div>
        <button class="btn ghost sm" data-x="${i}" aria-label="ลบ">${icon('x')}</button></div>`).join('')}</div>` : emptyMsg('ตะกร้าว่าง — กลับไปเลือกสินค้า');
    };
    const upd = () => { persist(); root.querySelector('#ct').textContent = `${D.money(D.cartTotal(cart.lines))} ฿`; cart.lines.forEach((l, i) => { const a = root.querySelector(`[data-a="${i}"]`); if (a) a.textContent = D.money(D.lineAmount(l)); }); };
    drawLines();
    list.addEventListener('click', e => {
      const d = e.target.closest('[data-d]'); if (d) { const l = cart.lines[+d.dataset.d]; l.qty = Math.max(0, D.num(l.qty) + +d.dataset.v); drawLines(); upd(); return; }
      const x = e.target.closest('[data-x]'); if (x) { cart.lines.splice(+x.dataset.x, 1); drawLines(); upd(); }
    });
    list.addEventListener('input', e => { const t = e.target; if (t.dataset.q !== undefined) cart.lines[+t.dataset.q].qty = D.num(t.value); if (t.dataset.p !== undefined) cart.lines[+t.dataset.p].price = D.num(t.value); upd(); });
    const sync = () => { cart.paymentTerm = root.querySelector('#tm').value.trim(); cart.note = root.querySelector('#nt').value.trim(); persist(); };
    root.querySelector('#tm').oninput = sync; root.querySelector('#nt').oninput = sync;

    const build = status => ({ order: { no: cart.no, customerId: cid, date: existing?.date || m.today, paymentTerm: cart.paymentTerm, vatMode: cart.vatMode || 'NONE', status, note: cart.note, billNo: existing?.billNo || '', customerNameOverride: existing?.customerNameOverride || '' }, lines: cart.lines.filter(l => D.num(l.qty) > 0) });
    const save = async status => {
      sync();
      const p = build(status);
      if (status === 'confirmed' && !p.lines.length) return toast('ยังไม่มีสินค้าในตะกร้า');
      const zero = p.lines.filter(l => D.num(l.price) === 0);
      if (status === 'confirmed' && zero.length && !(await confirmBox(`มี ${zero.length} รายการราคา 0 บาท (แถม/ยังไม่กรอกราคา) ยืนยันต่อหรือไม่?`))) return;
      if (!cart.no) { cart.no = D.newOrderNo(Date.now(), S.deviceId); persist(); p.order.no = cart.no; }
      try {
        await enqueue('order.save', p);
        localStorage.removeItem(cartKey);
        if (status === 'confirmed') { docSheet(p.order, p.lines, () => { location.hash = '#/orders'; }); toast('ยืนยันออเดอร์แล้ว'); }
        else { toast(status === 'cancelled' ? 'ยกเลิกออเดอร์แล้ว' : 'บันทึกร่างแล้ว'); location.hash = '#/orders'; }
      } catch (er) { toast(er.message); }
    };
    root.querySelector('#sd').onclick = () => save('draft');
    root.querySelector('#sc').onclick = () => save('confirmed');
    root.querySelector('#doc').onclick = () => { sync(); docSheet({ ...build(cart.status || 'draft').order, no: cart.no || '(ยังไม่บันทึก)' }, build('draft').lines); };
    root.querySelector('#cx')?.addEventListener('click', async () => { if (await confirmBox('ยกเลิกออเดอร์นี้?', 'ยกเลิกออเดอร์')) save('cancelled'); });
    root.querySelector('#clr')?.addEventListener('click', async () => { if (await confirmBox('ล้างตะกร้าทั้งหมด?', 'ล้าง')) { cart.lines = []; persist(); drawLines(); upd(); } });
  }
  function docSheet(o, lines, onClose) {
    const txt = D.orderDocText(m, o, lines);
    const s = sheet(`<div class="row between"><h3 style="margin:0">เอกสารส่งสินค้า</h3><button class="btn ghost sm" data-close>ปิด</button></div>
      <pre id="dt" style="white-space:pre-wrap;font-family:inherit;background:var(--bg-soft);border-radius:12px;padding:12px;margin:12px 0;font-size:14px">${esc(txt)}</pre>
      <div class="row"><button class="btn line grow" id="dc">คัดลอก</button><button class="btn line grow" id="dp">พิมพ์</button><button class="btn grad grow" id="ds">แชร์</button></div>`, { onClose });
    s.el.querySelector('#dc').onclick = async () => { try { await navigator.clipboard.writeText(txt); toast('คัดลอกแล้ว'); } catch { toast('คัดลอกไม่ได้'); } };
    s.el.querySelector('#ds').onclick = async () => { if (navigator.share) { try { await navigator.share({ text: txt }); } catch {} } else { try { await navigator.clipboard.writeText(txt); toast('คัดลอกแล้ว (อุปกรณ์ไม่รองรับการแชร์)'); } catch {} } };
    s.el.querySelector('#dp').onclick = () => { const pa = document.createElement('div'); pa.id = 'pa'; pa.style.whiteSpace = 'pre-wrap'; pa.textContent = txt; document.body.appendChild(pa); window.print(); setTimeout(() => pa.remove(), 500); };
  }
}
