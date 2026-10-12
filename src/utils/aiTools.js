// ----------------------------------------------------------------------------
// ชุด "เครื่องมือ" (Tools) ที่ AI Assistant สามารถเรียกใช้เพื่อดึงข้อมูล Stock จริง
// จากฐานข้อมูล (ผ่าน Claude API Tool Use / Function Calling)
//
// หลักการความปลอดภัย: AI ไม่สามารถเขียน SQL เองได้ และไม่สามารถแก้ไขข้อมูลใดๆ ได้
// (เครื่องมือทั้งหมดเป็น READ-ONLY) ทุกเครื่องมือจะถูกจำกัดขอบเขต Store ตามสิทธิ์ของ
// ผู้ใช้งานที่ login อยู่จริงเสมอ (เหมือนกับหน้า Reports/Stock ปกติ) - ไม่ใช่การพึ่งพา
// ให้ AI "สัญญา" ว่าจะเคารพสิทธิ์ แต่บังคับด้วยโค้ดฝั่ง Server ทุกครั้ง
// ----------------------------------------------------------------------------

const pool = require('../config/db');
const { isAdminRole, canAccessStore } = require('../middleware/auth');

function accessibleStoreIds(user) {
  if (isAdminRole(user.role_code)) return null; // null = ทุก store
  return (user.stores || []).map(s => s.store_id);
}

// เงื่อนไข WHERE ที่จำกัดตาม store ที่ผู้ใช้งานเข้าถึงได้ (ใช้ alias คอลัมน์ store_id)
function storeScopeClause(user, alias, requestedStoreId) {
  const where = [];
  const params = [];
  if (requestedStoreId) {
    if (!canAccessStore(user, requestedStoreId)) {
      throw Object.assign(new Error('ไม่มีสิทธิ์เข้าถึง Store นี้'), { toolError: true });
    }
    where.push(`${alias} = ?`);
    params.push(requestedStoreId);
    return { where, params };
  }
  const ids = accessibleStoreIds(user);
  if (ids) {
    if (ids.length === 0) { where.push('1=0'); }
    else { where.push(`${alias} IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  }
  return { where, params };
}

// ---------------------------------------------------------------------------
// คำจำกัดความ Tool (JSON Schema) ที่จะส่งให้ Claude API รู้จัก
// ---------------------------------------------------------------------------
const TOOL_DEFS = [
  {
    name: 'list_stores',
    description: 'แสดงรายชื่อ Store ทั้งหมดที่ผู้ใช้งานคนนี้มีสิทธิ์เข้าถึง พร้อม store_id, ชื่อ, ประเภท',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'search_drug',
    description: 'ค้นหายาในระบบด้วยชื่อหรือรหัสยา (บางส่วนก็ได้) คืนค่ารหัสยา ชื่อยา หน่วยนับ',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'คำค้นหา เช่น ชื่อยาหรือรหัสยาบางส่วน' } },
      required: ['query']
    }
  },
  {
    name: 'get_stock',
    description: 'ดูยอดคงเหลือของยา แยกตาม Store และ Lot ถ้าไม่ระบุ storeId จะแสดงทุก Store ที่มีสิทธิ์เข้าถึง',
    input_schema: {
      type: 'object',
      properties: {
        drugQuery: { type: 'string', description: 'ชื่อหรือรหัสยา (บางส่วนก็ได้) - เว้นว่างเพื่อดูทุกยา' },
        storeId: { type: 'integer', description: 'store_id ที่ต้องการดู (ถ้าไม่ระบุจะดูทุก Store ที่มีสิทธิ์)' }
      }
    }
  },
  {
    name: 'get_near_expiry',
    description: 'ดูรายการยาใกล้หมดอายุหรือหมดอายุแล้ว เรียงจากเหลือเวลาน้อยที่สุด',
    input_schema: {
      type: 'object',
      properties: {
        storeId: { type: 'integer', description: 'store_id ที่ต้องการดู (ไม่ระบุ = ทุก Store ที่มีสิทธิ์)' },
        days: { type: 'integer', description: 'จำนวนวันขอบเขต Near-Expiry (ค่าเริ่มต้น 90 วัน)' }
      }
    }
  },
  {
    name: 'get_below_min',
    description: 'ดูรายการยาที่ยอดคงเหลือต่ำกว่าค่า Minimum Stock ที่ตั้งไว้',
    input_schema: {
      type: 'object',
      properties: { storeId: { type: 'integer', description: 'store_id ที่ต้องการดู (ไม่ระบุ = ทุก Store ที่มีสิทธิ์)' } }
    }
  },
  {
    name: 'get_movement_summary',
    description: 'สรุปยอดรวมการเคลื่อนไหวสต๊อก (รับเข้า/จ่ายออก/โอนย้าย) ของยา ภายในช่วงวันที่ย้อนหลัง ใช้วิเคราะห์แนวโน้มการใช้ยา',
    input_schema: {
      type: 'object',
      properties: {
        drugQuery: { type: 'string', description: 'ชื่อหรือรหัสยา (บางส่วนก็ได้) - เว้นว่างเพื่อดูทุกยา' },
        storeId: { type: 'integer', description: 'store_id ที่ต้องการดู (ไม่ระบุ = ทุก Store ที่มีสิทธิ์)' },
        days: { type: 'integer', description: 'จำนวนวันย้อนหลัง (ค่าเริ่มต้น 30 วัน)' }
      }
    }
  },
  {
    name: 'get_pending_transfers',
    description: 'ดูรายการ Transfer ที่ยังไม่ถูกรับ (สถานะ "รอรับสินค้า" / TRANSFER_PENDING) หรือยังเป็น Draft อยู่ ใช้ตอบคำถามเช่น "Store ไหนยังไม่รับ Transfer" หรือ "รายการที่ค้างสถานะ Pending"',
    input_schema: {
      type: 'object',
      properties: {
        storeId: { type: 'integer', description: 'store_id ที่ต้องการดู (ไม่ระบุ = ทุก Store ที่มีสิทธิ์)' },
        includeDraft: { type: 'boolean', description: 'รวมรายการที่ยังเป็น Draft (ยังไม่ส่งออก) ด้วยหรือไม่ ค่าเริ่มต้น false (ดูเฉพาะที่รอรับจริง)' }
      }
    }
  }
];

// ---------------------------------------------------------------------------
// การทำงานจริงของแต่ละ Tool (ทุกฟังก์ชันรับ user object จาก session เพื่อบังคับสิทธิ์)
// ---------------------------------------------------------------------------
async function list_stores(user) {
  const ids = accessibleStoreIds(user);
  let sql = `SELECT store_id, store_code, store_name, store_type FROM stores WHERE is_active = 1`;
  const params = [];
  if (ids) {
    if (ids.length === 0) return [];
    sql += ` AND store_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  }
  sql += ` ORDER BY store_type, store_name`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function search_drug(user, { query }) {
  const [rows] = await pool.query(
    `SELECT drug_id, drug_code, drug_name, strength_form, unit FROM drug_master
     WHERE is_active = 1 AND (drug_name LIKE ? OR drug_code LIKE ?) LIMIT 20`,
    [`%${query}%`, `%${query}%`]
  );
  return rows;
}

async function get_stock(user, { drugQuery, storeId } = {}) {
  const { where, params } = storeScopeClause(user, 'v.store_id', storeId);
  if (drugQuery) {
    where.push('(v.drug_name LIKE ? OR v.drug_code LIKE ?)');
    params.push(`%${drugQuery}%`, `%${drugQuery}%`);
  }
  const sql = `
    SELECT v.store_name, v.drug_code, v.drug_name, v.unit, v.lot_no, v.expired_date,
           v.qty_on_hand, v.days_to_expire
    FROM v_store_stock_detail v
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY v.store_name, v.drug_name, v.expired_date
    LIMIT 100`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function get_near_expiry(user, { storeId, days } = {}) {
  const { where, params } = storeScopeClause(user, 'store_id', storeId);
  const limitDays = Number(days) || 90;
  where.push('days_to_expire <= ?');
  params.push(limitDays);
  const sql = `
    SELECT store_name, drug_code, drug_name, lot_no, expired_date, days_to_expire, qty_on_hand, expiry_status
    FROM v_expiry_alert
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY days_to_expire ASC
    LIMIT 100`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function get_below_min(user, { storeId } = {}) {
  const { where, params } = storeScopeClause(user, 'store_id', storeId);
  where.push(`stock_status = 'BELOW_MIN'`);
  const sql = `
    SELECT store_name, drug_code, drug_name, qty_on_hand, min_qty, max_qty
    FROM v_stock_min_max_alert
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY store_name, drug_name
    LIMIT 100`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function get_movement_summary(user, { drugQuery, storeId, days } = {}) {
  const { where, params } = storeScopeClause(user, 'tx.store_id', storeId);
  const limitDays = Number(days) || 30;
  where.push('tx.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)');
  params.push(limitDays);
  if (drugQuery) {
    where.push('(d.drug_name LIKE ? OR d.drug_code LIKE ?)');
    params.push(`%${drugQuery}%`, `%${drugQuery}%`);
  }
  const sql = `
    SELECT d.drug_code, d.drug_name, tx.transaction_type, SUM(tx.qty) AS total_qty, COUNT(*) AS tx_count
    FROM stock_transactions tx
    JOIN drug_master d ON d.drug_id = tx.drug_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY d.drug_id, tx.transaction_type
    ORDER BY d.drug_name
    LIMIT 200`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

// รายการ Transfer ที่ยังไม่ถูกรับ (TRANSFER_PENDING) หรือยังเป็น Draft - จำกัดเฉพาะ Store ที่ผู้ใช้งานเข้าถึงได้
// (เข้าถึงได้ถ้าเป็น Store ต้นทางหรือปลายทางของ Transfer นั้น เหมือนหน้า Transfer ปกติ)
async function get_pending_transfers(user, { storeId, includeDraft } = {}) {
  if (storeId && !canAccessStore(user, storeId)) {
    throw Object.assign(new Error('ไม่มีสิทธิ์เข้าถึง Store นี้'), { toolError: true });
  }
  const where = [];
  const params = [];
  const statuses = includeDraft ? ['DRAFT', 'TRANSFER_PENDING'] : ['TRANSFER_PENDING'];
  where.push(`t.status IN (${statuses.map(() => '?').join(',')})`);
  params.push(...statuses);

  if (storeId) {
    where.push('(t.from_store_id = ? OR t.to_store_id = ?)');
    params.push(storeId, storeId);
  } else {
    const ids = accessibleStoreIds(user);
    if (ids) {
      if (ids.length === 0) where.push('1=0');
      else {
        where.push(`(t.from_store_id IN (${ids.map(() => '?').join(',')}) OR t.to_store_id IN (${ids.map(() => '?').join(',')}))`);
        params.push(...ids, ...ids);
      }
    }
  }

  const sql = `
    SELECT t.transfer_no, t.status, fs.store_name AS from_store, ts.store_name AS to_store,
           uc.full_name AS created_by, t.created_at, t.sent_at,
           (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = t.transfer_id) AS item_count,
           DATEDIFF(NOW(), COALESCE(t.sent_at, t.created_at)) AS days_waiting
    FROM transfers t
    JOIN stores fs ON fs.store_id = t.from_store_id
    JOIN stores ts ON ts.store_id = t.to_store_id
    JOIN users uc ON uc.user_id = t.created_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.created_at ASC
    LIMIT 100`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

const TOOL_IMPLS = { list_stores, search_drug, get_stock, get_near_expiry, get_below_min, get_movement_summary, get_pending_transfers };

async function runTool(name, user, input) {
  const fn = TOOL_IMPLS[name];
  if (!fn) throw new Error(`ไม่รู้จักเครื่องมือ: ${name}`);
  return fn(user, input || {});
}

module.exports = { TOOL_DEFS, runTool };
