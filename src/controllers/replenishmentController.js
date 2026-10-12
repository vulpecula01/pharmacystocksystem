// ----------------------------------------------------------------------------
// ใบขอเบิกอัตโนมัติจาก Min/Max (Replenishment Request)
// - แผนก/Store ที่ถือ Floor Stock กดขอเบิกจากรายการที่ต่ำกว่า Min อัตโนมัติ (ไม่ต้องเลือกทีละตัว)
// - Main Pharmacy เห็นคิวใบขอเบิกที่รอจัด กดจัดแล้วระบบไล่ตัด Lot แบบ FEFO ให้อัตโนมัติ
//   สร้างเป็น Transfer จริง (submit ทันที) ผูกกลับมาที่ใบขอเบิกเพื่อดูย้อนหลังได้
// ----------------------------------------------------------------------------

const pool = require('../config/db');
const { canAccessStore, isAdminRole } = require('../middleware/auth');
const { generateDocNo, submitTransferOutItem, previewFefoAllocation } = require('../utils/stock');
const { logAudit } = require('../utils/audit');

// พรีวิวรายการที่ต่ำกว่า Min ของ Store ที่ระบุ พร้อมจำนวนที่แนะนำให้ขอเบิก (เติมให้ถึง Max)
// อ่านอย่างเดียว ยังไม่บันทึกอะไร - ใช้แสดงในหน้าจอให้ผู้ใช้ปรับจำนวนก่อนกดยืนยันสร้างจริง
exports.previewAutoRequest = async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'ระบุ storeId' });
    if (!canAccessStore(req.session.user, storeId)) return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง Store นี้' });

    const [rows] = await pool.query(
      `SELECT drug_id, drug_code, drug_name, unit, qty_on_hand, min_qty, max_qty
       FROM v_stock_min_max_alert
       WHERE store_id = ? AND stock_status = 'BELOW_MIN'
       ORDER BY drug_name`,
      [storeId]
    );

    const items = rows.map(r => {
      // แนะนำให้เติมถึง Max ถ้าตั้งไว้ (มากกว่า Min) ไม่งั้น fallback เป็นเติมถึง Min เฉยๆ
      const target = Number(r.max_qty) > Number(r.min_qty) ? Number(r.max_qty) : Number(r.min_qty);
      const suggestedQty = Math.max(0, Math.round((target - Number(r.qty_on_hand)) * 100) / 100);
      return { ...r, suggested_qty: suggestedQty };
    }).filter(r => r.suggested_qty > 0);

    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// สร้างใบขอเบิกจริง (สถานะ PENDING) จากรายการที่ผู้ใช้ยืนยัน (อาจปรับจำนวนหรือตัดบางรายการออกมาก่อนแล้ว)
exports.createRequest = async (req, res) => {
  const user = req.session.user;
  const { storeId, items, remark } = req.body;
  if (!storeId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน (Store/รายการยา)' });
  }
  if (!canAccessStore(user, storeId)) return res.status(403).json({ error: 'ไม่มีสิทธิ์สร้างใบขอเบิกจาก Store นี้' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO replenishment_requests (store_id, remark, created_by) VALUES (?,?,?)`,
      [storeId, remark || null, user.user_id]
    );
    const requestId = result.insertId;

    for (const it of items) {
      if (!it.drugId || !it.qtyRequested || Number(it.qtyRequested) <= 0) {
        throw new Error('รายการยาไม่ครบถ้วน (ยา/จำนวนที่ขอเบิก)');
      }
      await conn.query(
        `INSERT INTO replenishment_items
           (request_id, drug_id, qty_on_hand_snapshot, min_qty_snapshot, max_qty_snapshot, qty_requested)
         VALUES (?,?,?,?,?,?)`,
        [requestId, it.drugId, it.qtyOnHand || 0, it.minQty || 0, it.maxQty || 0, it.qtyRequested]
      );
    }
    await conn.commit();

    await logAudit({
      userId: user.user_id, username: user.username, action: 'REPLENISHMENT_REQUEST_CREATE',
      entityType: 'REPLENISHMENT_REQUEST', entityId: requestId, storeId,
      detail: { itemCount: items.length }, ip: req.ip
    });

    res.json({ requestId });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally { conn.release(); }
};

function listQuery(where, params) {
  return pool.query(
    `SELECT rr.*, s.store_name, uc.full_name AS created_by_name, uf.full_name AS fulfilled_by_name,
            t.transfer_no AS fulfilled_transfer_no,
            (SELECT COUNT(*) FROM replenishment_items ri WHERE ri.request_id = rr.request_id) AS item_count
     FROM replenishment_requests rr
     JOIN stores s ON s.store_id = rr.store_id
     JOIN users uc ON uc.user_id = rr.created_by
     LEFT JOIN users uf ON uf.user_id = rr.fulfilled_by
     LEFT JOIN transfers t ON t.transfer_id = rr.fulfilled_transfer_id
     ${where ? 'WHERE ' + where : ''}
     ORDER BY rr.created_at DESC
     LIMIT 200`,
    params
  );
}

// รายการใบขอเบิก: Admin/Main Pharmacy เห็นทุกใบ, Store User เห็นเฉพาะของ Store ตัวเอง
exports.listRequests = async (req, res) => {
  try {
    const user = req.session.user;
    let rows;
    if (isAdminRole(user.role_code)) {
      [rows] = await listQuery('', []);
    } else {
      const storeIds = user.stores.map(s => s.store_id);
      if (storeIds.length === 0) return res.json([]);
      [rows] = await listQuery(`rr.store_id IN (${storeIds.map(() => '?').join(',')})`, storeIds);
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.getRequest = async (req, res) => {
  try {
    const [[request]] = await pool.query(
      `SELECT rr.*, s.store_name FROM replenishment_requests rr JOIN stores s ON s.store_id = rr.store_id WHERE rr.request_id = ?`,
      [req.params.id]
    );
    if (!request) return res.status(404).json({ error: 'ไม่พบใบขอเบิกนี้' });
    if (!canAccessStore(req.session.user, request.store_id) && !isAdminRole(req.session.user.role_code)) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงใบขอเบิกนี้' });
    }
    const [items] = await pool.query(
      `SELECT ri.*, d.drug_code, d.drug_name, d.unit
       FROM replenishment_items ri JOIN drug_master d ON d.drug_id = ri.drug_id
       WHERE ri.request_id = ?`,
      [req.params.id]
    );
    request.items = items;
    res.json(request);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.cancelRequest = async (req, res) => {
  const user = req.session.user;
  try {
    const [[request]] = await pool.query(`SELECT * FROM replenishment_requests WHERE request_id = ?`, [req.params.id]);
    if (!request) return res.status(404).json({ error: 'ไม่พบใบขอเบิกนี้' });
    if (request.status !== 'PENDING') return res.status(400).json({ error: 'ยกเลิกได้เฉพาะใบขอเบิกที่ยังไม่ได้จัดเท่านั้น' });
    if (!canAccessStore(user, request.store_id) && !isAdminRole(user.role_code)) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ยกเลิกใบขอเบิกนี้' });
    }
    await pool.query(`UPDATE replenishment_requests SET status='CANCELLED', cancel_reason=? WHERE request_id=?`,
      [req.body.reason || null, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

async function findMainPharmacyStoreId() {
  const [[row]] = await pool.query(`SELECT store_id FROM stores WHERE store_type = 'MAIN_PHARMACY' AND is_active = 1 LIMIT 1`);
  if (!row) throw Object.assign(new Error('ไม่พบ Store ประเภท Main Pharmacy ในระบบ'), { status: 400 });
  return row.store_id;
}

// พรีวิวการจัดใบขอเบิก - คำนวณ FEFO จาก Main Pharmacy แบบอ่านอย่างเดียว ให้เห็นก่อนว่าจะได้ Lot ไหน/พอไหม
exports.getFulfillPreview = async (req, res) => {
  try {
    if (!isAdminRole(req.session.user.role_code)) return res.status(403).json({ error: 'เฉพาะเภสัชกร/Admin เท่านั้นที่จัดใบขอเบิกได้' });
    const [[request]] = await pool.query(`SELECT * FROM replenishment_requests WHERE request_id = ?`, [req.params.id]);
    if (!request) return res.status(404).json({ error: 'ไม่พบใบขอเบิกนี้' });
    if (request.status !== 'PENDING') return res.status(400).json({ error: 'ใบขอเบิกนี้ถูกจัดการไปแล้ว' });

    const mainStoreId = await findMainPharmacyStoreId();
    const [items] = await pool.query(
      `SELECT ri.*, d.drug_code, d.drug_name, d.unit
       FROM replenishment_items ri JOIN drug_master d ON d.drug_id = ri.drug_id WHERE ri.request_id = ?`,
      [req.params.id]
    );

    const conn = await pool.getConnection();
    let preview;
    try {
      preview = [];
      for (const it of items) {
        const alloc = await previewFefoAllocation(conn, { storeId: mainStoreId, drugId: it.drug_id, qty: it.qty_requested });
        preview.push({
          drugId: it.drug_id, drugCode: it.drug_code, drugName: it.drug_name, unit: it.unit,
          qtyRequested: Number(it.qty_requested), qtyAvailable: alloc.totalAvailable,
          qtyAllocatable: Number(it.qty_requested) - alloc.shortfall, shortfall: alloc.shortfall,
          allocations: alloc.allocations
        });
      }
    } finally { conn.release(); }

    res.json({ mainStoreId, items: preview });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
};

// ยืนยันจัดใบขอเบิกจริง - สร้าง Transfer (submit ทันที) จาก Main Pharmacy ไปยัง Store ที่ขอเบิก
// โดยใช้ Lot ตาม FEFO ที่คำนวณไว้ (คำนวณใหม่ในนี้อีกครั้งภายใต้ Transaction เดียวกัน กัน Race condition)
exports.fulfillRequest = async (req, res) => {
  const user = req.session.user;
  if (!isAdminRole(user.role_code)) return res.status(403).json({ error: 'เฉพาะเภสัชกร/Admin เท่านั้นที่จัดใบขอเบิกได้' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[request]] = await conn.query(`SELECT * FROM replenishment_requests WHERE request_id = ? FOR UPDATE`, [req.params.id]);
    if (!request) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบใบขอเบิกนี้' }); }
    if (request.status !== 'PENDING') { await conn.rollback(); return res.status(400).json({ error: 'ใบขอเบิกนี้ถูกจัดการไปแล้ว' }); }

    const mainStoreId = await findMainPharmacyStoreId();
    const [items] = await conn.query(`SELECT * FROM replenishment_items WHERE request_id = ?`, [req.params.id]);

    const transferNo = await generateDocNo(conn, 'TRF', 'transfers', 'transfer_no');
    const [transferResult] = await conn.query(
      `INSERT INTO transfers (transfer_no, from_store_id, to_store_id, status, created_by, remark, sent_at)
       VALUES (?,?,?,'TRANSFER_PENDING',?,?,NOW())`,
      [transferNo, mainStoreId, request.store_id, user.user_id, `จัดจากใบขอเบิกอัตโนมัติ #${request.request_id}`]
    );
    const transferId = transferResult.insertId;

    const fulfilledSummary = [];
    for (const it of items) {
      const alloc = await previewFefoAllocation(conn, { storeId: mainStoreId, drugId: it.drug_id, qty: it.qty_requested });
      let qtyFulfilled = 0;
      for (const a of alloc.allocations) {
        await conn.query(
          `INSERT INTO transfer_items (transfer_id, drug_id, lot_no, expired_date, unit_cost, qty_transfer)
           VALUES (?,?,?,?,?,?)`,
          [transferId, it.drug_id, a.lotNo, a.expiredDate, a.unitCost, a.qty]
        );
        await submitTransferOutItem(conn, {
          transferId, fromStoreId: mainStoreId, drugId: it.drug_id, lotNo: a.lotNo,
          expiredDate: a.expiredDate, unitCost: a.unitCost, qty: a.qty, userId: user.user_id
        });
        qtyFulfilled += a.qty;
      }
      await conn.query(`UPDATE replenishment_items SET qty_fulfilled = ? WHERE item_id = ?`, [qtyFulfilled, it.item_id]);
      fulfilledSummary.push({ drugId: it.drug_id, qtyRequested: Number(it.qty_requested), qtyFulfilled, shortfall: alloc.shortfall });
    }

    await conn.query(
      `UPDATE replenishment_requests SET status='FULFILLED', fulfilled_transfer_id=?, fulfilled_by=?, fulfilled_at=NOW() WHERE request_id=?`,
      [transferId, user.user_id, req.params.id]
    );

    await conn.commit();
    await logAudit({
      userId: user.user_id, username: user.username, action: 'REPLENISHMENT_REQUEST_FULFILL',
      entityType: 'REPLENISHMENT_REQUEST', entityId: Number(req.params.id), storeId: mainStoreId,
      detail: { transferId, transferNo, toStoreId: request.store_id, items: fulfilledSummary }, ip: req.ip
    });

    const hasShortfall = fulfilledSummary.some(s => s.shortfall > 0);
    res.json({ ok: true, transferId, transferNo, items: fulfilledSummary, hasShortfall });
  } catch (err) {
    await conn.rollback();
    res.status(err.status || 400).json({ error: err.message });
  } finally { conn.release(); }
};
