const ExcelJS = require('exceljs');
const pool = require('../config/db');
const { canAccessStore, isAdminRole } = require('../middleware/auth');

function accessibleStoreIds(user) {
  if (isAdminRole(user.role_code)) return null; // null = ทุก store
  return user.stores.map(s => s.store_id);
}

function buildStoreFilter(user, storeId, alias = 'st') {
  const where = [];
  const params = [];
  const storeIds = accessibleStoreIds(user);

  if (storeId) {
    if (!canAccessStore(user, storeId)) throw Object.assign(new Error('ไม่มีสิทธิ์เข้าถึง Store นี้'), { status: 403 });
    where.push(`${alias}.store_id = ?`);
    params.push(storeId);
  } else if (storeIds) {
    if (storeIds.length === 0) { where.push('1=0'); }
    else { where.push(`${alias}.store_id IN (${storeIds.map(() => '?').join(',')})`); params.push(...storeIds); }
  }
  return { where, params };
}

// ---------------------------------------------------------------
// ฟังก์ชันดึงข้อมูลของแต่ละรายงาน (ใช้ร่วมกันทั้งหน้าจอ JSON และ Export Excel)
// ---------------------------------------------------------------

// รายงาน Stock Movement (รวม รับเข้า/จ่ายออก/Transfer/ปรับปรุง) - ledger เต็มรูปแบบ
async function getMovementRows(req) {
  const { storeId, type, drugId, from, to } = req.query;
  const { where, params } = buildStoreFilter(req.session.user, storeId, 'tx');

  if (type) { where.push('tx.transaction_type = ?'); params.push(type); }
  if (drugId) { where.push('tx.drug_id = ?'); params.push(drugId); }
  if (from) { where.push('DATE(tx.created_at) >= ?'); params.push(from); }
  if (to) { where.push('DATE(tx.created_at) <= ?'); params.push(to); }

  const sql = `
    SELECT tx.transaction_id, tx.created_at, s.store_name, s.store_code,
           d.drug_code, d.drug_name, d.unit, l.lot_no, l.expired_date,
           tx.transaction_type, tx.qty, tx.unit_cost,
           ROUND(ABS(tx.qty) * tx.unit_cost, 2) AS value,
           tx.balance_after, u.full_name AS user_name, tx.ref_type, tx.ref_id
    FROM stock_transactions tx
    JOIN stores s ON s.store_id = tx.store_id
    JOIN drug_master d ON d.drug_id = tx.drug_id
    JOIN drug_lots l ON l.lot_id = tx.lot_id
    JOIN users u ON u.user_id = tx.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY tx.created_at DESC
    LIMIT 5000`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function getTransferRows(req) {
  const user = req.session.user;
  const { storeId, from, to, direction } = req.query;
  const where = [];
  const params = [];
  const storeIds = accessibleStoreIds(user);

  if (storeId) {
    if (!canAccessStore(user, storeId)) throw Object.assign(new Error('ไม่มีสิทธิ์เข้าถึง Store นี้'), { status: 403 });
    if (direction === 'in') { where.push('t.to_store_id = ?'); params.push(storeId); }
    else if (direction === 'out') { where.push('t.from_store_id = ?'); params.push(storeId); }
    else { where.push('(t.from_store_id = ? OR t.to_store_id = ?)'); params.push(storeId, storeId); }
  } else if (storeIds) {
    if (storeIds.length === 0) where.push('1=0');
    else {
      where.push(`(t.from_store_id IN (${storeIds.map(() => '?').join(',')}) OR t.to_store_id IN (${storeIds.map(() => '?').join(',')}))`);
      params.push(...storeIds, ...storeIds);
    }
  }
  if (from) { where.push('DATE(t.created_at) >= ?'); params.push(from); }
  if (to) { where.push('DATE(t.created_at) <= ?'); params.push(to); }

  const [rows] = await pool.query(
    `SELECT t.transfer_no, t.status, t.created_at, t.sent_at, t.received_at,
            fs.store_name AS from_store, ts.store_name AS to_store,
            uc.full_name AS created_by, ur.full_name AS received_by,
            (SELECT SUM(ti.qty_transfer) FROM transfer_items ti WHERE ti.transfer_id=t.transfer_id) AS total_qty,
            (SELECT SUM(ti.qty_transfer * ti.unit_cost) FROM transfer_items ti WHERE ti.transfer_id=t.transfer_id) AS total_value
     FROM transfers t
     JOIN stores fs ON fs.store_id = t.from_store_id
     JOIN stores ts ON ts.store_id = t.to_store_id
     JOIN users uc ON uc.user_id = t.created_by
     LEFT JOIN users ur ON ur.user_id = t.received_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.created_at DESC LIMIT 2000`,
    params
  );
  return rows;
}

async function getStockBalanceRows(req) {
  const user = req.session.user;
  const { storeId } = req.query;
  const storeIds = accessibleStoreIds(user);
  const where = [];
  const params = [];
  if (storeId) {
    if (!canAccessStore(user, storeId)) throw Object.assign(new Error('ไม่มีสิทธิ์เข้าถึง Store นี้'), { status: 403 });
    where.push('store_id = ?'); params.push(storeId);
  } else if (storeIds) {
    if (storeIds.length === 0) where.push('1=0');
    else { where.push(`store_id IN (${storeIds.map(() => '?').join(',')})`); params.push(...storeIds); }
  }
  const [rows] = await pool.query(
    `SELECT store_id, store_code, store_name, drug_id, drug_code, drug_name, unit, group_name,
            SUM(qty_on_hand) AS qty_on_hand, SUM(stock_value) AS stock_value,
            MIN(days_to_expire) AS nearest_expire_days
     FROM v_store_stock_detail
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     GROUP BY store_id, drug_id
     ORDER BY store_name, drug_name`,
    params
  );
  return rows;
}

async function getStockByLotRows(req) {
  const { where, params } = buildStoreFilter(req.session.user, req.query.storeId, 'v');
  const [rows] = await pool.query(
    `SELECT v.* FROM v_store_stock_detail v
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY store_name, drug_name, expired_date`,
    params
  );
  return rows;
}

async function getNearExpiryRows(req) {
  const { where, params } = buildStoreFilter(req.session.user, req.query.storeId, 'v');
  const sql = `SELECT * FROM v_expiry_alert v ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY days_to_expire ASC`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

// ---------------------------------------------------------------
// Route handlers (JSON) - แสดงผลบนหน้าเว็บ
// ---------------------------------------------------------------

exports.stockMovement = async (req, res) => {
  try {
    res.json(await getMovementRows(req));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

exports.transferReport = async (req, res) => {
  try {
    res.json(await getTransferRows(req));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

exports.stockBalance = async (req, res) => {
  try {
    res.json(await getStockBalanceRows(req));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

exports.stockByLot = async (req, res) => {
  try {
    res.json(await getStockByLotRows(req));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

exports.nearExpiry = async (req, res) => {
  try {
    res.json(await getNearExpiryRows(req));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------
// Export เป็น Excel - รองรับทุกประเภทรายงาน
// ---------------------------------------------------------------

const REPORT_DEFS = {
  movement: {
    fetch: getMovementRows,
    sheetName: 'Stock Movement',
    columns: [
      { header: 'วันที่/เวลา', key: 'created_at', width: 20 },
      { header: 'Store', key: 'store_name', width: 20 },
      { header: 'รหัสยา', key: 'drug_code', width: 14 },
      { header: 'ชื่อยา', key: 'drug_name', width: 30 },
      { header: 'หน่วย', key: 'unit', width: 10 },
      { header: 'Lot', key: 'lot_no', width: 14 },
      { header: 'Expired', key: 'expired_date', width: 14 },
      { header: 'ประเภท', key: 'transaction_type', width: 16 },
      { header: 'จำนวน', key: 'qty', width: 12 },
      { header: 'ราคาต้นทุน', key: 'unit_cost', width: 14 },
      { header: 'มูลค่า', key: 'value', width: 14 },
      { header: 'คงเหลือหลังทำรายการ', key: 'balance_after', width: 18 },
      { header: 'ผู้ทำรายการ', key: 'user_name', width: 18 }
    ]
  },
  transfers: {
    fetch: getTransferRows,
    sheetName: 'Transfer Report',
    columns: [
      { header: 'เลขที่ Transfer', key: 'transfer_no', width: 20 },
      { header: 'สถานะ', key: 'status', width: 16 },
      { header: 'จาก Store', key: 'from_store', width: 22 },
      { header: 'ถึง Store', key: 'to_store', width: 22 },
      { header: 'จำนวนรวม', key: 'total_qty', width: 14 },
      { header: 'มูลค่ารวม', key: 'total_value', width: 14 },
      { header: 'สร้างโดย', key: 'created_by', width: 18 },
      { header: 'รับโดย', key: 'received_by', width: 18 },
      { header: 'วันที่สร้าง', key: 'created_at', width: 20 },
      { header: 'วันที่ส่ง', key: 'sent_at', width: 20 },
      { header: 'วันที่รับ', key: 'received_at', width: 20 }
    ]
  },
  'stock-balance': {
    fetch: getStockBalanceRows,
    sheetName: 'Stock Balance',
    columns: [
      { header: 'Store', key: 'store_name', width: 22 },
      { header: 'รหัสยา', key: 'drug_code', width: 14 },
      { header: 'ชื่อยา', key: 'drug_name', width: 30 },
      { header: 'กลุ่มยา', key: 'group_name', width: 18 },
      { header: 'หน่วย', key: 'unit', width: 10 },
      { header: 'คงเหลือ', key: 'qty_on_hand', width: 14 },
      { header: 'มูลค่า', key: 'stock_value', width: 14 },
      { header: 'วันใกล้หมดอายุที่สุด', key: 'nearest_expire_days', width: 20 }
    ]
  },
  'stock-by-lot': {
    fetch: getStockByLotRows,
    sheetName: 'Stock By Lot',
    columns: [
      { header: 'Store', key: 'store_name', width: 22 },
      { header: 'รหัสยา', key: 'drug_code', width: 14 },
      { header: 'ชื่อยา', key: 'drug_name', width: 30 },
      { header: 'Lot', key: 'lot_no', width: 16 },
      { header: 'Expired', key: 'expired_date', width: 14 },
      { header: 'คงเหลือ', key: 'qty_on_hand', width: 14 },
      { header: 'ราคาต้นทุน', key: 'unit_cost', width: 14 },
      { header: 'มูลค่า', key: 'stock_value', width: 14 },
      { header: 'Min', key: 'min_qty', width: 10 },
      { header: 'Max', key: 'max_qty', width: 10 }
    ]
  },
  'near-expiry': {
    fetch: getNearExpiryRows,
    sheetName: 'Near Expiry - Expired',
    columns: [
      { header: 'Store', key: 'store_name', width: 22 },
      { header: 'รหัสยา', key: 'drug_code', width: 14 },
      { header: 'ชื่อยา', key: 'drug_name', width: 30 },
      { header: 'Lot', key: 'lot_no', width: 16 },
      { header: 'Expired', key: 'expired_date', width: 14 },
      { header: 'จำนวนวัน', key: 'days_to_expire', width: 12 },
      { header: 'คงเหลือ', key: 'qty_on_hand', width: 14 },
      { header: 'สถานะ', key: 'expiry_status', width: 16 }
    ]
  }
};

exports.exportReport = async (req, res) => {
  try {
    const type = req.params.type;
    const def = REPORT_DEFS[type];
    if (!def) return res.status(400).json({ error: 'ไม่รู้จักประเภทรายงานนี้' });

    const rows = await def.fetch(req);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(def.sheetName);
    sheet.columns = def.columns;
    sheet.getRow(1).font = { bold: true };
    rows.forEach(r => sheet.addRow(r));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_report.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
