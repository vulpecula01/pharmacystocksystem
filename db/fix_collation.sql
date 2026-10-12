-- ============================================================
-- แก้ปัญหา "Illegal mix of collations" โดยบังคับให้ทุกตาราง
-- และตัวฐานข้อมูล ใช้ utf8mb4_unicode_ci เหมือนกันทั้งหมด
-- รันสคริปต์นี้ใน MySQL Workbench โดยเลือก schema pharmacy_stock เป็น default ก่อน
-- ============================================================

ALTER DATABASE pharmacy_stock CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE roles               CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE users                CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE stores               CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE user_store_access    CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE drug_groups          CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE drug_master          CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE store_drug_config    CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE drug_lots            CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE store_stock          CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE transfers            CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE transfer_items       CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE stock_transactions   CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE audit_log            CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE system_settings      CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- หลังรันสคริปต์นี้เสร็จ ให้เปิดไฟล์ db/views.sql แล้ว Execute ซ้ำอีกครั้ง
-- (File > Open SQL Script เลือก views.sql แล้วกด Execute ทั้งไฟล์)
-- เพื่อให้ View ถูกสร้างใหม่จากตารางที่ collation ตรงกันแล้ว
