const pool = require('../config/db');
const { canAccessStore } = require('../middleware/auth');
const { adjustStock, recordTransaction, findOrCreateLot, generateAutoLotNo, allocateFefoIssue } = require('../utils/stock');
const { logAudit } = require('../utils/audit');

// รายการยาคงเหลือของ Store (Stock Card) - แยกตาม Lot
exports.listStock = async (req, res) => {
  try {
    const { storeId, q } = req.query;
    if (!storeId) return res.status(400).json({ error: 'ระบุ storeId' });
    if (!canAccessStore(req.session.user, storeId)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง Store นี้' });

    const params = [storeId];
    let extra = '';
    if (q) { extra = ' AND (drug_name LIKE ? OR drug_code LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

    const [rows] = await pool.query(
      `SELECT * FROM v_store_stock_detail WHERE store_id = ? ${extra} ORDER BY drug_name, expired_date`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ค้นหายาด้วยรหัส (Scan QR/Barcode) เพื่อดู Lot คงเหลือใน Store ที่ระบุ
exports.lookupForScan = async (req, res) => {
  try {
    const { storeId, code } = req.query;
    if (!storeId || !code) return res.status(400).json({ error: 'ระบุ storeId และ code' });
    if (!canAccessStore(req.session.user, storeId)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง Store นี้' });

    const [[drug]] = await pool.query(`SELECT * FROM drug_master WHERE drug_code = ?`, [code]);
    if (!drug) return res.status(404).json({ error: `ไม่พบยารหัส ${code} ในระบบ` });

    const [lots] = await pool.query(
      `SELECT * FROM v_store_stock_detail WHERE store_id = ? AND drug_id = ? ORDER BY expired_date`,
      [storeId, drug.drug_id]
    );
    res.json({ drug, lots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ตัดจ่ายสินค้าออกจาก Store (Dispense)
exports.issueStock = async (req, res) => {
  const user = req.session.user;
  const { storeId, drugId, lotId, qty } = req.body;
  if (!storeId || !drugId || !lotId || !qty || Number(qty) <= 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน (store/ยา/lot/จำนวน)' });
  }
  if (!canAccessStore(user, storeId)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ตัดจ่ายจาก Store นี้' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[lot]] = await conn.query(`SELECT * FROM drug_lots WHERE lot_id = ?`, [lotId]);
    if (!lot) throw new Error('ไม่พบ Lot ที่ระบุ');

    const balance = await adjustStock(conn, {
      storeId, drugId, lotId, qtyDelta: -Number(qty)
    });
    await recordTransaction(conn, {
      storeId, drugId, lotId, type: 'ISSUE', qty: -Number(qty), unitCost: lot.unit_cost,
      balanceAfter: balance, refType: 'ISSUE', userId: user.user_id
    });
    await conn.commit();

    await logAudit({
      userId: user.user_id, username: user.username, action: 'STOCK_ISSUE',
      entityType: 'DRUG', entityId: drugId, storeId,
      detail: { lotId, qty, balanceAfter: balance }, ip: req.ip
    });

    res.json({ ok: true, balanceAfter: balance });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
};

// รายการ Lot ปัจจุบันของยาตัวหนึ่งใน Store ที่ระบุ (ใช้เลือก Lot ตอนสร้าง Transfer กันพิมพ์ Lot/Expired ผิด)
exports.listLotsForDrug = async (req, res) => {
  try {
    const { storeId, drugId } = req.query;
    if (!storeId || !drugId) return res.status(400).json({ error: 'ระบุ storeId และ drugId' });
    if (!canAccessStore(req.session.user, storeId)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง Store นี้' });

    const [rows] = await pool.query(
      `SELECT lot_id, lot_no, expired_date, unit_cost, qty_on_hand, days_to_expire
       FROM v_store_stock_detail
       WHERE store_id = ? AND drug_id = ?
       ORDER BY expired_date ASC`,
      [storeId, drugId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// รับยาเข้า Store ใหม่ (เช่น รับจาก Supplier เข้า Main Pharmacy) - ไม่ต้องผ่าน Transfer
// ถ้าไม่กรอก Lot No. ระบบจะ gen ให้อัตโนมัติ
exports.receiveStock = async (req, res) => {
  const user = req.session.user;
  const { storeId, drugId, lotNo, expiredDate, unitCost, qty } = req.body;
  if (!storeId || !drugId || !expiredDate || !qty || Number(qty) <= 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน (store/ยา/expired date/จำนวน)' });
  }
  if (!canAccessStore(user, storeId)) return res.status(403).json({ error: 'ไม่มีสิทธิ์รับยาเข้า Store นี้' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const finalLotNo = (lotNo && lotNo.trim()) ? lotNo.trim() : await generateAutoLotNo(conn, drugId);
    const lotId = await findOrCreateLot(conn, { drugId, lotNo: finalLotNo, expiredDate, unitCost: unitCost || 0 });

    const balance = await adjustStock(conn, {
      storeId, drugId, lotId, qtyDelta: Number(qty)
    });
    await recordTransaction(conn, {
      storeId, drugId, lotId, type: 'RECEIVE', qty: Number(qty), unitCost: unitCost || 0,
      balanceAfter: balance, refType: 'RECEIVE', userId: user.user_id
    });

    await conn.commit();
    await logAudit({
      userId: user.user_id, username: user.username, action: 'STOCK_RECEIVE',
      entityType: 'DRUG', entityId: drugId, storeId,
      detail: { lotNo: finalLotNo, expiredDate, qty, unitCost, balanceAfter: balance }, ip: req.ip
    });

    res.json({ ok: true, lotNo: finalLotNo, balanceAfter: balance });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
};

// ตัดจ่ายแบบ FEFO อัตโนมัติ: ระบุแค่ยา+จำนวนรวม ระบบไล่ตัดจาก Lot ใกล้หมดอายุที่สุดก่อนเอง
exports.issueStockFefo = async (req, res) => {
  const user = req.session.user;
  const { storeId, drugId, qty } = req.body;
  if (!storeId || !drugId || !qty || Number(qty) <= 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน (store/ยา/จำนวน)' });
  }
  if (!canAccessStore(user, storeId)) return res.status(403).json({ error: 'ไม่มีสิทธิ์ตัดจ่ายจาก Store นี้' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const allocations = await allocateFefoIssue(conn, {
      storeId, drugId, qty: Number(qty), userId: user.user_id, refType: 'ISSUE_FEFO'
    });
    await conn.commit();

    await logAudit({
      userId: user.user_id, username: user.username, action: 'STOCK_ISSUE_FEFO',
      entityType: 'DRUG', entityId: drugId, storeId,
      detail: { qty, allocations }, ip: req.ip
    });

    res.json({ ok: true, allocations });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
};

// Min/Max/Average usage ของแต่ละ Store
exports.listStoreDrugConfig = async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'ระบุ storeId' });
    if (!canAccessStore(req.session.user, storeId)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง Store นี้' });

    const [rows] = await pool.query(
      `SELECT cfg.*, d.drug_code, d.drug_name, d.unit,
              COALESCE((SELECT SUM(qty_on_hand) FROM store_stock ss WHERE ss.store_id=cfg.store_id AND ss.drug_id=cfg.drug_id),0) AS qty_on_hand
       FROM store_drug_config cfg
       JOIN drug_master d ON d.drug_id = cfg.drug_id
       WHERE cfg.store_id = ?
       ORDER BY d.drug_name`,
      [storeId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
