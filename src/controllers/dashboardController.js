const pool = require('../config/db');
const { canAccessStore, isAdminRole } = require('../middleware/auth');

// ------------------------------------------------------------------------
// Dashboard สถานะแผนกแบบ เขียว/เหลือง/แดง - หน้าแรกที่แผนก (Floor Stock) เข้ามาแล้วเห็นทันที
// ว่าตัวเองมีกี่รายการใกล้หมดอายุ/หมดอายุ กี่รายการต่ำกว่า Min โดยไม่ต้องไปหาในหลายเมนู
// แดง = มีของหมดอายุแล้ว หรือมีรายการต่ำกว่า Min (ต้องรีบจัดการ)
// เหลือง = มีของใกล้หมดอายุ หรือสต๊อกเกิน Max (ควรดู แต่ไม่เร่งด่วนเท่าแดง)
// เขียว = ปกติทุกรายการ
// ------------------------------------------------------------------------
function computeStatus({ expiredCount, nearExpiredCount, belowMinCount, aboveMaxCount }) {
  if (expiredCount > 0 || belowMinCount > 0) return 'RED';
  if (nearExpiredCount > 0 || aboveMaxCount > 0) return 'YELLOW';
  return 'GREEN';
}
const STATUS_RANK = { RED: 0, YELLOW: 1, GREEN: 2 };

exports.storeSummary = async (req, res) => {
  try {
    const user = req.session.user;
    let storeRows;
    if (isAdminRole(user.role_code)) {
      [storeRows] = await pool.query(
        `SELECT store_id, store_code, store_name, store_type FROM stores
         WHERE is_active = 1 AND store_type IN ('MAIN_PHARMACY','FLOOR_STOCK','EMERGENCY_BAG','SUB_STORE')`
      );
    } else {
      const storeIds = user.stores.map(s => s.store_id);
      if (storeIds.length === 0) return res.json([]);
      [storeRows] = await pool.query(
        `SELECT store_id, store_code, store_name, store_type FROM stores WHERE store_id IN (${storeIds.map(() => '?').join(',')})`,
        storeIds
      );
    }
    if (storeRows.length === 0) return res.json([]);

    const ids = storeRows.map(s => s.store_id);
    const inClause = ids.map(() => '?').join(',');

    const [expiredRows] = await pool.query(
      `SELECT store_id, COUNT(*) AS cnt FROM v_expiry_alert WHERE store_id IN (${inClause}) AND expiry_status='EXPIRED' GROUP BY store_id`, ids
    );
    const [nearExpiredRows] = await pool.query(
      `SELECT store_id, COUNT(*) AS cnt FROM v_expiry_alert WHERE store_id IN (${inClause}) AND expiry_status='NEAR_EXPIRED' GROUP BY store_id`, ids
    );
    const [belowMinRows] = await pool.query(
      `SELECT store_id, COUNT(*) AS cnt FROM v_stock_min_max_alert WHERE store_id IN (${inClause}) AND stock_status='BELOW_MIN' GROUP BY store_id`, ids
    );
    const [aboveMaxRows] = await pool.query(
      `SELECT store_id, COUNT(*) AS cnt FROM v_stock_min_max_alert WHERE store_id IN (${inClause}) AND stock_status='ABOVE_MAX' GROUP BY store_id`, ids
    );
    const [pendingReplenishRows] = await pool.query(
      `SELECT store_id, COUNT(*) AS cnt FROM replenishment_requests WHERE store_id IN (${inClause}) AND status='PENDING' GROUP BY store_id`, ids
    );

    const toMap = (rows) => rows.reduce((m, r) => { m[r.store_id] = r.cnt; return m; }, {});
    const expiredMap = toMap(expiredRows), nearExpiredMap = toMap(nearExpiredRows);
    const belowMinMap = toMap(belowMinRows), aboveMaxMap = toMap(aboveMaxRows);
    const pendingReplenishMap = toMap(pendingReplenishRows);

    const result = storeRows.map(s => {
      const counts = {
        expiredCount: expiredMap[s.store_id] || 0,
        nearExpiredCount: nearExpiredMap[s.store_id] || 0,
        belowMinCount: belowMinMap[s.store_id] || 0,
        aboveMaxCount: aboveMaxMap[s.store_id] || 0,
        pendingReplenishCount: pendingReplenishMap[s.store_id] || 0
      };
      return { storeId: s.store_id, storeCode: s.store_code, storeName: s.store_name, storeType: s.store_type,
        ...counts, status: computeStatus(counts) };
    });

    result.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.storeName.localeCompare(b.storeName));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.storeDetail = async (req, res) => {
  try {
    const storeId = req.params.storeId;
    if (!canAccessStore(req.session.user, storeId)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง Store นี้' });

    const [expiredItems] = await pool.query(
      `SELECT * FROM v_expiry_alert WHERE store_id=? AND expiry_status='EXPIRED' ORDER BY days_to_expire ASC`, [storeId]
    );
    const [nearExpiredItems] = await pool.query(
      `SELECT * FROM v_expiry_alert WHERE store_id=? AND expiry_status='NEAR_EXPIRED' ORDER BY days_to_expire ASC`, [storeId]
    );
    const [belowMinItems] = await pool.query(
      `SELECT * FROM v_stock_min_max_alert WHERE store_id=? AND stock_status='BELOW_MIN' ORDER BY drug_name`, [storeId]
    );
    const [aboveMaxItems] = await pool.query(
      `SELECT * FROM v_stock_min_max_alert WHERE store_id=? AND stock_status='ABOVE_MAX' ORDER BY drug_name`, [storeId]
    );
    const [pendingReplenish] = await pool.query(
      `SELECT request_id, created_at FROM replenishment_requests WHERE store_id=? AND status='PENDING' ORDER BY created_at DESC`, [storeId]
    );

    res.json({ expiredItems, nearExpiredItems, belowMinItems, aboveMaxItems, pendingReplenish });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ภาพรวมสำหรับ Pharmacy Admin
exports.summary = async (req, res) => {
  try {
    const [[totals]] = await pool.query(
      `SELECT COUNT(DISTINCT drug_id) AS total_items, SUM(qty_on_hand) AS total_qty, ROUND(SUM(stock_value),2) AS total_value
       FROM v_store_stock_detail`
    );
    const [byStore] = await pool.query(`SELECT * FROM v_stock_value_by_store ORDER BY total_value DESC`);
    const [[nearExpiryCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM v_expiry_alert WHERE expiry_status='NEAR_EXPIRED'`
    );
    const [[expiredCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM v_expiry_alert WHERE expiry_status='EXPIRED'`
    );
    const [[belowMin]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM v_stock_min_max_alert WHERE stock_status='BELOW_MIN'`
    );
    const [[aboveMax]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM v_stock_min_max_alert WHERE stock_status='ABOVE_MAX'`
    );
    const [pendingTransfers] = await pool.query(
      `SELECT COUNT(*) AS cnt, to_store_id FROM transfers WHERE status='TRANSFER_PENDING' GROUP BY to_store_id`
    );
    const [recentMovement] = await pool.query(
      `SELECT DATE(created_at) AS d, transaction_type, SUM(ABS(qty)) AS qty
       FROM stock_transactions WHERE created_at >= (CURDATE() - INTERVAL 13 DAY)
       GROUP BY d, transaction_type ORDER BY d`
    );
    const [nearExpiryList] = await pool.query(
      `SELECT * FROM v_expiry_alert ORDER BY days_to_expire ASC LIMIT 20`
    );
    const [belowMinList] = await pool.query(
      `SELECT * FROM v_stock_min_max_alert WHERE stock_status='BELOW_MIN' ORDER BY store_name, drug_name LIMIT 20`
    );

    res.json({
      totals,
      byStore,
      nearExpiryCount: nearExpiryCount.cnt,
      expiredCount: expiredCount.cnt,
      belowMinCount: belowMin.cnt,
      aboveMaxCount: aboveMax.cnt,
      pendingTransfers: pendingTransfers.reduce((a, r) => a + r.cnt, 0),
      recentMovement,
      nearExpiryList,
      belowMinList
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
