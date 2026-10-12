const pool = require('../config/db');
const { canAccessStore, isAdminRole } = require('../middleware/auth');
const { findOrCreateLot, adjustStock, recordTransaction, generateDocNo, receiveTransferGoods, submitTransferOutItem } = require('../utils/stock');
const { logAudit } = require('../utils/audit');

// รายการ Transfer (filter ตาม store / status)
exports.listTransfers = async (req, res) => {
  try {
    const user = req.session.user;
    const { status, storeId, direction } = req.query;
    const where = [];
    const params = [];

    if (!isAdminRole(user.role_code)) {
      const storeIds = user.stores.map(s => s.store_id);
      if (storeIds.length === 0) return res.json([]);
      where.push(`(t.from_store_id IN (${storeIds.map(() => '?').join(',')}) OR t.to_store_id IN (${storeIds.map(() => '?').join(',')}))`);
      params.push(...storeIds, ...storeIds);
    }
    if (storeId) {
      if (direction === 'in') { where.push('t.to_store_id = ?'); params.push(storeId); }
      else if (direction === 'out') { where.push('t.from_store_id = ?'); params.push(storeId); }
      else { where.push('(t.from_store_id = ? OR t.to_store_id = ?)'); params.push(storeId, storeId); }
    }
    if (status) { where.push('t.status = ?'); params.push(status); }

    const sql = `
      SELECT t.transfer_id, t.transfer_no, t.status, t.created_at, t.sent_at, t.received_at,
             fs.store_name AS from_store_name, ts.store_name AS to_store_name,
             uc.full_name AS created_by_name,
             (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = t.transfer_id) AS item_count
      FROM transfers t
      JOIN stores fs ON fs.store_id = t.from_store_id
      JOIN stores ts ON ts.store_id = t.to_store_id
      JOIN users uc ON uc.user_id = t.created_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.created_at DESC
      LIMIT 200`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTransfer = async (req, res) => {
  try {
    const [[transfer]] = await pool.query(
      `SELECT t.*, fs.store_name AS from_store_name, ts.store_name AS to_store_name,
              uc.full_name AS created_by_name, ur.full_name AS received_by_name
       FROM transfers t
       JOIN stores fs ON fs.store_id = t.from_store_id
       JOIN stores ts ON ts.store_id = t.to_store_id
       JOIN users uc ON uc.user_id = t.created_by
       LEFT JOIN users ur ON ur.user_id = t.received_by
       WHERE t.transfer_id = ?`,
      [req.params.id]
    );
    if (!transfer) return res.status(404).json({ error: 'ไม่พบรายการ Transfer' });

    const user = req.session.user;
    if (!canAccessStore(user, transfer.from_store_id) && !canAccessStore(user, transfer.to_store_id)) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงรายการนี้' });
    }

    const [items] = await pool.query(
      `SELECT ti.*, d.drug_code, d.drug_name, d.strength_form, d.unit
       FROM transfer_items ti JOIN drug_master d ON d.drug_id = ti.drug_id
       WHERE ti.transfer_id = ?`,
      [req.params.id]
    );
    transfer.items = items;
    res.json(transfer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// สร้างรายการ Transfer ใหม่ (status: DRAFT หรือ TRANSFER_PENDING ถ้า submit=true)
exports.createTransfer = async (req, res) => {
  const user = req.session.user;
  const { fromStoreId, toStoreId, items, submit, remark } = req.body;

  if (!fromStoreId || !toStoreId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน (ต้นทาง/ปลายทาง/รายการยา)' });
  }
  if (!canAccessStore(user, fromStoreId)) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์สร้าง Transfer จาก Store ต้นทางนี้' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const transferNo = await generateDocNo(conn, 'TRF', 'transfers', 'transfer_no');
    const status = submit ? 'TRANSFER_PENDING' : 'DRAFT';

    const [result] = await conn.query(
      `INSERT INTO transfers (transfer_no, from_store_id, to_store_id, status, created_by, remark, sent_at)
       VALUES (?,?,?,?,?,?,?)`,
      [transferNo, fromStoreId, toStoreId, status, user.user_id, remark || null, submit ? new Date() : null]
    );
    const transferId = result.insertId;

    for (const it of items) {
      if (!it.drugId || !it.lotNo || !it.expiredDate || !it.qtyTransfer || Number(it.qtyTransfer) <= 0) {
        throw new Error('รายการยาไม่ครบถ้วน (ยา/Lot/Expired/จำนวน)');
      }
      await conn.query(
        `INSERT INTO transfer_items (transfer_id, drug_id, lot_no, expired_date, unit_cost, qty_transfer)
         VALUES (?,?,?,?,?,?)`,
        [transferId, it.drugId, it.lotNo, it.expiredDate, it.unitCost || 0, it.qtyTransfer]
      );

      // ถ้า submit ทันที ให้ตัด Stock ต้นทางเลย (TRANSFER_OUT)
      if (submit) {
        await submitTransferOutItem(conn, {
          transferId, fromStoreId, drugId: it.drugId, lotNo: it.lotNo, expiredDate: it.expiredDate,
          unitCost: it.unitCost, qty: it.qtyTransfer, userId: user.user_id
        });
      }
    }

    await conn.commit();
    await logAudit({
      userId: user.user_id, username: user.username, action: submit ? 'TRANSFER_SEND' : 'TRANSFER_CREATE_DRAFT',
      entityType: 'TRANSFER', entityId: transferId, storeId: fromStoreId,
      detail: { transferNo, toStoreId, itemCount: items.length }, ip: req.ip
    });

    res.json({ transferId, transferNo, status });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
};

// ส่งรายการ Draft ออกไป (ตัด Stock ต้นทาง)
exports.sendTransfer = async (req, res) => {
  const user = req.session.user;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[transfer]] = await conn.query(`SELECT * FROM transfers WHERE transfer_id = ? FOR UPDATE`, [req.params.id]);
    if (!transfer) throw new Error('ไม่พบรายการ Transfer');
    if (transfer.status !== 'DRAFT') throw new Error('รายการนี้ไม่ได้อยู่ในสถานะ Draft');
    if (!canAccessStore(user, transfer.from_store_id)) throw new Error('ไม่มีสิทธิ์ดำเนินการ');

    const [items] = await conn.query(`SELECT * FROM transfer_items WHERE transfer_id = ?`, [transfer.transfer_id]);
    for (const it of items) {
      await submitTransferOutItem(conn, {
        transferId: transfer.transfer_id, fromStoreId: transfer.from_store_id, drugId: it.drug_id,
        lotNo: it.lot_no, expiredDate: it.expired_date, unitCost: it.unit_cost, qty: it.qty_transfer,
        userId: user.user_id
      });
    }
    await conn.query(`UPDATE transfers SET status='TRANSFER_PENDING', sent_at=NOW() WHERE transfer_id=?`, [transfer.transfer_id]);
    await conn.commit();
    await logAudit({
      userId: user.user_id, username: user.username, action: 'TRANSFER_SEND',
      entityType: 'TRANSFER', entityId: transfer.transfer_id, storeId: transfer.from_store_id, ip: req.ip
    });
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
};

// Store ปลายทางกด "รับสินค้า"
exports.receiveTransfer = async (req, res) => {
  const user = req.session.user;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[transferCheck]] = await conn.query(`SELECT to_store_id FROM transfers WHERE transfer_id = ?`, [req.params.id]);
    if (!transferCheck) throw new Error('ไม่พบรายการ Transfer');
    if (!canAccessStore(user, transferCheck.to_store_id)) throw new Error('เฉพาะ Store ปลายทางเท่านั้นที่รับสินค้าได้');

    const { transfer } = await receiveTransferGoods(conn, { transferId: req.params.id, userId: user.user_id });
    await conn.commit();
    await logAudit({
      userId: user.user_id, username: user.username, action: 'TRANSFER_RECEIVE',
      entityType: 'TRANSFER', entityId: transfer.transfer_id, storeId: transfer.to_store_id, ip: req.ip
    });
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(err.status || 400).json({ error: err.message });
  } finally {
    conn.release();
  }
};

// ยกเลิกรายการ (คืน Stock ถ้าเคยตัดออกไปแล้ว)
exports.cancelTransfer = async (req, res) => {
  const user = req.session.user;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[transfer]] = await conn.query(`SELECT * FROM transfers WHERE transfer_id = ? FOR UPDATE`, [req.params.id]);
    if (!transfer) throw new Error('ไม่พบรายการ Transfer');
    if (!['DRAFT', 'TRANSFER_PENDING'].includes(transfer.status)) throw new Error('ไม่สามารถยกเลิกรายการนี้ได้');
    if (!canAccessStore(user, transfer.from_store_id)) throw new Error('ไม่มีสิทธิ์ดำเนินการ');

    if (transfer.status === 'TRANSFER_PENDING') {
      // คืน stock ที่เคยตัดออกจากต้นทาง
      const [items] = await conn.query(`SELECT * FROM transfer_items WHERE transfer_id = ?`, [transfer.transfer_id]);
      for (const it of items) {
        const lotId = await findOrCreateLot(conn, {
          drugId: it.drug_id, lotNo: it.lot_no, expiredDate: it.expired_date, unitCost: it.unit_cost
        });
        const balance = await adjustStock(conn, {
          storeId: transfer.from_store_id, drugId: it.drug_id, lotId, qtyDelta: Number(it.qty_transfer)
        });
        await recordTransaction(conn, {
          storeId: transfer.from_store_id, drugId: it.drug_id, lotId, type: 'ADJUSTMENT',
          qty: Number(it.qty_transfer), unitCost: it.unit_cost, balanceAfter: balance,
          refType: 'TRANSFER_CANCEL', refId: transfer.transfer_id, userId: user.user_id
        });
      }
    }
    await conn.query(`UPDATE transfers SET status='CANCELLED', cancelled_by=?, cancelled_at=NOW() WHERE transfer_id=?`, [user.user_id, transfer.transfer_id]);
    await conn.commit();
    await logAudit({
      userId: user.user_id, username: user.username, action: 'TRANSFER_CANCEL',
      entityType: 'TRANSFER', entityId: transfer.transfer_id, storeId: transfer.from_store_id, ip: req.ip
    });
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
};
