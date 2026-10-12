-- ============================================================
-- Pharmacy Inventory / Floor Stock & Emergency Bag System
-- MySQL / MariaDB Schema
-- แผนกเภสัชกรรม - Occhealth_BRH
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- 1. Roles & Users
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  role_id       INT AUTO_INCREMENT PRIMARY KEY,
  role_code     VARCHAR(30) NOT NULL UNIQUE,   -- STORE_USER, PHARMACY_ADMIN
  role_name     VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  email         VARCHAR(150),
  role_id       INT NOT NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 2. Stores (Main Pharmacy, Floor Stock, Emergency Bag)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
  store_id      INT AUTO_INCREMENT PRIMARY KEY,
  store_code    VARCHAR(30) NOT NULL UNIQUE,
  store_name    VARCHAR(150) NOT NULL,
  store_type    ENUM('MAIN_PHARMACY','FLOOR_STOCK','EMERGENCY_BAG','SUB_STORE','EXTERNAL_CLINIC') NOT NULL,
  location      VARCHAR(200),
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Many-to-many: which users can access which store(s)
CREATE TABLE IF NOT EXISTS user_store_access (
  user_id       INT NOT NULL,
  store_id      INT NOT NULL,
  can_issue     TINYINT(1) NOT NULL DEFAULT 1,
  can_receive   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, store_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 3. Drug Master
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drug_groups (
  drug_group_id INT AUTO_INCREMENT PRIMARY KEY,
  group_name    VARCHAR(150) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS drug_master (
  drug_id       INT AUTO_INCREMENT PRIMARY KEY,
  drug_code     VARCHAR(14) NOT NULL UNIQUE,   -- รหัสยา 14 หลัก (Arcus air)
  drug_name     VARCHAR(255) NOT NULL,
  strength_form VARCHAR(150),                  -- รูปแบบ/Strength เช่น 500 mg Tablet
  unit          VARCHAR(30) NOT NULL,          -- หน่วยนับ เช่น TAB, VIAL, AMP
  drug_group_id INT,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (drug_group_id) REFERENCES drug_groups(drug_group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-store Min/Max/Average usage configuration
CREATE TABLE IF NOT EXISTS store_drug_config (
  store_id      INT NOT NULL,
  drug_id       INT NOT NULL,
  min_qty       DECIMAL(12,2) NOT NULL DEFAULT 0,
  max_qty       DECIMAL(12,2) NOT NULL DEFAULT 0,
  avg_usage     DECIMAL(12,2) NOT NULL DEFAULT 0,   -- Average Usage (คำนวณ/กำหนดได้)
  PRIMARY KEY (store_id, drug_id),
  FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
  FOREIGN KEY (drug_id) REFERENCES drug_master(drug_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 4. Lots & Stock On-Hand (per store, per lot)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drug_lots (
  lot_id        INT AUTO_INCREMENT PRIMARY KEY,
  drug_id       INT NOT NULL,
  lot_no        VARCHAR(50) NOT NULL,
  expired_date  DATE NOT NULL,
  unit_cost     DECIMAL(12,4) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_drug_lot (drug_id, lot_no, expired_date),
  FOREIGN KEY (drug_id) REFERENCES drug_master(drug_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Current on-hand balance, per store / drug / lot (the "stock card")
CREATE TABLE IF NOT EXISTS store_stock (
  store_stock_id  INT AUTO_INCREMENT PRIMARY KEY,
  store_id        INT NOT NULL,
  drug_id         INT NOT NULL,
  lot_id          INT NOT NULL,
  qty_on_hand     DECIMAL(12,2) NOT NULL DEFAULT 0,
  source_store_id INT,                      -- แหล่งที่มา/Store ต้นทาง
  received_date   DATETIME,                 -- วันที่รับเข้า (ล่าสุด)
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_store_drug_lot (store_id, drug_id, lot_id),
  FOREIGN KEY (store_id) REFERENCES stores(store_id),
  FOREIGN KEY (drug_id) REFERENCES drug_master(drug_id),
  FOREIGN KEY (lot_id) REFERENCES drug_lots(lot_id),
  FOREIGN KEY (source_store_id) REFERENCES stores(store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 5. Transfers (Main Pharmacy -> Floor Stock / Sub Store)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfers (
  transfer_id    INT AUTO_INCREMENT PRIMARY KEY,
  transfer_no    VARCHAR(30) NOT NULL UNIQUE,
  from_store_id  INT NOT NULL,
  to_store_id    INT NOT NULL,
  status         ENUM('DRAFT','TRANSFER_PENDING','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  created_by     INT NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at        DATETIME NULL,
  received_by    INT NULL,
  received_at    DATETIME NULL,
  cancelled_by   INT NULL,
  cancelled_at   DATETIME NULL,
  remark         VARCHAR(255),
  FOREIGN KEY (from_store_id) REFERENCES stores(store_id),
  FOREIGN KEY (to_store_id) REFERENCES stores(store_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id),
  FOREIGN KEY (received_by) REFERENCES users(user_id),
  FOREIGN KEY (cancelled_by) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS transfer_items (
  transfer_item_id INT AUTO_INCREMENT PRIMARY KEY,
  transfer_id      INT NOT NULL,
  drug_id          INT NOT NULL,
  lot_no           VARCHAR(50) NOT NULL,
  expired_date     DATE NOT NULL,
  unit_cost        DECIMAL(12,4) NOT NULL DEFAULT 0,
  qty_transfer     DECIMAL(12,2) NOT NULL,
  qty_received     DECIMAL(12,2) NULL,       -- อาจต่างจาก qty_transfer หากรับไม่ครบ
  FOREIGN KEY (transfer_id) REFERENCES transfers(transfer_id) ON DELETE CASCADE,
  FOREIGN KEY (drug_id) REFERENCES drug_master(drug_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 6. Stock Transactions (ledger) - ใช้ทำ Stock Movement / Report
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transactions (
  transaction_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
  store_id         INT NOT NULL,
  drug_id          INT NOT NULL,
  lot_id           INT NOT NULL,
  transaction_type ENUM('RECEIVE','TRANSFER_OUT','TRANSFER_IN','ISSUE','ADJUSTMENT') NOT NULL,
  qty              DECIMAL(12,2) NOT NULL,     -- + เข้า / - ออก
  unit_cost        DECIMAL(12,4) NOT NULL DEFAULT 0,
  balance_after    DECIMAL(12,2) NOT NULL,
  ref_type         VARCHAR(30),                -- TRANSFER, ISSUE, ADJUSTMENT
  ref_id           INT,                        -- transfer_id หรืออื่นๆ
  user_id          INT NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(store_id),
  FOREIGN KEY (drug_id) REFERENCES drug_master(drug_id),
  FOREIGN KEY (lot_id) REFERENCES drug_lots(lot_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  INDEX idx_store_date (store_id, created_at),
  INDEX idx_drug_date (drug_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 7. Audit Trail
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT,
  username      VARCHAR(50),
  action        VARCHAR(50) NOT NULL,        -- LOGIN, CREATE_TRANSFER, RECEIVE, ISSUE, CANCEL, ...
  entity_type   VARCHAR(50),
  entity_id     INT,
  store_id      INT,
  detail        JSON,
  ip_address    VARCHAR(50),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_date (created_at),
  INDEX idx_audit_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 8. Alert configuration (threshold days for near-expiry)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key   VARCHAR(50) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 8. ระบบติดตามการส่งยาไปคลินิก (Delivery Tracking)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic_details (
  store_id       INT PRIMARY KEY,
  address        VARCHAR(255),
  contact_phone  VARCHAR(30),
  lat            DECIMAL(10,7),
  lng            DECIMAL(10,7),
  distance_km    DECIMAL(6,2),
  avg_speed_kmh  DECIMAL(5,2) NOT NULL DEFAULT 40,
  FOREIGN KEY (store_id) REFERENCES stores(store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS delivery_trips (
  trip_id           INT AUTO_INCREMENT PRIMARY KEY,
  transfer_id       INT NOT NULL,
  driver_user_id    INT NOT NULL,
  vehicle_info      VARCHAR(100),
  tracking_token    CHAR(32) NOT NULL UNIQUE,
  status            ENUM('PENDING','DEPARTED','ARRIVED','DELIVERED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  avg_speed_kmh     DECIMAL(5,2),
  distance_km       DECIMAL(6,2),
  departed_at       DATETIME,
  arrived_at        DATETIME,
  delivered_at      DATETIME,
  received_by_name  VARCHAR(100),
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

CREATE TABLE IF NOT EXISTS delivery_positions (
  position_id  BIGINT AUTO_INCREMENT PRIMARY KEY,
  trip_id      INT NOT NULL,
  lat          DECIMAL(10,7) NOT NULL,
  lng          DECIMAL(10,7) NOT NULL,
  recorded_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES delivery_trips(trip_id),
  INDEX idx_trip_time (trip_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 9. ใบขอเบิกอัตโนมัติจาก Min/Max (Replenishment Request)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS replenishment_requests (
  request_id          INT AUTO_INCREMENT PRIMARY KEY,
  store_id            INT NOT NULL,
  status              ENUM('PENDING','FULFILLED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  remark              VARCHAR(255),
  cancel_reason       VARCHAR(255),
  fulfilled_transfer_id INT,
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
  qty_on_hand_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0,
  min_qty_snapshot    DECIMAL(12,2) NOT NULL DEFAULT 0,
  max_qty_snapshot    DECIMAL(12,2) NOT NULL DEFAULT 0,
  qty_requested       DECIMAL(12,2) NOT NULL,
  qty_fulfilled       DECIMAL(12,2),
  FOREIGN KEY (request_id) REFERENCES replenishment_requests(request_id),
  FOREIGN KEY (drug_id) REFERENCES drug_master(drug_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- 10. นับสต๊อกจริง (Cycle Count / Stock Take)
-- ------------------------------------------------------------
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
  system_qty      DECIMAL(12,2) NOT NULL,
  counted_qty     DECIMAL(12,2),
  variance_reason ENUM('MISSING','MISCOUNT','DAMAGED_EXPIRED','OTHER'),
  note            VARCHAR(255),
  FOREIGN KEY (count_id) REFERENCES cycle_counts(count_id),
  FOREIGN KEY (drug_id) REFERENCES drug_master(drug_id),
  FOREIGN KEY (lot_id) REFERENCES drug_lots(lot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
