# ระบบ Inventory ยา/เวชภัณฑ์ (Floor Stock & Emergency Bag)
Occhealth_BRH — แผนกเภสัชกรรม

ระบบบริหารจัดการ Stock ยา รองรับ Main Pharmacy, Floor Stock และกระเป๋า Emergency
ใช้งานภายในองค์กรผ่านเครือข่าย LAN, ฐานข้อมูล MySQL/MariaDB

## คุณสมบัติหลัก

- รับยาเข้า Stock ใหม่ (เช่น รับจาก Supplier) โดยตรงที่หน้า Stock ไม่ต้องผ่าน Transfer — เว้น Lot No. ว่างได้ ระบบ gen ให้อัตโนมัติ
- ตัดจ่ายแบบ FEFO อัตโนมัติ (First Expired, First Out): พิมพ์แค่ยา+จำนวนรวม ระบบไล่ตัดจาก Lot ใกล้หมดอายุที่สุดก่อนเอง ข้าม Lot ให้เองถ้า Lot เดียวไม่พอ
- Transfer ยาจากห้องยาหลักไปยัง Floor Stock/Store ย่อย พร้อมสถานะ Draft / Transfer Pending / Received / Cancelled — เลือก Lot จาก Stock จริงของ Store ต้นทางเสมอ (ไม่ใช่พิมพ์เอง) ป้องกัน error "สต๊อกไม่พอ" ที่เกิดจากพิมพ์ Lot/Expired ไม่ตรงของเดิม
- Generate & Scan QR Code (รหัสยา 14 หลัก ตามระบบ Arcus air) เพื่อรับ/จ่าย/ตรวจสอบ Lot-Expired
- ติดตาม Lot Number, Expired Date, ราคาต้นทุน, แหล่งที่มาของสินค้าในทุก Store
- แจ้งเตือน Near Expired / Expired / Stock ต่ำกว่า Min / สูงกว่า Max
- ตัดจ่ายสินค้าออกจาก Store พร้อมแสดงข้อมูลก่อนยืนยัน (ชื่อยา, Lot, Expired, คงเหลือ, คงเหลือหลังจ่าย)
- สิทธิ์ผู้ใช้แยกตาม Store (User เห็นเฉพาะ Store ตนเอง, Pharmacy Admin เห็นทุก Store)
- Audit Trail บันทึกทุกธุรกรรม (User, วันเวลา, รายการ, จำนวน, Lot, Store, ประเภท Transaction)
- รายงาน: รับเข้า/จ่ายออก/Transfer, Stock คงเหลือ, Stock แยกตาม Lot, Near Expiry/Expired, Stock Movement พร้อม Export Excel
- Pharmacy Admin Dashboard: มูลค่า Inventory รวม, จำนวนคงเหลือ, Near Expiry, Expired, Min/Max Stock, กราฟสรุป

## สถาปัตยกรรมระบบ

- **Backend:** Node.js + Express
- **Database:** MySQL 8 / MariaDB 10.11+ (ใช้ `mysql2` driver)
- **Frontend:** Server-rendered EJS + Bootstrap 5 + Vanilla JS (fetch API)
- **QR/Barcode:** `qrcode` (generate), `html5-qrcode` (scan ผ่านกล้องมือถือ/แท็บเล็ต)
- **Report Export:** `exceljs`
- **Session:** เก็บใน MySQL (`express-mysql-session`) รองรับหลาย process/Load Balancer

โครงสร้างโฟลเดอร์:
```
pharmacy-stock-system/
├── server.js                 จุดเริ่มต้นแอปพลิเคชัน
├── db/
│   ├── schema.sql             โครงสร้างตาราง MySQL
│   ├── views.sql               View สำหรับรายงาน/แจ้งเตือน
│   └── seed.js                 สคริปต์สร้างข้อมูลตัวอย่าง
├── src/
│   ├── config/db.js            การเชื่อมต่อฐานข้อมูล
│   ├── middleware/auth.js      ตรวจสอบ Login/สิทธิ์ Store
│   ├── controllers/            Business logic แต่ละโมดูล
│   ├── routes/                 Express routes (หน้าเว็บ + REST API)
│   └── utils/                  ฟังก์ชันช่วยเหลือ (stock ledger, audit log)
├── views/                       หน้าเว็บ (EJS)
└── public/                      CSS/JS ฝั่ง client
```

## การติดตั้งใช้งานภายในองค์กร (LAN)

### 1. เตรียมเครื่องแม่ข่าย (Server)

- Node.js 18 ขึ้นไป (แนะนำ 20 LTS)
- MySQL 8.0 หรือ MariaDB 10.11 ขึ้นไป
- เปิดพอร์ตที่ใช้งาน (ค่าเริ่มต้น 3000) ให้เข้าถึงได้จากเครื่องในวง LAN

### 2. ติดตั้งฐานข้อมูล

```bash
mysql -u root -p -e "CREATE DATABASE pharmacy_stock CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p -e "CREATE USER 'pharmacy_app'@'%' IDENTIFIED BY 'รหัสผ่านที่ปลอดภัย'; GRANT ALL PRIVILEGES ON pharmacy_stock.* TO 'pharmacy_app'@'%'; FLUSH PRIVILEGES;"

mysql -u root -p pharmacy_stock < db/schema.sql
mysql -u root -p pharmacy_stock < db/views.sql
```

### 3. ติดตั้งแอปพลิเคชัน

```bash
npm install
```

## แยกชุด Production และ Test

ระบบรองรับการรันแยกกันระหว่างชุดใช้งานจริง (Production) และชุดทดสอบ (Test) โดยแต่ละชุดมีไฟล์ตั้งค่า พอร์ต และฐานข้อมูลเป็นของตัวเอง (ป้องกันข้อมูลทดสอบไปปนกับข้อมูลจริง) เลือกใช้แบบใดแบบหนึ่ง หรือจะรันพร้อมกันทั้งสองชุดบนเครื่องเดียวกันก็ได้ (คนละพอร์ต):

| | Production | Test |
|---|---|---|
| ไฟล์ตั้งค่า | `.env.production` (คัดลอกจาก `.env.production.example`) | `.env.test` (คัดลอกจาก `.env.test.example`) |
| พอร์ตเริ่มต้น | 6500 | 6501 |
| ฐานข้อมูลเริ่มต้น | `pharmacy_stock` | `pharmacy_stock_test` |
| คำสั่งสร้างฐานข้อมูล+ตาราง | `db/schema.sql`, `db/views.sql` เข้า `pharmacy_stock` | `db/schema.sql`, `db/views.sql` เข้า `pharmacy_stock_test` |
| คำสั่งสร้างข้อมูลตัวอย่าง | `npm run seed:prod` | `npm run seed:test` |
| คำสั่งรัน | `npm run start:prod` | `npm run start:test` |

ขั้นตอน:

```bash
# 1) เตรียมไฟล์ตั้งค่าแต่ละชุด
cp .env.production.example .env.production   # แก้ DB_PASSWORD, SESSION_SECRET ให้เป็นค่าจริง
cp .env.test.example .env.test               # แก้ DB_PASSWORD, SESSION_SECRET (คนละค่ากับ production)

# 2) สร้างฐานข้อมูลของแต่ละชุด (ทำครั้งเดียว)
mysql -u root -p -e "CREATE DATABASE pharmacy_stock CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p -e "CREATE DATABASE pharmacy_stock_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p -e "CREATE USER 'pharmacy_app'@'%' IDENTIFIED BY 'รหัสผ่านที่ปลอดภัย'; GRANT ALL PRIVILEGES ON pharmacy_stock.* TO 'pharmacy_app'@'%'; GRANT ALL PRIVILEGES ON pharmacy_stock_test.* TO 'pharmacy_app'@'%'; FLUSH PRIVILEGES;"

mysql -u root -p pharmacy_stock < db/schema.sql
mysql -u root -p pharmacy_stock < db/views.sql
mysql -u root -p pharmacy_stock_test < db/schema.sql
mysql -u root -p pharmacy_stock_test < db/views.sql

# 3) สร้างข้อมูลตัวอย่าง (แนะนำทำเฉพาะฝั่ง test เพื่อลองระบบ ส่วน production ควรใส่ข้อมูลจริงเอง)
npm run seed:test

# 4) รันระบบ
npm run start:test      # ทดสอบที่ http://localhost:6501
npm run start:prod      # ใช้งานจริงที่ http://<IP เครื่องแม่ข่าย>:6500
```

บัญชีทดสอบที่ได้จาก `npm run seed:test` (ฝั่ง test เท่านั้น):
- `superadmin` / `SuperAdmin@123` — Super Admin (สิทธิ์สูงสุด)
- `admin` / `Admin@123` — Pharmacy Admin (เห็นทุก Store)
- `main_user` / `User@123` — เจ้าหน้าที่ห้องยาหลัก
- `er_user` / `User@123` — เจ้าหน้าที่ Floor Stock ER
- `ipd1_user` / `User@123` — เจ้าหน้าที่ Floor Stock IPD1
- `emb01_user` / `User@123` — เจ้าหน้าที่กระเป๋า Emergency 01

**สำคัญ:** อย่ารัน `npm run seed:prod` บนฐานข้อมูลจริงที่มีข้อมูลอยู่แล้ว เพราะจะเป็นการเติมข้อมูลตัวอย่างปนเข้าไป ใช้คำสั่งนี้เฉพาะตอนเริ่มระบบใหม่ครั้งแรกเท่านั้น แล้วอย่าลืมเปลี่ยนรหัสผ่านผู้ใช้ทุกคนก่อนเปิดใช้งานจริง

## ระดับสิทธิ์ผู้ใช้ (Roles) และวิธีเพิ่ม User

ระบบมีสิทธิ์ 3 ระดับ:

| Role | ขอบเขต | ใครสร้างได้ |
|---|---|---|
| **Super Admin** | สิทธิ์สูงสุด เห็น/จัดการได้ทุก Store, ผู้เดียวที่มอบสิทธิ์ Admin/Super Admin ให้คนอื่นได้ | Super Admin เท่านั้น |
| **Pharmacy Admin** | จัดการ Store, Drug Master, Min/Max, Users, ดู Report ได้ทุก Store แต่**สร้างได้แค่ระดับ Store User** (ป้องกันการยกระดับสิทธิ์ตัวเอง) | Super Admin หรือ Pharmacy Admin |
| **Store User** | เห็น/ตัดจ่าย/รับของเฉพาะ Store ที่ตัวเองถูกผูกไว้เท่านั้น | Super Admin หรือ Pharmacy Admin |

**"Role ต่างกันตามแผนก" (เช่น Pharmacy Cath Lab, Pharmacy ICU) ไม่ใช่ Role แยก แต่คือการผูก User เข้ากับ Store คนละ Store กัน** — ระบบแยกสิทธิ์ตาม Store ที่ user เข้าถึงได้อยู่แล้ว ดังนั้นขั้นตอนคือ:

1. สร้าง **Store** สำหรับแต่ละแผนกก่อน (เมนู **Admin > Stores**) เช่น `Pharmacy - Cath Lab`, `Pharmacy - ICU`, `Pharmacy - ER` ระบุ `store_type` เป็น `FLOOR_STOCK` หรือ `EMERGENCY_BAG` ตามความเหมาะสม
2. ไปที่เมนู **Admin > Users** กรอกฟอร์ม "เพิ่ม User ใหม่":
   - Username / Password / ชื่อ-สกุล
   - เลือก **Role**: `Store User` สำหรับเจ้าหน้าที่ประจำแผนก, `Pharmacy Admin` สำหรับหัวหน้าเภสัชกรที่ต้องดูแลทุก Store, `Super Admin` (เห็นเฉพาะเมื่อ login ด้วย Super Admin) สำหรับผู้ดูแลระบบสูงสุดเท่านั้น
   - ติ๊กเลือก **Store ที่เข้าถึงได้** (เลือกได้หลาย Store ถ้า user คนนั้นต้องดูแลมากกว่า 1 แผนก) — ช่องนี้จะไม่มีผลถ้าเลือก Role เป็น Admin/Super Admin เพราะ Admin เห็นทุก Store อยู่แล้ว
   - กด "เพิ่ม User"
3. ตัวอย่าง: ต้องการ user ชื่อ "จนท. Cath Lab" ที่ดูแลเฉพาะ Store `Pharmacy - Cath Lab` → เลือก Role = `Store User`, ติ๊ก Store = `Pharmacy - Cath Lab` เท่านั้น

**ข้อควรระวังด้านความปลอดภัย:** ถ้า login ด้วยบัญชี Pharmacy Admin (ไม่ใช่ Super Admin) ระบบจะไม่แสดงตัวเลือก Role "Super Admin" ในฟอร์มให้เลย และฝั่ง Backend ก็ปฏิเสธคำขอสร้าง/แก้ไข user ให้เป็น Admin/Super Admin จากบัญชีที่ไม่ใช่ Super Admin โดยอัตโนมัติ (ทดสอบแล้วว่าได้ HTTP 403) เพื่อป้องกันไม่ให้ Pharmacy Admin ยกระดับสิทธิ์ตัวเองหรือคนอื่นได้

หมายเหตุ: ถ้าต้องการรันแบบไฟล์ `.env` เดี่ยวแบบเดิม (ไม่แยก prod/test) ยังใช้ได้ตามปกติ — คัดลอก `.env.example` เป็น `.env` แล้วรัน `npm start` เหมือนเดิม

### 6. รันแบบถาวร (แนะนำสำหรับ Production)

ใช้ [pm2](https://pm2.keymetrics.io/) เพื่อให้ระบบรันอัตโนมัติและ restart เมื่อเครื่อง reboot:

```bash
npm install -g pm2
pm2 start npm --name pharmacy-stock -- run start:prod
pm2 save
pm2 startup
```
(บน Windows ใช้ `pm2-windows-startup` แทน `pm2 startup` ตามที่แนะนำไว้ก่อนหน้า)

แนะนำให้ตั้ง Nginx หรือ IIS เป็น Reverse Proxy ด้านหน้า พร้อมออกใบรับรอง HTTPS ภายในองค์กร (Internal CA) เพื่อความปลอดภัยของรหัสผ่านและข้อมูลผู้ป่วย/ยา

## การตั้งค่าเริ่มต้นก่อนใช้งานจริง

1. เข้าสู่ระบบด้วยบัญชี Pharmacy Admin
2. เมนู **Admin > Stores**: เพิ่ม Store จริงทั้งหมด (Main Pharmacy, Floor Stock แต่ละหอผู้ป่วย, กระเป๋า Emergency แต่ละใบ)
3. เมนู **Admin > Drug Master**: นำเข้ารายการยาให้ตรงกับรหัสยา 14 หลักของ Arcus air (สามารถพิมพ์ QR Code จากหน้านี้เพื่อติดภาชนะ/ป้ายยาได้ทันที)
4. เมนู **Admin > Min/Max ต่อ Store**: กำหนดจุดสั่งซื้อขั้นต่ำ-สูงสุด และ Average Usage ต่อ Store
5. เมนู **Admin > Users**: สร้างบัญชีผู้ใช้จริงของแต่ละ Store และกำหนดสิทธิ์การเข้าถึง Store
6. รับสินค้าเริ่มต้น (Opening Stock) เข้า Main Pharmacy ผ่านหน้า **Stock > รับยาเข้า Stock** (ดูรายละเอียดหัวข้อถัดไป)

## รับยาเข้า / ตัดจ่าย FEFO / Transfer — วิธีใช้

### รับยาเข้า Stock ใหม่

หน้า **Stock / ตัดจ่าย** → ปุ่ม **"รับยาเข้า Stock"** ใช้สำหรับรับยาล็อตใหม่เข้า Store โดยตรง (เช่น รับจาก Supplier เข้า Main Pharmacy) โดยไม่ต้องสร้าง Transfer ปลอมจาก Main ไป Main เอง — กรอกยา, Expired Date, ราคาต้นทุน, จำนวน ส่วน **Lot No. เว้นว่างได้** ระบบจะ gen ให้อัตโนมัติในรูปแบบ `AUTO-{รหัสยา}-{วันที่}-{ลำดับ}`

### ตัดจ่ายแบบ FEFO อัตโนมัติ

หน้า **Stock / ตัดจ่าย** → ปุ่ม **"ตัดจ่าย FEFO"** ใช้เมื่อไม่สนใจว่าจะตัดจาก Lot ไหน (แนะนำสำหรับใช้งานประจำวัน) เลือกยา + ระบุจำนวนรวมที่ต้องการจ่าย ระบบจะไล่ตัดจาก **Lot ที่ใกล้หมดอายุที่สุดก่อนเสมอ** (First Expired, First Out) และข้ามไป Lot ถัดไปอัตโนมัติถ้า Lot เดียวไม่พอ พร้อมสรุปให้เห็นว่าตัดจาก Lot ไหนไปเท่าไหร่ ถ้าสต๊อกรวมทุก Lot ไม่พอ ระบบจะไม่ตัดอะไรเลยและแจ้ง error ทันที (ไม่มีการตัดค้างครึ่งๆ กลางๆ)

ส่วนปุ่ม **"ตัดจ่าย"** ที่แต่ละแถวในตาราง ยังใช้ได้ตามปกติสำหรับกรณีต้องการระบุ Lot เจาะจงเอง (เช่น มีใบสั่งยาระบุ Lot มาแล้ว)

### สร้าง Transfer

ตอนเลือกยาใส่ในรายการ Transfer ตอนนี้ระบบจะให้ **เลือก Lot จากรายการ Stock จริงของ Store ต้นทาง** (ไม่ใช่พิมพ์ Lot No./Expired Date เองแบบเดิม) — เพราะการพิมพ์เองแล้วพิมพ์ผิดแม้แต่นิดเดียว (เช่น รูปแบบวันที่ไม่ตรง) ระบบจะเข้าใจว่าเป็น Lot ใหม่ที่ยังไม่มี Stock เลย แล้วฟ้อง "สต๊อกไม่พอ" ทั้งที่จริงมีของอยู่ — วิธีใหม่นี้ป้องกันปัญหานี้ได้เบ็ดเสร็จเพราะดึงข้อมูล Lot มาจากฐานข้อมูลจริงเสมอ ต้องเลือก Store ต้นทางก่อนถึงจะค้นหายาได้ (ระบบจะค้นเฉพาะยาที่มี Stock ใน Store นั้นจริงๆ ให้ด้วย)

## หมายเหตุการออกแบบ

- **Alert แบบ Real-time query**: Near Expiry/Expired และ Min/Max ผ่าน SQL View (`db/views.sql`) คำนวณจากข้อมูลปัจจุบันทุกครั้งที่เรียกดู แม่นยำกว่าการเก็บสถานะ Alert แยกที่ต้องมี Background Job คอยอัปเดต
- **Stock Ledger**: ทุกการเคลื่อนไหวของ Stock (รับเข้า/จ่ายออก/Transfer/ปรับปรุง) บันทึกลงตาราง `stock_transactions` แบบ append-only เพื่อใช้เป็นที่มาของรายงาน Stock Movement และ Audit
- **Concurrency**: การตัด/เพิ่ม Stock ใช้ MySQL Transaction พร้อม `SELECT ... FOR UPDATE` ป้องกันข้อมูลไม่ตรงกันเมื่อมีผู้ใช้หลายคนทำรายการพร้อมกัน
- **รหัสยา 14 หลัก**: ฟิลด์ `drug_master.drug_code` รองรับสูงสุด 14 หลักตามมาตรฐาน Arcus air และใช้เป็นข้อมูลใน QR Code โดยตรง

## แผนต่อยอดที่แนะนำ (ยังไม่รวมในเวอร์ชันนี้)

- เชื่อมต่อ/นำเข้าข้อมูลรายการยาอัตโนมัติจากระบบ Arcus air ผ่าน API หรือไฟล์ Import
- แจ้งเตือนผ่าน LINE Notify/Email เมื่อพบ Near Expiry หรือ Stock ต่ำกว่า Min (ปัจจุบันดูผ่าน Dashboard)
- Export รายงานอื่นนอกจาก Stock Movement เป็น Excel (โครงสร้างโค้ดรองรับ ขยายเพิ่มเติมได้ง่ายใน `src/controllers/reportController.js`)
- ระบบสั่งซื้อ (Purchase Order) เชื่อมกับ Supplier ก่อนเข้า Main Pharmacy Stock
