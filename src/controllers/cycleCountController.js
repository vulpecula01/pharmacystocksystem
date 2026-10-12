// ----------------------------------------------------------------------------
// นับสต๊อกจริง (Cycle Count / Stock Take)
// - แผนกเริ่มรอบนับ -> ระบบ snapshot ยอดคงเหลือปัจจุบันของทุก Lot ที่ Store นั้นถืออยู่
// - ผู้ใช้กรอกยอดที่นับได้จริงทีละ Lot พร้อมเหตุผลถ้ายอดต่างจากระบบ (ของหาย/นับผิด/ยาเสีย/อื่นๆ)
// - กด "ยืนยันปิดรอบนับ" ระบบจะปรับยอดคงเหลือให้ตรงกับที่นับได้จริงอัตโนมัติ (ต้องกรอกครบทุกรายการก่อน)
//   พร้อมบันทึกลง stock_transactions (ADJUSTMENT) และ audit log ไว้ตรวจสอบย้อนหลังได้
// ----------------------------------------------------------------------------

const pool = require('../config/db');
const { canAccessStore, isAdminRole } = require('../middleware/auth');
const { adjustStock, recordTransaction } = require('../utils/stock');
const { logAudit } = require('../utils/audit');

// เริ่มรอบนับใหม่: snapshot ยอดคงเหลือปัจจุบันทุก Lot ของ Store ที่ระบุ (เฉพาะ Lot ที่มียอด > 0 อยู่ในระบบ)
exports.createCount = async (req, res) => {
  const user = req.session.user;
  const { storeId, remark } = req.body;
  if (!storeId) return res.status(400).json({ error: 'ระบุ Store ที่จะนับ' });
  if (!canAccessStore(user, storeId)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง Store นี้' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO cycle_counts (store_id, remark, created_by) VALUES (?,?,?)`,
      [storeId, remark || null, user.user_id]
    );
    const countId = result.insertId;

    const [stockRows] = await conn.query(
      `SELECT drug_id, lot_id, qty_on_hand FROM store_stock WHERE store_id = ? AND qty_on_hand > 0`,
      [storeId]
    );
    for (const r of stockRows) {
      await conn.query(
        `INSERT INTO cycle_count_items (count_id, drug_id, lot_id, system_qty) VALUES (?,?,?,?)`,
        [countId, r.drug_id, r.lot_id, r.qty_on_hand]
      );
    }
    await conn.commit();

    await logAudit({
      userId: user.user_id, username: user.username, action: 'CYCLE_COUNT_START',
      entityType: 'CYCLE_COUNT', entityId: countId, storeId,
      detail: { itemCount: stockRows.length }, ip: req.ip
    });

    res.json({ countId, itemCount: stockRows.length });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally { conn.release(); }
};

function listQuery(where, params) {
  return pool.query(
    `SELECT cc.*, s.store_name, uc.full_name AS created_by_name, us.full_name AS submitted_by_name,
            (SELECT COUNT(*) FROM cycle_count_items ci WHERE ci.count_id = cc.count_id) AS item_count,
            (SELECT COUNT(*) FROM cycle_count_items ci WHERE ci.count_id = cc.count_id AND ci.counted_qty IS NOT NULL) AS counted_count
     FROM cycle_counts cc
     JOIN stores s ON s.store_id = cc.store_id
     JOIN users uc ON uc.user_id = cc.created_by
     LEFT JOIN users us ON us.user_id = cc.submitted_by
     ${where ? 'WHERE ' + where : ''}
     ORDER BY cc.created_at DESC
     LIMIT 200`,
    params
  );
}

exports.listCounts = async (req, res) => {
  try {
    const user = req.session.user;
    let rows;
    if (isAdminRole(user.role_code)) {
      [rows] = await listQuery('', []);
    } else {
      const storeIds = user.stores.map(s => s.store_id);
      if (storeIds.length === 0) return res.json([]);
      [rows] = await listQuery(`cc.store_id IN (${storeIds.map(() => '?').join(',')})`, storeIds);
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getCount = async (req, res) => {
  try {
    const [[count]] = await pool.query(
      `SELECT cc.*, s.store_name FROM cycle_counts cc JOIN stores s ON s.store_id = cc.store_id WHERE cc.count_id = ?`,
      [req.params.id]
    );
    if (!count) return res.status(404).json({ error: 'ไม่พบรอบนับนี้' });
    if (!canAccessStore(req.session.user, count.store_id) && !isAdminRole(req.session.user.role_code)) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงรอบนับนี้' });
    }
    const [items] = await pool.query(
      `SELECT ci.*, d.drug_code, d.drug_name, d.unit, l.lot_no, l.expired_date
       FROM cycle_count_items ci
       JOIN drug_master d ON d.drug_id = ci.drug_id
       JOIN drug_lots l ON l.lot_id = ci.lot_id
       WHERE ci.count_id = ?
       ORDER BY d.drug_name, l.expired_date`,
      [req.params.id]
    );
    count.items = items;
    res.json(count);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// บันทึกยอดที่นับได้ (บันทึกเก็บไว้ก่อนได้หลายครั้ง ยังไม่ตัดสต๊อกจริงจนกว่าจะกด submit)
exports.saveCountItems = async (req, res) => {
  const user = req.session.user;
  const { items } = req.body; // [{ itemId, countedQty, reason, note }]
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'ไม่มีรายการที่จะบันทึก' });

  try {
    const [[count]] = await pool.query(`SELECT * FROM cycle_counts WHERE count_id = ?`, [req.params.id]);
    if (!count) return res.status(404).json({ error: 'ไม่พบรอบนับนี้' });
    if (count.status !== 'DRAFT') return res.status(400).json({ error: 'รอบนับนี้ถูกปิดไปแล้ว ไม่สามารถแก้ไขได้' });
    if (!canAccessStore(user, count.store_id)) return res.status(403).json({ error: 'ไม่มีสิทธิ์บันทึกรอบนับนี้' });

    for (const it of items) {
      if (it.countedQty === undefined || it.countedQty === null || Number(it.countedQty) < 0) {
        return res.status(400).json({ error: 'กรุณาระบุจำนวนที่นับได้ให้ถูกต้อง (ต้องไม่ติดลบ)' });
      }
      await pool.query(
        `UPDATE cycle_count_items SET counted_qty=?, variance_reason=?, note=?
         WHERE item_id=? AND count_id=?`,
        [it.countedQty, it.reason || null, it.note || null, it.itemId, req.params.id]
      );
    }
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

// ยกเลิกรอบนับ (ยังไม่ปิด ยังไม่ตัดสต๊อกจริง)
exports.cancelCount = async (req, res) => {
  const user = req.session.user;
  try {
    const [[count]] = await pool.query(`SELECT * FROM cycle_counts WHERE count_id = ?`, [req.params.id]);
    if (!count) return res.status(404).json({ error: 'ไม่พบรอบนับนี้' });
    if (count.status !== 'DRAFT') return res.status(400).json({ error: 'ยกเลิกได้เฉพาะรอบนับที่ยังไม่ปิดเท่านั้น' });
    if (!canAccessStore(user, count.store_id) && !isAdminRole(user.role_code)) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ยกเลิกรอบนับนี้' });
    }
    await pool.query(`UPDATE cycle_counts SET status='CANCELLED' WHERE count_id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

// ยืนยันปิดรอบนับ - ต้องกรอกยอดนับครบทุกรายการก่อน แล้วปรับยอดคงเหลือให้ตรงกับที่นับได้จริง
exports.submitCount = async (req, res) => {
  const user = req.session.user;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[count]] = await conn.query(`SELECT * FROM cycle_counts WHERE count_id = ? FOR UPDATE`, [req.params.id]);
    if (!count) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบรอบนับนี้' }); }
    if (count.status !== 'DRAFT') { await conn.rollback(); return res.status(400).json({ error: 'รอบนับนี้ถูกปิดไปแล้ว' }); }
    if (!canAccessStore(user, count.store_id)) { await conn.rollback(); return res.status(403).json({ error: 'ไม่มีสิทธิ์ปิดรอบนับนี้' }); }

    const [items] = await conn.query(`SELECT * FROM cycle_count_items WHERE count_id = ?`, [req.params.id]);
    const uncounted = items.filter(it => it.counted_qty === null);
    if (uncounted.length > 0) {
      await conn.rollback();
      return res.status(400).json({ error: `ยังมี ${uncounted.length} รายการที่ยังไม่ได้กรอกยอดนับ กรุณากรอกให้ครบก่อนปิดรอบนับ` });
    }

    const varianceSummary = [];
    for (const it of items) {
      const variance = Number(it.counted_qty) - Number(it.system_qty);
      if (variance === 0) continue;
      if (!it.variance_reason) {
        await conn.rollback();
        return res.status(400).json({ error: `กรุณาระบุเหตุผลของส่วนต่างสำหรับรายการที่ยอดไม่ตรง (item_id: ${it.item_id})` });
      }
      const [[drug]] = await conn.query(`SELECT drug_name FROM drug_master WHERE drug_id=?`, [it.drug_id]);
      const balance = await adjustStock(conn, {
        storeId: count.store_id, drugId: it.drug_id, lotId: it.lot_id, qtyDelta: variance
      });
      await recordTransaction(conn, {
        storeId: count.store_id, drugId: it.drug_id, lotId: it.lot_id, type: 'ADJUSTMENT',
        qty: variance, balanceAfter: balance, refType: 'CYCLE_COUNT', refId: count.count_id, userId: user.user_id
      });
      varianceSummary.push({
        drugId: it.drug_id, drugName: drug ? drug.drug_name : null, lotId: it.lot_id,
        systemQty: Number(it.system_qty), countedQty: Number(it.counted_qty), variance, reason: it.variance_reason
      });
    }

    await conn.query(
      `UPDATE cycle_counts SET status='SUBMITTED', submitted_by=?, submitted_at=NOW() WHERE count_id=?`,
      [user.user_id, req.params.id]
    );
    await conn.commit();

    await logAudit({
      userId: user.user_id, username: user.username, action: 'CYCLE_COUNT_SUBMIT',
      entityType: 'CYCLE_COUNT', entityId: count.count_id, storeId: count.store_id,
      detail: { varianceCount: varianceSummary.length, variances: varianceSummary }, ip: req.ip
    });

    res.json({ ok: true, varianceCount: varianceSummary.length, variances: varianceSummary });
  } catch (err) {
    await conn.rollback();
    res.status(err.status || 400).json({ error: err.message });
  } finally { conn.release(); }
};
