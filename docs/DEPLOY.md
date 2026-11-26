# ขั้นตอน Preview → Deploy (Cloudflare Free)

> สถานะ: **ยังไม่ได้ Deploy** — ต้องใช้บัญชี Cloudflare / Google Cloud ของเจ้าของระบบ (ผมไม่มีข้อมูลรับรองเหล่านี้ใน session นี้)

## 1) Google (ครั้งเดียว)
1. Google Cloud Console → สร้างโปรเจกต์ → เปิดใช้ **Google Sheets API** และ **Google Drive API**
2. สร้าง **Service Account** → สร้าง JSON key → เก็บ `client_email` และ `private_key`
3. เปิดชีต CRM → **Share** ให้ `client_email` เป็น **Editor**
4. รูปถ่าย (ไม่บังคับ): สร้างโฟลเดอร์ใน **Shared Drive** แล้วเพิ่ม service account เป็นสมาชิก (Content manager) — ใช้ My Drive ปกติจะอัปโหลดไม่ได้เพราะ service account ไม่มีโควตาเก็บไฟล์. เอา ID โฟลเดอร์ไปใส่ `DRIVE_FOLDER_ID`
5. APIs & Services → Credentials → **OAuth client ID (Web)** → Authorized JavaScript origins: `https://crm.havan-crm.workers.dev` (และ URL preview ถ้าจะทดสอบ login) → เอา Client ID ไปใส่ `GOOGLE_CLIENT_ID`
6. ตรวจแท็บ `ACCESS`: อีเมลที่ใช้ได้ต้อง `active=TRUE`; `role=admin` เห็นการตั้งค่า/นำเข้า/แก้ป้ายกำกับ

## 2) Cloudflare
```bash
npx wrangler login                       # หรือตั้ง CLOUDFLARE_API_TOKEN
# แก้ GOOGLE_CLIENT_ID / DRIVE_FOLDER_ID ใน wrangler.jsonc (vars) แล้ว:
npx wrangler secret put GOOGLE_SA_EMAIL  # วาง client_email
npx wrangler secret put GOOGLE_SA_KEY    # วาง private_key ทั้งก้อน (รวม BEGIN/END)
```
Worker ชื่อ `crm` → URL `crm.<subdomain-ของบัญชี>.workers.dev` ต้องตั้ง workers.dev subdomain ของบัญชีเป็น `havan-crm` จึงจะได้ `crm.havan-crm.workers.dev`

## 3) Preview ก่อนใช้งานจริง
```bash
npm run check            # stamp version + unit + e2e ต้องผ่านทั้งหมด
npx wrangler versions upload     # ได้ Preview URL ของเวอร์ชันนี้ (ยังไม่แทน production)
```
เปิด Preview URL บนมือถือจริง แล้วทำรายการตรวจรับด้านล่างกับ **บัญชีผู้ดูแล**:
- [ ] ตั้งค่า → ซิงก์และบัญชี → "ตรวจโครงสร้างฐานข้อมูล 18 แท็บ" = ตรง 178 คอลัมน์
- [ ] ตั้งค่า → ตรวจคุณภาพข้อมูล: จำนวน ลูกค้า 1,383 / บิล 9,922 / รายการ 30,811 / สินค้า 366 = "ตรง"
- [ ] รายงานยอดขาย "ทั้งหมด" = ผลรวม `bill_items.amount` (เทียบสูตร `=SUM(bill_items!G:G)` ในชีตที่สำเนาไว้ ห้ามเพิ่มสูตรลงชีตจริง)
- [ ] บันทึกเข้าพบ 1 รายการ → แถวใหม่ใน `visits`/`activities`/`gps`; ตรวจว่าไม่ซ้ำเมื่อกดซ้ำ/ออฟไลน์แล้วออนไลน์
- [ ] สร้างออเดอร์ร่าง → ยืนยัน → `orders`/`order_items`
- [ ] (ถ้าเปิดรูป) ถ่ายรูปหน้าร้าน → ไฟล์ขึ้น Shared Drive และ `storePhotoFileIds` ถูกเติม

## 4) Deploy จริง
```bash
npx wrangler deploy
```
หรือใช้ GitHub Actions → **Deploy** → target = production (ต้องตั้ง secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)

## 5) Cache / Version
- `npm run stamp` ฝังเวอร์ชันเดียวกันใน `public/js/version.js`, `public/sw.js`, `?v=` ของ `index.html`, และ `/api/health`
- service worker ใช้ชื่อแคช `havan-crm-<version>`; เวอร์ชันใหม่จะลบแคชเก่าเอง
- ตรวจหลัง deploy: เปิด `/api/health` เทียบกับ ตั้งค่า → ซิงก์และบัญชี (เวอร์ชันแอป = เวอร์ชันเซิร์ฟเวอร์)

## ข้อจำกัดของ Free plan ที่ต้องเฝ้าดู
- CPU 10 ms/คำขอ: การโหลดข้อมูลใช้ **pass-through ของ Google response โดยไม่ parse** (คำนวณทั้งหมดในแอป) เพื่อประหยัด CPU — ยังไม่ได้วัดบน Cloudflare จริง ถ้าเกินให้ดู `wrangler tail`
- Sheets API: ~300 อ่าน/นาที/โปรเจกต์ (แต่ละการบันทึกอ่านคอลัมน์ `opId` เพื่อกันซ้ำ)
- Worker 100,000 คำขอ/วัน
