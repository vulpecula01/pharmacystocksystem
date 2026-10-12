-- ============================================================================
-- Migration: นับสต๊อกจริง (Cycle Count / Stock Take)
-- ปลอดภัยสำหรับรันซ้ำ (idempotent) - ใช้ IF NOT EXISTS เสมอ
-- วิธีใช้: mysql -u <user> -p <ชื่อฐานข้อมูล production> < db/migration_cycle_count.sql
-- แนะนำให้ Backup ฐานข้อมูลก่อนรันเสมอ
-- ============================================================================

CREATE TABLE IF NOT EXISTS cycle_counts (
  count_id      INT AUTO_INCREMENT PRIMARY KEY,
  store_id      INT NOT NULL,
  status        ENUM('DRAFT','SUBMITTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  remark        VARCHAR(255),
  created_by    INT NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_by  INT,
  submitted_at  DATETIME,
  FOREIGN KEY (store_id) REFERENCES stores(store_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id),
  FOREIGN KEY (submitted_by) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cycle_count_items (
  item_id         INT AUTO_INCREMENT PRIMARY KEY,
  count_id        INT NOT NULL,
  drug_id         INT NOT NULL,
  lot_id          INT NOT NULL,
  system_qty      DECIMAL(12,2) NOT NULL,        -- ยอดคงเหลือในระบบ ณ ตอนเริ่มนับ (snapshot)
  counted_qty     DECIMAL(12,2),                  -- ยอดที่นับได้จริง (NULL = ยังไม่ได้นับ)
  variance_reason ENUM('MISSING','MISCOUNT','DAMAGED_EXPIRED','OTHER'),
  note            VARCHAR(255),
  FOREIGN KEY (count_id) REFERENCES cycle_counts(count_id),
  FOREIGN KEY (drug_id) REFERENCES drug_master(drug_id),
  FOREIGN KEY (lot_id) REFERENCES drug_lots(lot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
