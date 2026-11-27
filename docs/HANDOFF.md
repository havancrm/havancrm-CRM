# HAVAN CRM — เอกสารส่งต่องาน (Handoff)

อัปเดตล่าสุด: 2026-11-27 · Repo: https://github.com/havancrm/havancrm-CRM · Branch: `claude/ecstatic-cannon-i4gapq` (ยังไม่ merge, ไม่มี PR) · Commit ล่าสุดตอนเขียน: `487a778`

## 1. คืออะไร
CRM เซลล์ภาคสนาม แทน/คู่กับ aCRM (ART) เดิม — Mobile First, Cloudflare Workers (Free) + **Google Sheets CRM เดิมเป็นฐานเดียว** (Spreadsheet ID `1KbM5G_-O24NfRfiAX9eBcp9KBg_GjGXd7aUCKVdfkHY`, 18 แท็บ/178 คอลัมน์). เป้าหมาย URL: `crm.havan-crm.workers.dev`. **ห้ามแก้ ART / aCRM / repo `havancrm/A`; ห้ามสร้างฐานใหม่; ห้ามล้างข้อมูลจริงเพื่อทดลอง**

## 2. สถานะ ณ ตอนนี้
- โค้ดครบฟังก์ชันหลักตาม MASTER PROMPT และคำสั่งรอบ 2–3 ทดสอบผ่าน: **หน่วย 67 / ข้อมูลจริง 5 / E2E มือถือ 60**
- **ยังไม่ได้ deploy จริง** และ **ยังไม่เคยเขียนลงชีตจริงผ่าน Worker** (ไม่มี Cloudflare/Google credential ใน session ที่ทำงาน)
- Preview ที่เคยทำเป็นบัญชี Cloudflare ชั่วคราว (`wrangler deploy --temporary`, ข้อมูลจำลอง) หมดอายุแล้ว/ใกล้หมด — ไม่ใช่ของจริง

## 3. วิธีรัน/ทดสอบ
```bash
npm install
npm test                         # 67 unit
npm run dev                      # http://localhost:8787 ข้อมูลจำลอง (ไม่แตะชีตจริง)
npm run test:e2e                 # 60 ขั้นตอน (ต้องมี playwright+chromium; wrangler dev จะถูกสตาร์ตเอง)
REAL_DIR=<โฟลเดอร์ส่วนตัว> node --test test/real   # ต้องมี real.json (สำเนาชีต), bills.ttx, customers.ttx, slip-sample.html (ไฟล์ส่วนตัว ไม่อยู่ใน repo)
npm run stamp                    # ฝังเวอร์ชันเดียวกันใน version.js / sw.js / index.html / server
```
Preview ชั่วคราว: `npx wrangler deploy --temporary --var DATA_MODE:memory --var AUTH_MODE:dev --var GOOGLE_CLIENT_ID:` (อายุ ~1 ชม. ต้อง claim; จากเครื่อง sandbox เปิดไม่ได้เพราะ Cloudflare bot challenge — ต้องเปิดจากมือถือ)

## 4. โครงสร้างโค้ด
```
public/js/shared/schema.js   18 แท็บ/178 คอลัมน์ — อ่าน-เขียนตามชื่อ Header เท่านั้น (ห้ามใช้ตำแหน่งคอลัมน์)
public/js/shared/domain.js   ยอดขาย, สถานะลูกค้า, รอบซื้อ, ค้นหา, ทะเบียนสินค้า/รหัสเก่า, ลูกค้าใหม่, เลขออเดอร์, baht text, ตรวจคุณภาพ
public/js/shared/ops.js     การกระทำ -> mutation แถวชีต (ใช้ทั้ง Worker และแอป/ออฟไลน์), idempotent ด้วย opId
public/js/ttx.js            ตัวอ่าน TTX จริง (บิล + ลูกค้า) + กติกาแปลง
public/js/slip.js           ใบส่งสินค้าชั่วคราววาดบนแบบฟอร์ม Havan (public/img/slip-template.png)
public/js/pages/*.js        home, customers, customer(360), visits(รอบ+ปฏิทิน), orders/order, sales, newcustomers, map, settings(+นำเข้า/คุณภาพ/ป้าย/ซิงก์), forms
public/js/data.js           ฝั่ง client: auth, แคช IndexedDB, คิวออฟไลน์, ซิงก์
public/data/units.json      หน่วยนับต่อรหัสสินค้า (366 รหัส; ไม่มีราคา)
src/server/index.js         Worker: /api/health|me|bootstrap|ops|tab|diagnostics|photo
src/server/store.js         MemoryStore (preview/ทดสอบ) + SheetsStore (Google Sheets API, JWT service account)
src/server/exec.js          ตัวรันการเขียน: กันซ้ำ, changes log, สิทธิ์ admin
src/server/auth.js          Google ID token -> แท็บ ACCESS (active, role=admin)
test/unit, test/e2e, test/real, test/fixtures   (fixtures = ข้อมูลสังเคราะห์เท่านั้น)
docs/REPORT.md  docs/DEPLOY.md  docs/HANDOFF.md
```

## 5. กติกาข้อมูล (ห้ามฝ่าฝืน)
- ฐานเก็บข้อมูลดิบ คำนวณในแอป. **ยอดขาย = SUM(bill_items.amount)**; **ไม่บวก VAT ซ้ำ**. ห้ามสร้างคอลัมน์ยอดรวม/aliases/product_variants/order_blocks
- รหัสลูกค้า/สินค้าเป็นข้อความเสมอ (`8217*`, `00123`). ไม่รวมรหัสสินค้าเอง (โหล/ชุด/ลด 4 บาท แยกรหัส)
- คู่รหัสเก่าที่ผู้ใช้ยืนยัน: 8217→8217*, 8741*→9861, 9833*→9841, 9834*→9837, 9835*→9839 (ใช้เมื่อชื่อไม่ขัดแย้งเท่านั้น). รหัสไม่ตรงทะเบียน ≠ ผิด; ไม่เดารหัสใหม่
- ป้องกันซ้ำ: ทุกการเขียนมี opId; นำเข้าไฟล์ซ้ำถูกปฏิเสธด้วย fileHash; บิล/บรรทัดซ้ำถูกข้าม; ไม่เขียนทับบิลเดิม

## 6. ข้อเท็จจริงจากข้อมูลจริง (ที่ใช้ตัดสินใจ)
- จำนวน: ลูกค้า 1,383 / บิล 9,922 / รายการ 30,811 / สินค้า 366 (ตรงเอกสารส่งมอบ). KPI จริง: ปัจจุบัน 549, ห่างหาย 660, เลิกกิจการ 174; ยอดขาย 12,389,283.60 บาท
- `customers.activeFlag`: ว่าง = ดำเนินกิจการ, `FALSE`/0 = เลิกกิจการ, `TRUE`/1 = ดำเนินกิจการ
- ค่าเกณฑ์ในแท็บ `systemSettings` (แถว `rules-…`): `lateDays 90`, `dormDays 365`, `visitDef 30`, `comm 8`, `vatRate 7` — **แอปอ่านจากฐาน ไม่ hard-code**. ส่วน `soonDays 7`, `minCycleBills 3`, `newDays 90` และสูตรรอบซื้อ (ค่ากลางระยะห่างวันที่ซื้อ) **ผมตั้งเอง ยังไม่ยืนยันกับ aCRM**
- รูปแบบแถวที่ aCRM เขียน (แอปใหม่เขียนตามนี้): ออเดอร์ `ร่าง/รอส่ง/ส่งแล้ว/ยกเลิก`, เลขออเดอร์ `NN`+`ddmmyy`(พ.ศ.) เช่น `01261169`, เชื่อมบิลด้วยหมายเหตุ `เชื่อมบิล N`; เข้าพบ = visits `COMPLETED` + activity `เข้าพบ`; นัดหมาย = tasks type `ติดตาม` (dueAt `YYYY-MM-DD 00:00:00`); โน้ต = activity `โน้ต`; แตะโทร/นำทาง = activity `โทร`/`นำทาง`; แก้ข้อมูล = `เปลี่ยนข้อมูลสำคัญ`; ร้านใหม่ = `เพิ่มลูกค้า`; IMPORT_BATCHES (`TTX-BILL-yyyymmdd-nnn`, `TTX cp874`, `sha256:…`), IMPORT_REVIEW (`pending/confirmed`, severity `low/medium`)
- ชีตตัดค่าว่างท้ายแถว (แถวสั้น) — โค้ดรองรับแล้ว

## 7. TTX จริง (รูปแบบและกติกา)
ไฟล์เป็นรายงานพิมพ์ cp874, TAB, ฟิลด์มี quote ข้ามบรรทัดได้. **บิล**: แถวหัว (เลขบิล, วัน dd/mm/พ.ศ., รหัสลูกค้า, ชื่อ, "", ยอด) → แถว (โทร/ผู้ติดต่อ, "เงื่อนไข/พนักงาน") → แถวรายการ (รหัส, ชื่อ, จำนวน, ราคา, ยอด). **ลูกค้า**: (ลำดับ, รหัส, ชื่อ, ยอด) + 2 แถวที่อยู่ + "เบอร์ติดต่อ :" + "การชำรเงิน :".
กติกาแปลง (เทียบกับบิลจริง ~9,900 ใบ): บรรทัด `0015 ภาษีมูลค่าเพิ่ม` ไม่เก็บ + `vatMode=VAT_OUT`; มี `0014 ขอใบกำกับภาษี` = `VAT_IN`; ยอดหัวบิลต่างรายการ → ใช้รายการ + flag `HEADER_NE_ITEMS`; "เงื่อนไข/พนักงาน" → paymentTerm (คำว่า โอน/แนบสำเนา = `โอน`) + openedBy (คำสุดท้ายที่ไม่ใช่คำชำระเงิน), ว่าง = `เงินสด`. ผลกับไฟล์จริง: 9,904 บิล, ตรงฐาน 9,899, ต่างยอด 3, ใหม่ 1; ลูกค้า 1,382 ราย มีครบ. 3 แถวอ่านไม่ได้ (quote เสียในไฟล์ ยอด 0) รายงานเป็น flag ไม่เดา
เชื่อมออเดอร์กับบิล: ลูกค้าเดียวกัน + ยอดเท่ากัน + บิลไม่เกิน 7 วันหลังออเดอร์ + จับคู่ได้ชัดเดียว (กติกานี้อนุมานจาก 40 ออเดอร์จริง)

## 8. ฟีเจอร์ที่ทำแล้ว (สรุป)
หน้าแรก (ค้นหา, การ์ด 4 ช่อง, ทางลัด, ป้ายกำกับ 2 คอลัมน์) · ลูกค้า + Customer 360 (4 แท็บ, ปุ่มด่วน 5 ปุ่ม) · ฟอร์มเดียว เข้าพบ/โน้ต/นัดหมาย + GPS + รูป (ไม่บังคับ) · รอบลูกค้า (เลยรอบ/ใกล้ถึง/ขาดเข้าพบ) · **ปฏิทิน: แบบเดือน = การ์ด 12 เดือน/ปี, แบบวัน = ตารางวัน** · รับออเดอร์ (บิลล่าสุด/ย้อนหลัง/สั่งประจำ/ทั้งหมด, ตะกร้าไม่หายเมื่อย้อนกลับ, ร่าง/ยืนยัน) · **ใบส่งสินค้าบนฟอร์ม Havan (พิมพ์รหัสสินค้าเป็นค่าเริ่มต้น — เจ้าของตัดสินใจ)** · **เพิ่มร้านใหม่ในภาคสนาม** (รหัสชั่วคราว `N-yymmdd-XXXX`, กันซ้ำทั้งแอป/เซิร์ฟเวอร์, ผูกรหัสบัญชีแล้วเปลี่ยนรหัสทุกแท็บ) · ลูกค้าใหม่ 2 กลุ่ม (ซื้อครั้งแรก / เพิ่มทะเบียน) · รายงานยอดขาย (ตาราง ไม่มีกราฟ) · แผนที่ · ตั้งค่า (เกณฑ์, ป้ายกำกับ, นำเข้า TTX, คุณภาพข้อมูล, ประวัตินำเข้า, รหัสไม่ตรงทะเบียน + ส่งออก CSV, ซิงก์/ตรวจโครงสร้าง 18 แท็บ) · ออฟไลน์ + คิวซิงก์ · service worker + ระบบเวอร์ชัน

## 9. งานที่ยังค้าง (เรียงตามสำคัญ)
1. **เทียบกับ aCRM เดิม** — `havancrm/A` เข้าไม่ได้ (ต้องให้สิทธิ์ GitHub App/Claude เข้า repo A หรือส่ง zip). ฟังก์ชันที่เห็นร่องรอยในข้อมูลแต่ **ยังไม่ได้ทำ**: แก้/ลบโน้ต (`แก้บันทึก`, `ลบ`), ช่องเวลาในงานติดตาม, แท็บ "นัดลูกค้า/รอบลูกค้า/หยุดซื้อ" แบบ ART, ข้อมูลรูปเพิ่ม (width/height/bytes), รหัสตรวจ `PRODUCT_NAME_NOT_EXACT_MATCH`/`PRODUCT_NO_DIRECT_BILL_CODE`, กราฟแท่งยอดขาย (สเปกเดิมห้ามกราฟ — ถามเจ้าของ)
2. **Deploy + ต่อชีตจริง** — ทำตาม `docs/DEPLOY.md`: Google service account (แชร์ชีตเป็น Editor), OAuth Client ID, `wrangler secret put GOOGLE_SA_EMAIL/GOOGLE_SA_KEY`, ตั้ง workers.dev subdomain = `havan-crm`, `GOOGLE_CLIENT_ID`/`DRIVE_FOLDER_ID` ใน `wrangler.jsonc`. ครั้งแรกบน Preview: กด "ตรวจโครงสร้าง 18 แท็บ" แล้วบันทึกโน้ต 1 รายการ ตรวจว่าแถวลงคอลัมน์ถูก
3. ยืนยันเกณฑ์ `soonDays/minCycleBills/newDays` + สูตรรอบซื้อ กับเจ้าของ/aCRM
4. รูปถ่าย → Google Drive ต้องใช้ **Shared Drive** (service account ไม่มีโควตา) ยังทดสอบเฉพาะโหมดจำลอง
5. ทดสอบบนมือถือจริง (GPS/กล้อง/โหลดหน้า) และวัด CPU 10 ms ของ Free plan บน Cloudflare จริง (ออกแบบให้ pass-through ไม่ parse JSON ใน Worker)
6. เจ้าของกำลังแก้รหัสสินค้า — เสร็จแล้วให้ดูหน้า "ตรวจรหัสที่ไม่ตรงทะเบียน" ใหม่ และอัปเดต `public/data/units.json` ถ้ามีรหัสใหม่
7. `repo` ชื่อจริง `havancrm/havancrm-CRM` (ในสเปกเขียน `havancrm/CRM`)

## 10. ข้อควรระวัง / บทเรียน
- **ห้าม commit ข้อมูลจริง** (repo เป็น public): สำเนาชีต, ไฟล์ TTX, ไฟล์ราคา, ใบส่งสินค้าตัวอย่างจริง อยู่นอก repo. fixtures ใน repo เป็นข้อมูลสังเคราะห์
- ห้ามเขียน/ลบชีตจริงเพื่อทดสอบ. ทดสอบเขียนทำกับ MemoryStore หรือ Google API จำลอง (`test/unit/sheets.test.js`)
- `AUTH_MODE=dev` ถูกปฏิเสธอัตโนมัติเมื่อ `DATA_MODE=sheets` — ห้ามเอาออก
- Free plan: ≤50 subrequest/คำขอ → `/api/ops` รับ ≤4 คำสั่ง/ครั้ง; อ่านแท็บ ACCESS ครั้งเดียว/60 วิ
- ธีม: เจ้าของต้องการ **พื้นหลังขาว, ตัวอักษรเล็ก (14.5px), สีกรมท่าเรียบแบบ ART (ไม่ไล่สีสว่าง/ไม่เข้มทึบ)**; ปฏิทิน/หน้าจอให้เหมือน ART ที่คุ้นเคย
- เครื่องมือ session: ติดตั้งตัวสร้างอุโมงค์สาธารณะ (cloudflared) ถูกระบบความปลอดภัยปฏิเสธ — อย่าพยายามอีก. ลิงก์ claim ของ Preview ชั่วคราวเป็นความลับ ไม่ใส่ในเอกสาร
- บั๊กสำคัญที่เคยเจอ (มี regression test แล้ว): `flush()` คิวไม่ส่งงาน, ตัวจัดการคลิกซ้อน, เรนเดอร์ซ้ำล้างข้อความที่พิมพ์

## 11. เอกสารอื่นใน repo
- `docs/TESTS.md` รายการทดสอบทีละข้อ (หน่วย 67 · ข้อมูลจริง 5 · E2E 60) — สร้างด้วย `scripts/gen-tests-doc.py`
- `docs/USER-GUIDE.md` คู่มือใช้งานสำหรับเซลล์
- `docs/REPORT.md` ผลตรวจรับรอบ 2 ตามข้อ 1–12 · `docs/DEPLOY.md` ขั้นตอน Preview→Production · `README.md`

## 12. ระบบ บัญชี และลิงก์ — เชื่อมอะไรกับใคร
| รายการ | คืออะไร / ใช้ทำอะไร | บัญชี-เจ้าของ | ลิงก์ | สถานะ |
|---|---|---|---|---|
| GitHub repo ใหม่ | โค้ด CRM ใหม่ทั้งหมด | org `havancrm` (ต้องมีสิทธิ์ write; session นี้ push ผ่าน Claude GitHub App) | https://github.com/havancrm/havancrm-CRM (branch `claude/ecstatic-cannon-i4gapq`) | ใช้งานได้ ยังไม่ merge/ไม่มี PR |
| GitHub repo A | ต้นฉบับ aCRM/ART (อ้างอิงอ่านอย่างเดียว) | org `havancrm` | `havancrm/A` | **session นี้เข้าไม่ได้** ต้องให้สิทธิ์ก่อนเทียบฟังก์ชัน |
| Google Sheets CRM | ฐานข้อมูลเดียวของ CRM (18 แท็บ) ChatGPT เตรียมให้ | บัญชี Google เจ้าของระบบ (ดูแท็บ `ACCESS` แถวที่โน้ต "เจ้าของระบบ") | https://docs.google.com/spreadsheets/d/1KbM5G_-O24NfRfiAX9eBcp9KBg_GjGXd7aUCKVdfkHY/edit | มีอยู่แล้ว ห้ามสร้างใหม่/ห้ามล้าง |
| ART / aCRM production | แอปเดิมที่เซลล์ใช้อยู่ | Cloudflare account เดิมของบริษัท | https://acrm.havan-crm.workers.dev | **ห้ามแก้** |
| CRM ใหม่ (เป้าหมาย) | Worker ชื่อ `crm` บน Cloudflare Free | Cloudflare account เดียวกับ ART (workers.dev subdomain = `havan-crm`) | https://crm.havan-crm.workers.dev | **ยังไม่ deploy** |
| Cloudflare account | โฮสต์ Worker + static assets | ไม่ทราบชื่อบัญชีที่แน่ชัดจาก session นี้ — ตรวจที่ dash.cloudflare.com → Workers & Pages ว่า `acrm` อยู่บัญชีไหน | https://dash.cloudflare.com | ต้องมีสิทธิ์สร้าง API token / `wrangler login` |
| Google Cloud project | เปิด Sheets API + Drive API, Service Account, OAuth Client | **ยังไม่มี ต้องสร้าง** (ใช้บัญชี Google ของบริษัท) | https://console.cloud.google.com | ยังไม่ทำ |
| Service account | Worker อ่าน/เขียนชีตแทนผู้ใช้ | สร้างใน Google Cloud แล้วแชร์ชีตให้เป็น Editor | — | ยังไม่ทำ |
| OAuth Client ID (Web) | ให้ผู้ใช้ล็อกอินด้วย Google | Google Cloud project เดียวกัน | — | ยังไม่ทำ |
| แท็บ `ACCESS` | รายชื่ออีเมลที่ใช้แอปได้ (`active`, `role=admin`) | เจ้าของระบบแก้ในชีต | (ในชีตข้างบน) | มีอยู่ (6 แถว ทุกแถว admin) |
| โฟลเดอร์รูปถ่าย Drive | เก็บรูปหน้าร้าน/เข้าพบ (`DRIVE_FOLDER_ID`) | aCRM เดิมใช้โฟลเดอร์ของมัน (ดูไฟล์ HANDOFF-ACCOUNTS ใน Drive) | — | ต้องเป็น Shared Drive ถ้า service account อัปโหลด |
| Google Drive โฟลเดอร์ส่งต่องาน | เอกสารส่งต่อ (ไฟล์ .md) | บัญชีเจ้าของระบบ | โฟลเดอร์ "HAVAN CRM - Handoff (2026-11-27)" ใน Drive (ลิงก์อยู่ในไฟล์ HANDOFF-ACCOUNTS) | แชร์ให้ผู้มาต่อเอง |
| Preview ชั่วคราว | `wrangler deploy --temporary` ข้อมูลจำลอง | บัญชี Cloudflare ชั่วคราว (หมดอายุ ~1 ชม.) | — | หมดอายุแล้ว สร้างใหม่ได้ |

แผนผัง: **มือถือเซลล์ → Cloudflare Worker `crm` (ไฟล์แอป + /api) → Google Sheets API (ผ่าน service account) → ชีต CRM** ; ล็อกอินด้วย Google ID token → Worker ตรวจอีเมลกับแท็บ `ACCESS` ; รูปถ่าย → Worker → Google Drive API.

## 13. ขั้นตอนเชื่อมต่อละเอียด (ทำตามลำดับ)
**A. เตรียมเครื่องและโค้ด**
1. ขอสิทธิ์ write ที่ repo `havancrm-CRM` → `git clone https://github.com/havancrm/havancrm-CRM && cd havancrm-CRM && git checkout claude/ecstatic-cannon-i4gapq`
2. Node 22 → `npm install` → `npm test` ต้องผ่าน 67 ข้อ

**B. Google Cloud (บัญชี Google ของบริษัท)**
1. console.cloud.google.com → สร้างโปรเจกต์ใหม่ เช่น `havan-crm`
2. APIs & Services → Library → เปิดใช้ **Google Sheets API** และ **Google Drive API**
3. IAM & Admin → Service Accounts → Create service account (เช่น `crm-sheets`) ไม่ต้องกำหนดบทบาทใน project
4. เข้า service account นั้น → Keys → Add key → Create new key → JSON → ไฟล์นี้คือ **ความลับ** (เก็บในที่ปลอดภัย ห้าม commit/ห้ามส่งแชต) ในไฟล์มี `client_email` และ `private_key`
5. เปิดชีต CRM → Share → ใส่ `client_email` → สิทธิ์ **Editor** → ส่ง (ไม่ต้องแจ้งอีเมล)
6. APIs & Services → OAuth consent screen: ตั้งชื่อแอป, อีเมลซัพพอร์ต; ถ้าเป็นสถานะ Testing ต้องเพิ่มอีเมลผู้ใช้ทุกคนเป็น Test user (หรือ Publish)
7. APIs & Services → Credentials → Create credentials → **OAuth client ID** → Web application → Authorized JavaScript origins ใส่ `https://crm.havan-crm.workers.dev` (และ URL Preview / `http://localhost:8787` ถ้าจะทดสอบ login) → ได้ **Client ID** (ไม่ใช่ความลับ)

**C. รูปถ่าย (ไม่บังคับ)** สร้างโฟลเดอร์ใน **Shared Drive** → เพิ่ม service account เป็นสมาชิก (Content manager) → เอา ID จาก URL โฟลเดอร์ใส่ `DRIVE_FOLDER_ID` (Drive ส่วนตัวใช้ไม่ได้ เพราะ service account ไม่มีโควตา)

**D. Cloudflare (บัญชีที่โฮสต์ ART)**
1. `npx wrangler login` (หรือสร้าง API token สิทธิ์ Edit Cloudflare Workers แล้วตั้ง `CLOUDFLARE_API_TOKEN`)
2. dash.cloudflare.com → Workers & Pages → ตรวจว่า workers.dev subdomain คือ `havan-crm` (ART ใช้อยู่แล้ว) — **อย่าเปลี่ยน/อย่าแตะ Worker `acrm`**
3. แก้ `wrangler.jsonc` → `vars.GOOGLE_CLIENT_ID` (และ `DRIVE_FOLDER_ID` ถ้ามี) ; `SPREADSHEET_ID` ใส่ไว้แล้ว
4. ตั้ง secrets: `npx wrangler secret put GOOGLE_SA_EMAIL` (วาง `client_email`) และ `npx wrangler secret put GOOGLE_SA_KEY` (วาง `private_key` ทั้งก้อนรวม BEGIN/END; ที่เป็น `\n` วางตามที่เห็นได้ โค้ดแปลงให้)

**E. ทดสอบครั้งแรก (แนะนำให้ทำบนสำเนาชีตก่อน)** เพราะครั้งแรกที่ Worker เขียนชีตจริงยังไม่เคยลอง: ให้เจ้าของระบบ Drive → Make a copy ของชีต CRM → ใส่ ID ของสำเนาเป็น `SPREADSHEET_ID` ใน Preview (`npx wrangler deploy --name crm-preview --var SPREADSHEET_ID:<id สำเนา>`) → แชร์สำเนาให้ service account → ล็อกอิน → ทำเช็คลิสต์ใน `docs/DEPLOY.md` ข้อ 3 → ลบสำเนาทิ้งเมื่อเสร็จ (ต้องได้รับอนุญาตจากเจ้าของระบบก่อน เพราะเป็นการทำสำเนาฐาน)

**F. Deploy จริง** `npm run check` (ต้องผ่านทั้งหมด) → `npx wrangler deploy` (หรือ GitHub Actions → Deploy ต้องตั้ง repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) → เปิด `/api/health` เทียบเวอร์ชันกับหน้าตั้งค่า → ซิงก์และบัญชี → ตรวจโครงสร้าง 18 แท็บ

**G. หลัง deploy** ตั้งเตือน: Sheets API โควตา ~300 อ่าน/นาที, Worker Free 100,000 คำขอ/วัน; ถ้าล็อกอินไม่ผ่าน ตรวจ (1) Client ID ตรง (2) origin ตรง (3) อีเมลอยู่ใน ACCESS และ active=TRUE (4) ผู้ใช้เป็น Test user ถ้าแอปยัง Testing

## 14. ใครเก็บอะไร / ความลับ
- Service account key → เก็บเฉพาะใน `wrangler secret` (และที่เก็บความลับของบริษัท) ห้ามอยู่ใน repo/แชต/Drive สาธารณะ ; `.dev.vars` ถูก git ignore
- OAuth Client ID ไม่ใช่ความลับ (อยู่ใน `wrangler.jsonc` ได้)
- สิทธิ์ใช้แอป = แท็บ `ACCESS` ; สิทธิ์ admin = `role` เป็น `admin|owner|manager|แอดมิน|เจ้าของ|ผู้จัดการ`
- สิทธิ์ที่ผู้มาต่อควรได้: GitHub write (repo ใหม่) + read (repo A) · Editor บนชีต CRM (เฉพาะถ้าต้องดูข้อมูล) · สมาชิก Cloudflare account · เข้า Google Cloud project · เข้าโฟลเดอร์ Drive ส่งต่องาน

## 15. การตัดสินใจของเจ้าของระบบ (ห้ามย้อนโดยไม่ถาม)
พื้นหลังขาว + ตัวอักษรเล็ก 14.5px + หัวกรมท่าเรียบแบบ ART · ใบส่งสินค้าพิมพ์ช่อง "รหัสสินค้า" ตามต้นแบบ · ปฏิทิน: แบบเดือน = การ์ด 12 เดือนต่อปี, แบบวัน = ตารางวัน · ร้านใหม่ในภาคสนามต้องกันรหัสซ้ำและแยกร้านที่ยังไม่มีรหัสบัญชี · ลูกค้าใหม่แยก "ซื้อครั้งแรก" กับ "เพิ่มทะเบียน" · เกณฑ์รอบซื้อ/ห่างหาย/ขาดเข้าพบต้องอิงค่าเดิมของ aCRM (ที่มี: lateDays 90, dormDays 365, visitDef 30) · ใช้ Cloudflare Free เท่านั้น
