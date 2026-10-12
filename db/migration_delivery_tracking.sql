-- ============================================================================
-- Migration: ระบบติดตามการส่งยาไปคลินิก (Delivery Tracking)
-- ปลอดภัยสำหรับรันซ้ำ (idempotent) - ใช้ IF NOT EXISTS / เช็คก่อนแก้ไข ENUM เสมอ
-- วิธีใช้: mysql -u <user> -p <ชื่อฐานข้อมูล production> < db/migration_delivery_tracking.sql
-- แนะนำให้ Backup ฐานข้อมูลก่อนรันเสมอ (mysqldump)
-- ============================================================================

-- 1) เพิ่มประเภท Store ใหม่ 'EXTERNAL_CLINIC' สำหรับคลินิกภายนอกที่รับยาจากเรา
--    (คลินิกจะถูกเก็บเป็นแถวหนึ่งในตาราง stores เดิม เพื่อให้ใช้ระบบ Transfer เดิมได้ทันที
--     ไม่ต้องสร้างระบบรับ-จ่ายสต๊อกคู่ขนานใหม่)
ALTER TABLE stores
  MODIFY COLUMN store_type ENUM('MAIN_PHARMACY','FLOOR_STOCK','EMERGENCY_BAG','SUB_STORE','EXTERNAL_CLINIC') NOT NULL;

-- 2) ข้อมูลเสริมเฉพาะคลินิก (ที่อยู่ พิกัด ระยะทางโดยประมาณ ความเร็วเฉลี่ยที่ใช้คำนวณ ETA)
CREATE TABLE IF NOT EXISTS clinic_details (
  store_id       INT PRIMARY KEY,
  address        VARCHAR(255),
  contact_phone  VARCHAR(30),
  lat            DECIMAL(10,7),
  lng            DECIMAL(10,7),
  distance_km    DECIMAL(6,2),               -- ระยะทางโดยประมาณจาก Main Pharmacy (ใช้เป็นค่าเริ่มต้นก่อนเริ่มเดินทางจริง)
  avg_speed_kmh  DECIMAL(5,2) NOT NULL DEFAULT 40,  -- ความเร็วเฉลี่ยโดยประมาณ ใช้คำนวณ ETA (ปรับได้ต่อคลินิก)
  FOREIGN KEY (store_id) REFERENCES stores(store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) รอบการส่งยา (Delivery Trip) ผูกกับ Transfer เดิม 1 ต่อ 1
CREATE TABLE IF NOT EXISTS delivery_trips (
  trip_id           INT AUTO_INCREMENT PRIMARY KEY,
  transfer_id       INT NOT NULL,
  driver_user_id    INT NOT NULL,
  vehicle_info      VARCHAR(100),
  tracking_token    CHAR(32) NOT NULL UNIQUE,  -- ใช้เป็นลิงก์ติดตามสาธารณะ /track/:token (ไม่ต้อง login)
  status            ENUM('PENDING','DEPARTED','ARRIVED','DELIVERED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  avg_speed_kmh     DECIMAL(5,2),               -- override เฉพาะรอบนี้ (ถ้าไม่ระบุ ใช้ค่า default ของคลินิก)
  distance_km       DECIMAL(6,2),               -- snapshot ระยะทางตอนสร้างรอบ (ใช้ก่อนมี GPS จริง)
  departed_at       DATETIME,
  arrived_at        DATETIME,
  delivered_at      DATETIME,
  received_by_name  VARCHAR(100),               -- ชื่อผู้รับที่ปลายทางกรอกตอนกดยืนยัน (ฟรีเท็กซ์)
  last_lat          DECIMAL(10,7),
  last_lng          DECIMAL(10,7),
  last_position_at  DATETIME,
  cancel_reason     VARCHAR(255),
  created_by        INT NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transfer_id) REFERENCES transfers(transfer_id),
  FOREIGN KEY (driver_user_id) REFERENCES users(user_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) ประวัติพิกัด GPS ระหว่างทาง (ใช้วาดเส้นทางที่ผ่านมาบนแผนที่)
CREATE TABLE IF NOT EXISTS delivery_positions (
  position_id  BIGINT AUTO_INCREMENT PRIMARY KEY,
  trip_id      INT NOT NULL,
  lat          DECIMAL(10,7) NOT NULL,
  lng          DECIMAL(10,7) NOT NULL,
  recorded_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES delivery_trips(trip_id),
  INDEX idx_trip_time (trip_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
