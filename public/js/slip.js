// ใบส่งสินค้าชั่วคราว - drawn on the company's own form (public/img/slip-template.png).
// Field positions are taken from the sample overlay supplied with the form (percent of the form).
// By default the product-code column is LEFT BLANK (requirement: order documents do not show product codes);
// pass showCode:true to print it like the sample.
import { num, money, bahtText, dayNum, dayStr } from './shared/domain.js';
import { esc } from './ui.js';

const ROWS_PER_PAGE = 15, ROW0 = 34.341, ROW_STEP = 2.61;
const f = (style, text) => `<span class="f" style="${style}">${esc(text)}</span>`;
export const beDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${+m[1] + 543}` : ''; };

export function dueDate(date, term) {
  const m = /เครดิต\s*(\d+)/.exec(term || '') || /(\d+)\s*วัน/.exec(term || '');
  const d = dayNum(date); if (!Number.isFinite(d)) return '';
  return m ? dayStr(d + +m[1]) : dayStr(d);
}
function wrapAddress(a, n = 44) {
  const words = String(a || '').trim().split(/\s+/).filter(Boolean); const lines = ['']; 
  for (const w of words) { const cur = lines[lines.length - 1]; if ((cur + ' ' + w).trim().length > n && lines.length < 2) lines.push(w); else lines[lines.length - 1] = (cur + ' ' + w).trim(); }
  return lines;
}

// order: {no,date,customerId,customerNameOverride,paymentTerm,note}; lines: [{code,name,qty,price,unit}]
// cust: customers row (or undefined); extra: {salesperson, clerk, phones[]}
export function slipHtml(order, lines, cust, { showCode = false, salesperson = '', clerk = '', phones = [], tempCode = false, units = {} } = {}) {
  const rows = lines.filter(l => num(l.qty) > 0 || num(l.price) > 0);
  const pages = []; for (let i = 0; i < Math.max(1, rows.length); i += ROWS_PER_PAGE) pages.push(rows.slice(i, i + ROWS_PER_PAGE));
  const total = rows.reduce((s, l) => s + Math.round(num(l.qty) * num(l.price) * 100) / 100, 0);
  const name = order.customerNameOverride || cust?.name || '';
  const [a1, a2] = wrapAddress(cust?.address);
  const tel = [phones.length ? 'โทร.' + phones.join(' , ') : '', cust?.contactName || ''].filter(Boolean).join(' ');
  const term = [order.paymentTerm, clerk || cust?.billClerk].filter(Boolean).join('/');
  const date = beDate(order.date), due = beDate(dueDate(order.date, order.paymentTerm));
  return pages.map((pg, pi) => {
    const last = pi === pages.length - 1;
    let h = `<div class="slip"><img src="/img/slip-template.png" alt="แบบฟอร์มใบส่งสินค้าชั่วคราว" draggable="false">`;
    h += f('top:12.225%;left:81.985%', order.no);
    h += f('top:16.209%;left:13.787%', name) + f('top:16.209%;left:50.735%', tempCode ? 'รอรหัสบัญชี' : order.customerId);
    h += f('top:19.093%;left:13.787%', a1 || '') + f('top:21.497%;left:13.787%', a2 || '') + f('top:23.901%;left:13.787%', tel);
    h += f('top:16.484%;left:82.077%', date) + f('top:19.368%;left:82.077%', due) + f('top:22.115%;left:82.077%', term) + f('top:24.863%;left:82.077%', salesperson);
    pg.forEach((l, i) => {
      const top = `top:${(ROW0 + i * ROW_STEP).toFixed(3)}%`, n = pi * ROWS_PER_PAGE + i + 1;
      h += f(`${top};left:3.493%;width:4.596%;text-align:center`, n);
      if (showCode) h += f(`${top};left:10.294%`, l.code || '');
      h += f(`${top};left:21.691%`, l.name);
      h += f(`${top};right:25.368%`, `${num(l.qty)}${(l.unit || units[l.code]) ? ' ' + (l.unit || units[l.code]) : ''}`);
      h += f(`${top};right:15.625%`, money2(l.price)) + f(`${top};right:3.033%`, money2(Math.round(num(l.qty) * num(l.price) * 100) / 100));
    });
    if (last) {
      h += f('top:78.984%;left:4.779%', `(${bahtText(total)})`);
      h += f('top:76.717%;right:3.309%', money2(total)) + f('top:79.327%;right:3.309%', '-') + f('top:81.868%;right:3.309%', money2(total));
      h += f('top:86.676%;left:10.846%', salesperson);
    } else h += f('top:78.984%;left:4.779%', `(ต่อหน้า ${pi + 2})`);
    return h + '</div>';
  }).join('');
}
export const money2 = n => num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
void money;
