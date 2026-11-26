# HAVAN CRM

CRM สำหรับเซลล์ภาคสนาม — Mobile First, ธีม Navy Blue Gradient, รันบน **Cloudflare Workers (Free)** และใช้ **Google Sheets CRM** เดิมเป็นฐานข้อมูลเดียว (ไม่สร้างฐานใหม่)

- เป้าหมาย URL: `https://crm.havan-crm.workers.dev`
- Spreadsheet: `1KbM5G_-O24NfRfiAX9eBcp9KBg_GjGXd7aUCKVdfkHY` (18 แท็บ / 178 คอลัมน์)
- โปรเจกต์นี้แยกจาก ART / aCRM เดิมทั้งหมด (ไม่แก้ repo A และระบบเดิม)

## โครงสร้าง

```
public/                 แอป (HTML/CSS/ES modules, ไม่มี build step) + sw.js + _headers (CSP)
  js/shared/            ตรรกะที่ใช้ร่วม client/server/test
    schema.js           18 แท็บ / 178 คอลัมน์ (อ่าน-เขียนตามชื่อ Header เท่านั้น)
    domain.js           ยอดขาย, รอบซื้อ, สถานะลูกค้า, ค้นหา, ทะเบียนสินค้า, ตรวจคุณภาพ
    ops.js              การกระทำของเซลล์ -> การเขียนแถว (idempotent ด้วย opId)
  js/pages/             หน้าจอทั้งหมด
src/server/             Worker: /api/* , Google Sheets adapter, auth (Google ID token + แท็บ ACCESS)
test/unit, test/e2e     ทดสอบหน่วย (Node) และ E2E (Chromium มือถือ + workerd)
docs/DEPLOY.md          ขั้นตอน Preview/Deploy      docs/REPORT.md  รายงานผลตรวจรับ
```

## หลักการข้อมูล

- ฐานเก็บข้อมูลดิบ; คำนวณทุกอย่างในแอป. ยอดขาย = `SUM(bill_items.amount)` ไม่บวก VAT ซ้ำ
- รหัสลูกค้า/สินค้าเป็นข้อความเสมอ (เช่น `8217*`, `00123`)
- เขียนซ้ำไม่ได้: ทุกการบันทึกมี `opId`; ส่งซ้ำ = `duplicate` ไม่เพิ่มแถว; นำเข้าไฟล์ซ้ำถูกปฏิเสธด้วย `fileHash`
- ไม่ลบข้อมูลจริง: ออเดอร์ที่ยกเลิกเปลี่ยนสถานะ ไม่ลบแถวหัวออเดอร์; ทุกการแก้ไขลงแท็บ `changes`
- ออฟไลน์ได้: งานภาคสนามเข้าคิวใน IndexedDB แล้วซิงก์เมื่อมีสัญญาณ

## คำสั่ง

```bash
npm install
npm test            # ทดสอบหน่วย (49)
npm run dev         # Preview ในเครื่อง: ข้อมูลจำลองในหน่วยความจำ ไม่แตะชีตจริง  http://localhost:8787
npm run test:e2e    # E2E บน Chromium มือถือ (53 ขั้นตอน)
npm run check       # stamp version + unit + e2e
```
