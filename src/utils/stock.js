// Helper functions สำหรับจัดการ Stock (Lot, On-hand balance, Ledger)
// ทุกฟังก์ชันรับ `conn` ที่เปิด transaction แล้ว (conn.beginTransaction())

async function findOrCreateLot(conn, { drugId, lotNo, expiredDate, unitCost }) {
  const [rows] = await conn.query(
    `SELECT lot_id, unit_cost FROM drug_lots WHERE drug_id = ? AND lot_no = ? AND expired_date = ? FOR UPDATE`,
    [drugId, lotNo, expiredDate]
  );
  if (rows[0]) return rows[0].lot_id;
  const [result] = await conn.query(
    `INSERT INTO drug_lots (drug_id, lot_no, expired_date, unit_cost) VALUES (?,?,?,?)`,
    [drugId, lotNo, expiredDate, unitCost || 0]
  );
  return result.insertId;
}

// เพิ่ม/ลด qty ใน store_stock (upsert) พร้อมคืนค่า balance_after
// qtyDelta > 0 = รับเข้า, < 0 = จ่ายออก/โอนออก
async function adjustStock(conn, { storeId, drugId, lotId, qtyDelta, unitCost, sourceStoreId }) {
  const [rows] = await conn.query(
    `SELECT store_stock_id, qty_on_hand FROM store_stock
     WHERE store_id = ? AND drug_id = ? AND lot_id = ? FOR UPDATE`,
    [storeId, drugId, lotId]
  );

  let currentQty = 0;
  if (rows[0]) currentQty = Number(rows[0].qty_on_hand);

  const newQty = Number((currentQty + qtyDelta).toFixed(2));
  if (newQty < 0) {
    const err = new Error(`สต๊อกไม่พอ (คงเหลือ ${currentQty})`);
    err.code = 'INSUFFICIENT_STOCK';
    throw err;
  }

  if (rows[0]) {
    await conn.query(
      `UPDATE store_stock SET qty_on_hand = ?, updated_at = NOW()
       ${qtyDelta > 0 ? ', received_date = NOW()' : ''}
       ${qtyDelta > 0 && sourceStoreId ? ', source_store_id = ?' : ''}
       WHERE store_stock_id = ?`,
      qtyDelta > 0 && sourceStoreId
        ? [newQty, sourceStoreId, rows[0].store_stock_id]
        : [newQty, rows[0].store_stock_id]
    );
  } else {
    await conn.query(
      `INSERT INTO store_stock (store_id, drug_id, lot_id, qty_on_hand, source_store_id, received_date)
       VALUES (?,?,?,?,?, NOW())`,
      [storeId, drugId, lotId, newQty, sourceStoreId || null]
    );
  }
  return newQty;
}

async function recordTransaction(conn, { storeId, drugId, lotId, type, qty, unitCost, balanceAfter, refType, refId, userId }) {
  await conn.query(
    `INSERT INTO stock_transactions
       (store_id, drug_id, lot_id, transaction_type, qty, unit_cost, balance_after, ref_type, ref_id, user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [storeId, drugId, lotId, type, qty, unitCost || 0, balanceAfter, refType || null, refId || null, userId]
  );
}

async function generateDocNo(conn, prefix, table, column) {
  const today = new Date();
  const ymd = today.toISOString().slice(0, 10).replace(/-/g, '');
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${column} LIKE ?`,
    [`${prefix}${ymd}%`]
  );
  const seq = String(Number(rows[0].cnt) + 1).padStart(4, '0');
  return `${prefix}${ymd}-${seq}`;
}

// สร้างเลข Lot อัตโนมัติ กรณีผู้ใช้ไม่ได้กรอก Lot No. เอง (ใช้ตอนรับยาเข้าใหม่)
// รูปแบบ: AUTO-{รหัสยา}-{YYYYMMDD}-{ลำดับที่ของวันนั้น}
async function generateAutoLotNo(conn, drugId) {
  const today = new Date();
  const ymd = today.toISOString().slice(0, 10).replace(/-/g, '');
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM drug_lots WHERE drug_id = ? AND lot_no LIKE ?`,
    [drugId, `AUTO-%-${ymd}-%`]
  );
  const seq = String(Number(rows[0].cnt) + 1).padStart(3, '0');
  return `AUTO-${drugId}-${ymd}-${seq}`;
}

// ตัดจ่ายแบบ FEFO (First Expired, First Out): ไล่ตัดจาก Lot ที่ใกล้หมดอายุที่สุดก่อนโดยอัตโนมัติ
// จนกว่าจำนวนที่ต้องการจะครบ ถ้า Stock รวมทุก Lot ไม่พอ จะ throw error และ rollback ทั้งหมด (ไม่ตัดบางส่วน)
// คืนค่ารายละเอียดว่าตัดจาก Lot ไหนไปเท่าไหร่ ไว้แสดงผลให้ผู้ใช้เห็น
async function allocateFefoIssue(conn, { storeId, drugId, qty, userId, refType = 'ISSUE', refId = null }) {
  const [lots] = await conn.query(
    `SELECT ss.store_stock_id, ss.lot_id, ss.qty_on_hand, l.lot_no, l.expired_date, l.unit_cost
     FROM store_stock ss
     JOIN drug_lots l ON l.lot_id = ss.lot_id
     WHERE ss.store_id = ? AND ss.drug_id = ? AND ss.qty_on_hand > 0
     ORDER BY l.expired_date ASC
     FOR UPDATE`,
    [storeId, drugId]
  );

  const totalAvailable = lots.reduce((sum, l) => sum + Number(l.qty_on_hand), 0);
  let remaining = Number(qty);
  if (totalAvailable < remaining) {
    const err = new Error(`สต๊อกรวมทุก Lot ไม่พอ (คงเหลือรวม ${totalAvailable}, ต้องการ ${remaining})`);
    err.code = 'INSUFFICIENT_STOCK';
    throw err;
  }

  const allocations = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(Number(lot.qty_on_hand), remaining);
    if (take <= 0) continue;

    const balance = await adjustStock(conn, {
      storeId, drugId, lotId: lot.lot_id, qtyDelta: -take
    });
    await recordTransaction(conn, {
      storeId, drugId, lotId: lot.lot_id, type: 'ISSUE', qty: -take,
      unitCost: lot.unit_cost, balanceAfter: balance, refType, refId, userId
    });

    allocations.push({
      lotId: lot.lot_id, lotNo: lot.lot_no, expiredDate: lot.expired_date,
      qtyTaken: take, balanceAfter: balance
    });
    remaining -= take;
  }

  return allocations;
}

// รับสินค้าเข้า Store ปลายทางตาม Transfer ที่ระบุ (ใช้ร่วมกันทั้งการรับผ่านหน้า Transfer ปกติ
// และการยืนยันรับผ่านลิงก์ติดตามการจัดส่ง/Delivery Tracking แบบไม่ต้อง login)
// userId: user_id ที่จะถูกบันทึกใน stock_transactions.user_id (ต้องเป็นค่าที่มีอยู่จริงในตาราง users เสมอ)
// receivedByName: ถ้าระบุ (เช่น ชื่อคนที่ปลายทางกรอกตอนกดยืนยันผ่านลิงก์) จะถูกต่อท้ายไว้ใน remark ของ Transfer
async function receiveTransferGoods(conn, { transferId, userId, receivedByName }) {
  const [[transfer]] = await conn.query(`SELECT * FROM transfers WHERE transfer_id = ? FOR UPDATE`, [transferId]);
  if (!transfer) {
    const err = new Error('ไม่พบรายการ Transfer');
    err.status = 404;
    throw err;
  }
  if (transfer.status !== 'TRANSFER_PENDING') {
    const err = new Error('รายการนี้ไม่ได้อยู่ในสถานะรอรับ (Transfer Pending)');
    err.status = 400;
    throw err;
  }

  const [items] = await conn.query(`SELECT * FROM transfer_items WHERE transfer_id = ?`, [transferId]);
  for (const it of items) {
    const lotId = await findOrCreateLot(conn, {
      drugId: it.drug_id, lotNo: it.lot_no, expiredDate: it.expired_date, unitCost: it.unit_cost
    });
    const balance = await adjustStock(conn, {
      storeId: transfer.to_store_id, drugId: it.drug_id, lotId, qtyDelta: Number(it.qty_transfer),
      sourceStoreId: transfer.from_store_id
    });
    await recordTransaction(conn, {
      storeId: transfer.to_store_id, drugId: it.drug_id, lotId, type: 'TRANSFER_IN',
      qty: Number(it.qty_transfer), unitCost: it.unit_cost, balanceAfter: balance,
      refType: 'TRANSFER', refId: transferId, userId
    });
    await conn.query(`UPDATE transfer_items SET qty_received = ? WHERE transfer_item_id = ?`, [it.qty_transfer, it.transfer_item_id]);
  }

  if (receivedByName !== undefined && receivedByName !== null) {
    await conn.query(
      `UPDATE transfers SET status='RECEIVED', received_by=?, received_at=NOW(),
              remark = CONCAT(COALESCE(remark, ''), ?)
       WHERE transfer_id=?`,
      [userId, ` [ยืนยันรับโดย: ${receivedByName.trim() || 'ไม่ระบุชื่อ'} ผ่านลิงก์ติดตามการจัดส่ง]`, transferId]
    );
  } else {
    await conn.query(`UPDATE transfers SET status='RECEIVED', received_by=?, received_at=NOW() WHERE transfer_id=?`, [userId, transferId]);
  }

  return { transfer, items };
}

// หัก Stock ต้นทางสำหรับ 1 รายการยาใน Transfer ตอน submit ทันที (ใช้ร่วมกันทั้งสร้าง Transfer ปกติ
// และตอน "จัดใบขอเบิก" อัตโนมัติจาก Replenishment Request) - คืนค่า lot_id ที่ใช้จริง
async function submitTransferOutItem(conn, { transferId, fromStoreId, drugId, lotNo, expiredDate, unitCost, qty, userId }) {
  const lotId = await findOrCreateLot(conn, { drugId, lotNo, expiredDate, unitCost });
  const balance = await adjustStock(conn, { storeId: fromStoreId, drugId, lotId, qtyDelta: -Number(qty) });
  await recordTransaction(conn, {
    storeId: fromStoreId, drugId, lotId, type: 'TRANSFER_OUT', qty: -Number(qty),
    unitCost, balanceAfter: balance, refType: 'TRANSFER', refId: transferId, userId
  });
  return lotId;
}

// ดูตัวอย่างการจัดสรรแบบ FEFO (ใกล้หมดอายุก่อน) แบบ "อ่านอย่างเดียว" ไม่หักสต๊อกจริง
// ใช้ตอน preview ก่อนยืนยัน "จัดใบขอเบิก" ให้เภสัชกรเห็นก่อนว่าจะได้ Lot ไหน/พอไหม
async function previewFefoAllocation(conn, { storeId, drugId, qty }) {
  const [lots] = await conn.query(
    `SELECT ss.lot_id, ss.qty_on_hand, l.lot_no, l.expired_date, l.unit_cost
     FROM store_stock ss JOIN drug_lots l ON l.lot_id = ss.lot_id
     WHERE ss.store_id = ? AND ss.drug_id = ? AND ss.qty_on_hand > 0
     ORDER BY l.expired_date ASC
     FOR UPDATE`,
    [storeId, drugId]
  );
  let remaining = Number(qty);
  const allocations = [];
  const totalAvailable = lots.reduce((sum, l) => sum + Number(l.qty_on_hand), 0);
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(Number(lot.qty_on_hand), remaining);
    if (take <= 0) continue;
    allocations.push({ lotId: lot.lot_id, lotNo: lot.lot_no, expiredDate: lot.expired_date, unitCost: lot.unit_cost, qty: take });
    remaining -= take;
  }
  return { allocations, totalAvailable, shortfall: Math.max(0, remaining) };
}

module.exports = {
  findOrCreateLot, adjustStock, recordTransaction, generateDocNo, generateAutoLotNo, allocateFefoIssue,
  receiveTransferGoods, submitTransferOutItem, previewFefoAllocation
};
