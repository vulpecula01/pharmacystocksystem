-- ============================================================
-- Reporting Views
-- ============================================================

-- รายการยาแยกตาม Store พร้อม Lot / Expiry / Min-Max / มูลค่า
CREATE OR REPLACE VIEW v_store_stock_detail AS
SELECT
  ss.store_stock_id,
  s.store_id, s.store_code, s.store_name, s.store_type,
  d.drug_id, d.drug_code, d.drug_name, d.strength_form, d.unit,
  dg.group_name,
  l.lot_id, l.lot_no, l.expired_date, l.unit_cost,
  ss.qty_on_hand,
  ROUND(ss.qty_on_hand * l.unit_cost, 2) AS stock_value,
  ss.received_date,
  src.store_name AS source_store_name,
  cfg.min_qty, cfg.max_qty, cfg.avg_usage,
  DATEDIFF(l.expired_date, CURDATE()) AS days_to_expire
FROM store_stock ss
JOIN stores s        ON s.store_id = ss.store_id
JOIN drug_master d    ON d.drug_id = ss.drug_id
LEFT JOIN drug_groups dg ON dg.drug_group_id = d.drug_group_id
JOIN drug_lots l      ON l.lot_id = ss.lot_id
LEFT JOIN stores src  ON src.store_id = ss.source_store_id
LEFT JOIN store_drug_config cfg ON cfg.store_id = ss.store_id AND cfg.drug_id = ss.drug_id
WHERE ss.qty_on_hand > 0;

-- ยา Near Expired (ภายใน 90 วัน) และ Expired
-- หมายเหตุ: ใช้ _utf8mb4'...' (character set introducer) ร่วมกับ COLLATE บังคับทั้ง charset
-- และ collation ของ literal ใน CASE ตรงๆ เพื่อไม่ให้ผลลัพธ์ของ view ขึ้นกับ session ที่สร้าง
-- (ถ้าใส่แค่ COLLATE เฉยๆ โดย session ตอนสร้าง view มี default charset เป็น utf8/utf8mb3
--  จะ error "COLLATION 'utf8mb4_unicode_ci' is not valid for CHARACTER SET 'utf8mb3'")
CREATE OR REPLACE VIEW v_expiry_alert AS
SELECT *,
  CASE
    WHEN days_to_expire < 0 THEN _utf8mb4'EXPIRED' COLLATE utf8mb4_unicode_ci
    WHEN days_to_expire <= 90 THEN _utf8mb4'NEAR_EXPIRED' COLLATE utf8mb4_unicode_ci
    ELSE _utf8mb4'OK' COLLATE utf8mb4_unicode_ci
  END AS expiry_status
FROM v_store_stock_detail
HAVING expiry_status IN (_utf8mb4'EXPIRED' COLLATE utf8mb4_unicode_ci, _utf8mb4'NEAR_EXPIRED' COLLATE utf8mb4_unicode_ci);

-- Stock ต่ำกว่า Min / สูงกว่า Max (รวมยอดต่อ store+drug)
CREATE OR REPLACE VIEW v_stock_min_max_alert AS
SELECT
  s.store_id, s.store_code, s.store_name,
  d.drug_id, d.drug_code, d.drug_name, d.unit,
  cfg.min_qty, cfg.max_qty, cfg.avg_usage,
  COALESCE(SUM(ss.qty_on_hand),0) AS qty_on_hand,
  CASE
    WHEN COALESCE(SUM(ss.qty_on_hand),0) < cfg.min_qty THEN _utf8mb4'BELOW_MIN' COLLATE utf8mb4_unicode_ci
    WHEN cfg.max_qty > 0 AND COALESCE(SUM(ss.qty_on_hand),0) > cfg.max_qty THEN _utf8mb4'ABOVE_MAX' COLLATE utf8mb4_unicode_ci
    ELSE _utf8mb4'NORMAL' COLLATE utf8mb4_unicode_ci
  END AS stock_status
FROM store_drug_config cfg
JOIN stores s ON s.store_id = cfg.store_id
JOIN drug_master d ON d.drug_id = cfg.drug_id
LEFT JOIN store_stock ss ON ss.store_id = cfg.store_id AND ss.drug_id = cfg.drug_id
GROUP BY s.store_id, d.drug_id, cfg.min_qty, cfg.max_qty, cfg.avg_usage
HAVING stock_status <> _utf8mb4'NORMAL' COLLATE utf8mb4_unicode_ci;

-- มูลค่า Stock คงเหลือ แยกตาม Store
CREATE OR REPLACE VIEW v_stock_value_by_store AS
SELECT
  store_id, store_code, store_name,
  COUNT(DISTINCT drug_id) AS total_items,
  SUM(qty_on_hand) AS total_qty,
  ROUND(SUM(stock_value),2) AS total_value
FROM v_store_stock_detail
GROUP BY store_id, store_code, store_name;
