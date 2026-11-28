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
