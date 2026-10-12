-- ============================================================================
-- Migration: ใบขอเบิกอัตโนมัติจาก Min/Max (Replenishment Request)
-- ปลอดภัยสำหรับรันซ้ำ (idempotent) - ใช้ IF NOT EXISTS เสมอ
-- วิธีใช้: mysql -u <user> -p <ชื่อฐานข้อมูล production> < db/migration_replenishment_requests.sql
-- แนะนำให้ Backup ฐานข้อมูลก่อนรันเสมอ
-- ============================================================================

CREATE TABLE IF NOT EXISTS replenishment_requests (
  request_id          INT AUTO_INCREMENT PRIMARY KEY,
  store_id            INT NOT NULL,               -- แผนก/Store ที่ขอเบิก
  status              ENUM('PENDING','FULFILLED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  remark              VARCHAR(255),
  cancel_reason       VARCHAR(255),
  fulfilled_transfer_id INT,                       -- ผูกกับ Transfer จริงที่เภสัชกรจัดให้ (หลังจัดแล้ว)
  fulfilled_by        INT,
  fulfilled_at        DATETIME,
  created_by          INT NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(store_id),
  FOREIGN KEY (fulfilled_transfer_id) REFERENCES transfers(transfer_id),
  FOREIGN KEY (fulfilled_by) REFERENCES users(user_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS replenishment_items (
  item_id             INT AUTO_INCREMENT PRIMARY KEY,
  request_id          INT NOT NULL,
  drug_id             INT NOT NULL,
  qty_on_hand_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0,  -- ยอดคงเหลือ ณ ตอนสร้างใบขอเบิก (อ้างอิงย้อนหลังได้)
  min_qty_snapshot    DECIMAL(12,2) NOT NULL DEFAULT 0,
  max_qty_snapshot    DECIMAL(12,2) NOT NULL DEFAULT 0,
  qty_requested       DECIMAL(12,2) NOT NULL,
  qty_fulfilled       DECIMAL(12,2),                       -- จำนวนที่จัดให้จริง (อาจน้อยกว่าที่ขอ ถ้า Main Pharmacy สต๊อกไม่พอ)
  FOREIGN KEY (request_id) REFERENCES replenishment_requests(request_id),
  FOREIGN KEY (drug_id) REFERENCES drug_master(drug_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
