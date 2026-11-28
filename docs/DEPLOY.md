# เตรียม Preview และเปิดใช้งาน HAVAN CRM

ปลายทางคือ Worker `crm` ในบัญชี Cloudflare `23283e64a0ba58956dcd51b07ce19753` บน Workers Free และใช้ชีต `CRM` ที่กำหนดใน `wrangler.jsonc`

## เตรียม Google Login และการเข้าถึงชีต

1. ใช้ Google Cloud project ของ HAVAN และเปิด Google Sheets API เปิด Google Drive API ถ้าจะใช้รูปหน้าร้าน
2. ตั้ง OAuth Web Client และเพิ่ม Authorized JavaScript origins สำหรับ `https://crm.havan-crm.workers.dev` และ URL ของ Preview ที่จะทดสอบ นำ Client ID ไปตั้งในตัวแปร `GOOGLE_CLIENT_ID` ของ Worker CRM
3. ให้ service account ของ CRM มีสิทธิ์ Editor ในชีต `CRM` เก็บอีเมลและคีย์ไว้ใน Worker bindings ชื่อ `GOOGLE_SA_EMAIL` และ `GOOGLE_SA_KEY` แบบ Secret
4. ตั้ง `DRIVE_FOLDER_ID` เป็น ID โฟลเดอร์ใน Shared Drive ที่ service account บันทึกไฟล์ได้ เพื่อเปิดใช้รูปถ่าย ถ้ายังไม่ได้ตั้งค่า แอปจะแจ้งในรายการซิงก์ว่ารูปยังส่งไม่สำเร็จ
5. ตรวจบัญชีผู้รับงานในแท็บ `ACCESS` ให้เป็นบัญชีที่เปิดใช้จริง ตรวจสิทธิ์ผู้ดูแลจากคอลัมน์ `role`

## ตรวจและขึ้น Preview

```sh
npm ci
npx playwright install --with-deps chromium
npm run check
npm run deploy -- --dry-run
npm run preview
```

ใช้ Version URL ที่ Wrangler คืนให้จากคำสั่ง Preview ตรวจการเข้าสู่ระบบบนมือถือจริง สถานะ `sheets/google` ที่ `/api/health` และเวอร์ชันเดียวกับหน้าตั้งค่า ตรวจหัวคอลัมน์ 18 แท็บ และเทียบยอดขายอย่างน้อยทั้งเดือนปัจจุบันและทั้งหมดกับผลรวมรายการในบิล

Version URL ใช้การเชื่อมต่อฐานที่กำหนดใน Worker เวอร์ชันนั้น หากชี้ชีตจริง ให้ตรวจแบบอ่านอย่างเดียวจนกว่าจะมีรายการงานจริงที่อนุมัติให้ใช้ตรวจรับการบันทึก ทดสอบเขียนอัตโนมัติด้วยหน่วยความจำหรือสำเนาข้อมูลแยกจากชีตจริง

## เปิด Production หลังผ่านการตรวจรับ

ใช้ Workers Free และตั้งให้เวอร์ชันที่ผ่าน Preview รับทราฟฟิกทั้งหมดของ Worker `crm` ตรวจซ้ำที่ [HAVAN CRM](https://crm.havan-crm.workers.dev) และ `/api/health` ตรวจ Google Login, การอ่านชีต CRM, การส่งงาน และยอดขาย พร้อมบันทึก commit SHA, app version และ Cloudflare version ID

GitHub Actions `Deploy` เป็น workflow แบบสั่งด้วยตนเองและต้องมีสิทธิ์ Cloudflare ที่ตั้งค่าไว้ใน repository ก่อนใช้งาน ตัว build จะ stamp เวอร์ชันจาก SHA ของ source checkout เดียวกันลงใน HTML, service worker และ `/api/health`

## ใช้ Apps Script แทนการตั้งค่า Google Cloud Console

ใช้สคริปต์ใน `integrations/apps-script` สองโปรเจกต์แยกกันเพื่อจำกัดขอบเขตสิทธิ์

- `login.gs` เป็น Web App ที่ทำงานเป็นผู้เข้าถึงและเปิดเฉพาะบัญชี Google ใช้ `login-manifest.json` เป็น `appsscript.json` มี Script Property `CRM_LOGIN_SECRET` ตัว Worker ตรวจลายเซ็น ระยะเวลา โดเมน และอีเมลในแท็บ `ACCESS` ก่อนแสดงข้อมูล
- `bridge.gs` เป็น Web App ที่ทำงานเป็นเจ้าของชีต มี Script Property `CRM_BRIDGE_SECRET` คนละค่ากับของระบบล็อกอิน ใช้ `bridge-manifest.json` เป็น `appsscript.json` เพื่อเปิด Sheets และ Drive API ในโปรเจกต์เริ่มต้น URL นี้รับเฉพาะคำขอที่ลงลายเซ็นและจำกัดการเข้าถึง Sheets ที่ชีต CRM เดิม สำหรับรูปถ่ายจะสร้างโฟลเดอร์ HAVAN CRM Photos เมื่อบันทึกรูปแรก สิทธิ์ `drive.file` ครอบคลุมไฟล์ที่แอปสร้างหรือที่ผู้ใช้เปิดให้แอปเข้าถึง รูปที่สร้างจากระบบเดิมต้องตรวจสิทธิ์ก่อนเปิดใช้จริง

ตั้ง `AUTH_MODE=apps_script`, `DATA_MODE=apps_script`, `CRM_LOGIN_URL` และ `CRM_BRIDGE_URL` ใน Worker ตั้ง `CRM_LOGIN_SECRET` และ `CRM_BRIDGE_SECRET` เป็น Secret ของ Worker ค่า Secret ต้องตรงกับ Script Property ของ Web App แต่ละตัว

เก็บ Production ปิดไว้จนยืนยันการเข้าสู่ระบบด้วยบัญชีที่มีสิทธิ์และไม่มีสิทธิ์ อ่านหัวตารางจริง 18 แท็บ และทดสอบซิงก์ด้วยรายการที่เจ้าของอนุมัติให้ใช้ตรวจรับ
