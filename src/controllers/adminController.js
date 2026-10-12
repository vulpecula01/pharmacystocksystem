const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { logAudit } = require('../utils/audit');

// ---------- Stores ----------
exports.listStores = async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM stores ORDER BY store_type, store_name`);
  res.json(rows);
};

exports.createStore = async (req, res) => {
  try {
    const { storeCode, storeName, storeType, location } = req.body;
    const [result] = await pool.query(
      `INSERT INTO stores (store_code, store_name, store_type, location) VALUES (?,?,?,?)`,
      [storeCode, storeName, storeType, location || null]
    );
    await logAudit({ userId: req.session.user.user_id, username: req.session.user.username, action: 'CREATE_STORE', entityType: 'STORE', entityId: result.insertId, ip: req.ip });
    res.json({ storeId: result.insertId });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.updateStore = async (req, res) => {
  try {
    const { storeName, storeType, location, isActive } = req.body;
    await pool.query(
      `UPDATE stores SET store_name=?, store_type=?, location=?, is_active=? WHERE store_id=?`,
      [storeName, storeType, location || null, isActive ? 1 : 0, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

// ---------- Drug groups ----------
exports.listDrugGroups = async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM drug_groups ORDER BY group_name`);
  res.json(rows);
};
exports.createDrugGroup = async (req, res) => {
  try {
    const [result] = await pool.query(`INSERT INTO drug_groups (group_name) VALUES (?)`, [req.body.groupName]);
    res.json({ drugGroupId: result.insertId });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

// ---------- Drug master ----------
exports.listAllDrugs = async (req, res) => {
  const [rows] = await pool.query(
    `SELECT d.*, dg.group_name FROM drug_master d LEFT JOIN drug_groups dg ON dg.drug_group_id=d.drug_group_id ORDER BY d.drug_name`
  );
  res.json(rows);
};

exports.createDrug = async (req, res) => {
  try {
    const { drugCode, drugName, strengthForm, unit, drugGroupId } = req.body;
    if (!drugCode || drugCode.length > 14) return res.status(400).json({ error: 'รหัสยาต้องไม่เกิน 14 หลัก' });
    const [result] = await pool.query(
      `INSERT INTO drug_master (drug_code, drug_name, strength_form, unit, drug_group_id) VALUES (?,?,?,?,?)`,
      [drugCode, drugName, strengthForm || null, unit, drugGroupId || null]
    );
    await logAudit({ userId: req.session.user.user_id, username: req.session.user.username, action: 'CREATE_DRUG', entityType: 'DRUG', entityId: result.insertId, ip: req.ip });
    res.json({ drugId: result.insertId });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

exports.updateDrug = async (req, res) => {
  try {
    const { drugName, strengthForm, unit, drugGroupId, isActive } = req.body;
    await pool.query(
      `UPDATE drug_master SET drug_name=?, strength_form=?, unit=?, drug_group_id=?, is_active=? WHERE drug_id=?`,
      [drugName, strengthForm || null, unit, drugGroupId || null, isActive ? 1 : 0, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

// ---------- Store drug config (Min/Max/Avg Usage) ----------
exports.listConfig = async (req, res) => {
  const { storeId } = req.query;
  const [rows] = await pool.query(
    `SELECT cfg.*, d.drug_code, d.drug_name, d.unit
     FROM store_drug_config cfg JOIN drug_master d ON d.drug_id=cfg.drug_id
     WHERE cfg.store_id = ? ORDER BY d.drug_name`,
    [storeId]
  );
  res.json(rows);
};

exports.upsertConfig = async (req, res) => {
  try {
    const { storeId, drugId, minQty, maxQty, avgUsage } = req.body;
    await pool.query(
      `INSERT INTO store_drug_config (store_id, drug_id, min_qty, max_qty, avg_usage)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE min_qty=VALUES(min_qty), max_qty=VALUES(max_qty), avg_usage=VALUES(avg_usage)`,
      [storeId, drugId, minQty || 0, maxQty || 0, avgUsage || 0]
    );
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

// ---------- Users ----------
exports.listUsers = async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.user_id, u.username, u.full_name, u.email, u.is_active, r.role_code, r.role_name,
            GROUP_CONCAT(s.store_name SEPARATOR ', ') AS stores
     FROM users u
     JOIN roles r ON r.role_id = u.role_id
     LEFT JOIN user_store_access usa ON usa.user_id = u.user_id
     LEFT JOIN stores s ON s.store_id = usa.store_id
     GROUP BY u.user_id ORDER BY u.username`
  );
  res.json(rows);
};

exports.listRoles = async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM roles`);
  // Pharmacy Admin ธรรมดา ห้ามเห็น/มอบสิทธิ์ระดับ Super Admin ให้ใครได้ - ป้องกันการยกระดับสิทธิ์ตัวเอง
  if (req.session.user.role_code !== 'SUPER_ADMIN') {
    return res.json(rows.filter(r => r.role_code !== 'SUPER_ADMIN'));
  }
  res.json(rows);
};

// ป้องกันการยกระดับสิทธิ์: เฉพาะ Super Admin เท่านั้นที่สร้าง/แก้ไข user ให้เป็น Super Admin หรือ Pharmacy Admin ได้
// Pharmacy Admin ธรรมดาสร้างได้แค่ระดับ Store User เท่านั้น
async function assertRoleAssignable(req, roleId) {
  if (req.session.user.role_code === 'SUPER_ADMIN') return; // ทำได้ทุกระดับ
  const [[role]] = await pool.query(`SELECT role_code FROM roles WHERE role_id = ?`, [roleId]);
  if (!role) throw Object.assign(new Error('ไม่พบ Role ที่ระบุ'), { status: 400 });
  if (role.role_code !== 'STORE_USER') {
    throw Object.assign(new Error('เฉพาะ Super Admin เท่านั้นที่สามารถกำหนดสิทธิ์ระดับ Admin ได้'), { status: 403 });
  }
}

exports.createUser = async (req, res) => {
  try {
    const { username, password, fullName, email, roleId, storeIds } = req.body;
    await assertRoleAssignable(req, roleId);
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      `INSERT INTO users (username, password_hash, full_name, email, role_id) VALUES (?,?,?,?,?)`,
      [username, hash, fullName, email || null, roleId]
    );
    const userId = result.insertId;
    if (Array.isArray(storeIds)) {
      for (const sid of storeIds) {
        await pool.query(`INSERT INTO user_store_access (user_id, store_id) VALUES (?,?)`, [userId, sid]);
      }
    }
    await logAudit({ userId: req.session.user.user_id, username: req.session.user.username, action: 'CREATE_USER', entityType: 'USER', entityId: userId, ip: req.ip });
    res.json({ userId });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
};

exports.updateUser = async (req, res) => {
  try {
    const { fullName, email, roleId, isActive, password } = req.body;
    await assertRoleAssignable(req, roleId);
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query(`UPDATE users SET full_name=?, email=?, role_id=?, is_active=?, password_hash=? WHERE user_id=?`,
        [fullName, email || null, roleId, isActive ? 1 : 0, hash, req.params.id]);
    } else {
      await pool.query(`UPDATE users SET full_name=?, email=?, role_id=?, is_active=? WHERE user_id=?`,
        [fullName, email || null, roleId, isActive ? 1 : 0, req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
};

exports.setUserStoreAccess = async (req, res) => {
  try {
    const userId = req.params.id;
    const { storeIds } = req.body;
    await pool.query(`DELETE FROM user_store_access WHERE user_id=?`, [userId]);
    if (Array.isArray(storeIds)) {
      for (const sid of storeIds) {
        await pool.query(`INSERT INTO user_store_access (user_id, store_id) VALUES (?,?)`, [userId, sid]);
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

// ดึงข้อมูล user คนเดียว พร้อม Store ที่เข้าถึงได้ (ใช้เปิดฟอร์มแก้ไข)
exports.getUser = async (req, res) => {
  try {
    const [[user]] = await pool.query(
      `SELECT u.user_id, u.username, u.full_name, u.email, u.is_active, u.role_id, r.role_code, r.role_name
       FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ?`,
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'ไม่พบ User นี้' });
    const [storeAccess] = await pool.query(`SELECT store_id FROM user_store_access WHERE user_id = ?`, [req.params.id]);
    user.storeIds = storeAccess.map(s => s.store_id);
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ลบ User ถาวร - อนุญาตเฉพาะ user ที่ไม่เคยทำรายการอะไรในระบบเลย (ไม่มีประวัติผูกอยู่)
// เพื่อรักษาความถูกต้องของ Audit Trail / Stock Ledger ในอดีต ถ้าเคยทำรายการแล้วให้ใช้การ "ปิดการใช้งาน" แทน
exports.deleteUser = async (req, res) => {
  const userId = req.params.id;
  try {
    if (Number(userId) === Number(req.session.user.user_id)) {
      return res.status(400).json({ error: 'ไม่สามารถลบบัญชีที่ใช้งานอยู่ขณะนี้ได้' });
    }
    const [[txCount]] = await pool.query(`SELECT COUNT(*) AS cnt FROM stock_transactions WHERE user_id = ?`, [userId]);
    const [[transferCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM transfers WHERE created_by = ? OR received_by = ? OR cancelled_by = ?`,
      [userId, userId, userId]
    );
    if (Number(txCount.cnt) > 0 || Number(transferCount.cnt) > 0) {
      return res.status(400).json({
        error: 'ไม่สามารถลบ User นี้ได้เนื่องจากมีประวัติการทำรายการอยู่ในระบบ (เพื่อรักษาความถูกต้องของ Audit Trail) กรุณาใช้ปุ่ม "ปิดการใช้งาน" แทน'
      });
    }
    await pool.query(`DELETE FROM user_store_access WHERE user_id = ?`, [userId]);
    await pool.query(`DELETE FROM users WHERE user_id = ?`, [userId]);
    await logAudit({ userId: req.session.user.user_id, username: req.session.user.username, action: 'DELETE_USER', entityType: 'USER', entityId: Number(userId), ip: req.ip });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

// ---------- Audit log ----------
exports.listAuditLog = async (req, res) => {
  const { from, to, userId, action } = req.query;
  const where = [];
  const params = [];
  if (from) { where.push('DATE(created_at) >= ?'); params.push(from); }
  if (to) { where.push('DATE(created_at) <= ?'); params.push(to); }
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (action) { where.push('action = ?'); params.push(action); }
  const [rows] = await pool.query(
    `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 500`,
    params
  );
  res.json(rows);
};

// ---------- แก้ไข Lot (Lot No. / Expired Date / ราคาต้นทุน) - เฉพาะ Admin ----------
// หมายเหตุสำคัญ: Lot หนึ่งๆ (drug_id + lot_no + expired_date) เป็นข้อมูล "ก้อนยาจริง" ที่อาจถูกใช้ร่วมกัน
// หลาย Store พร้อมกัน (เช่น รับยาก้อนเดียวกันแล้วโอนกระจายไปหลายแผนก) การแก้ไขจึงมีผลกับทุก Store ที่ถือ Lot นี้อยู่
// เพราะ Lot No./วันหมดอายุ เป็นข้อเท็จจริงของก้อนยานั้น ไม่ใช่ข้อมูลเฉพาะของแต่ละ Store

// ดูรายละเอียด Lot + Store ที่ถือ Lot นี้อยู่ (ใช้แสดงคำเตือนก่อนแก้ไขจริง)
exports.getLotUsage = async (req, res) => {
  try {
    const lotId = req.params.id;
    const [[lot]] = await pool.query(
      `SELECT dl.*, dm.drug_code, dm.drug_name, dm.unit
       FROM drug_lots dl JOIN drug_master dm ON dm.drug_id = dl.drug_id
       WHERE dl.lot_id = ?`,
      [lotId]
    );
    if (!lot) return res.status(404).json({ error: 'ไม่พบ Lot นี้' });

    const [stores] = await pool.query(
      `SELECT ss.store_id, s.store_name, ss.qty_on_hand
       FROM store_stock ss JOIN stores s ON s.store_id = ss.store_id
       WHERE ss.lot_id = ? AND ss.qty_on_hand <> 0
       ORDER BY s.store_name`,
      [lotId]
    );
    res.json({ lot, stores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// แก้ไข Lot No. / Expired Date / ราคาต้นทุน ของ Lot ที่รับเข้าไปแล้ว
// ถ้าค่าใหม่ (lot_no + expired_date) ไปตรงกับ Lot อื่นที่มีอยู่แล้วของยาตัวเดียวกัน ระบบจะ "รวม" ยอดคงเหลือ
// เข้ากับ Lot เดิมนั้นให้อัตโนมัติ (แทนที่จะฝืนสร้างซ้ำ ซึ่งผิดกับ Unique Key ในฐานข้อมูล) และคง Lot เก่าไว้เป็นประวัติ (Audit Trail)
exports.updateLot = async (req, res) => {
  const user = req.session.user;
  const lotId = req.params.id;
  const { lotNo, expiredDate, unitCost } = req.body;
  if (!lotNo || !lotNo.trim() || !expiredDate) {
    return res.status(400).json({ error: 'กรุณาระบุ Lot No. และ Expired Date ให้ครบถ้วน' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[oldLot]] = await conn.query(`SELECT * FROM drug_lots WHERE lot_id = ? FOR UPDATE`, [lotId]);
    if (!oldLot) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบ Lot นี้' }); }

    const newLotNo = lotNo.trim();
    const newUnitCost = (unitCost === undefined || unitCost === null || unitCost === '') ? oldLot.unit_cost : Number(unitCost);

    // ไม่มีอะไรเปลี่ยนแปลงจริง (expired_date จาก DB คืนมาเป็น string 'YYYY-MM-DD' อยู่แล้ว เพราะตั้งค่า dateStrings:true ไว้)
    const oldExpiredStr = String(oldLot.expired_date).slice(0, 10);
    if (newLotNo === oldLot.lot_no && expiredDate === oldExpiredStr && Number(newUnitCost) === Number(oldLot.unit_cost)) {
      await conn.rollback();
      return res.json({ ok: true, merged: false, unchanged: true });
    }

    // เช็คว่าค่าใหม่ชนกับ Lot อื่นของยาตัวเดียวกันหรือไม่ (Unique key: drug_id + lot_no + expired_date)
    const [[conflict]] = await conn.query(
      `SELECT lot_id FROM drug_lots WHERE drug_id = ? AND lot_no = ? AND expired_date = ? AND lot_id <> ?`,
      [oldLot.drug_id, newLotNo, expiredDate, lotId]
    );

    let merged = false;
    let targetLotId = lotId;

    if (conflict) {
      // มี Lot ปลายทางอยู่แล้ว -> ย้ายยอดคงเหลือทุก Store จาก Lot เก่าไปรวมกับ Lot ปลายทาง
      merged = true;
      targetLotId = conflict.lot_id;

      const [oldStockRows] = await conn.query(
        `SELECT store_id, drug_id, qty_on_hand, source_store_id, received_date FROM store_stock WHERE lot_id = ?`,
        [lotId]
      );
      for (const row of oldStockRows) {
        await conn.query(
          `INSERT INTO store_stock (store_id, drug_id, lot_id, qty_on_hand, source_store_id, received_date)
           VALUES (?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
                                   received_date = GREATEST(COALESCE(received_date, VALUES(received_date)), COALESCE(VALUES(received_date), received_date))`,
          [row.store_id, row.drug_id, targetLotId, row.qty_on_hand, row.source_store_id, row.received_date]
        );
      }
      await conn.query(`DELETE FROM store_stock WHERE lot_id = ?`, [lotId]);
      // หมายเหตุ: Lot เก่า (lot_id เดิม) จะยังอยู่ในตาราง drug_lots เพื่อรักษาประวัติ stock_transactions ที่อ้างอิงถึง
      // (จะกลายเป็น Lot ที่มียอดคงเหลือ = 0 ในทุก Store แต่ยังดูประวัติย้อนหลังได้)
    } else {
      // ไม่ชนกับ Lot ไหน -> แก้ไขข้อมูล Lot เดิมได้โดยตรง
      await conn.query(
        `UPDATE drug_lots SET lot_no = ?, expired_date = ?, unit_cost = ? WHERE lot_id = ?`,
        [newLotNo, expiredDate, newUnitCost, lotId]
      );
    }

    await conn.commit();

    await logAudit({
      userId: user.user_id, username: user.username, action: merged ? 'MERGE_LOT' : 'UPDATE_LOT',
      entityType: 'DRUG_LOT', entityId: Number(lotId),
      detail: {
        from: { lotNo: oldLot.lot_no, expiredDate: oldLot.expired_date, unitCost: oldLot.unit_cost },
        to: { lotNo: newLotNo, expiredDate, unitCost: newUnitCost },
        merged, targetLotId
      },
      ip: req.ip
    });

    res.json({ ok: true, merged, targetLotId });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
};

// ---------- คลินิกปลายทาง (สำหรับระบบติดตามการส่งยา / Delivery Tracking) ----------
// คลินิกถูกเก็บเป็น Store ประเภท 'EXTERNAL_CLINIC' (ใช้ระบบ Transfer เดิมรับ-จ่ายสต๊อกได้ทันที)
// พร้อมข้อมูลเสริม (ที่อยู่/พิกัด/ระยะทาง/ความเร็วเฉลี่ย) เก็บแยกไว้ในตาราง clinic_details
exports.listClinics = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.store_id, s.store_code, s.store_name, s.is_active, cd.*
       FROM stores s LEFT JOIN clinic_details cd ON cd.store_id = s.store_id
       WHERE s.store_type = 'EXTERNAL_CLINIC'
       ORDER BY s.store_name`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.createClinic = async (req, res) => {
  const { storeCode, storeName, address, contactPhone, lat, lng, distanceKm, avgSpeedKmh } = req.body;
  if (!storeCode || !storeName) return res.status(400).json({ error: 'กรุณาระบุรหัสและชื่อคลินิก' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO stores (store_code, store_name, store_type, location) VALUES (?,?,?,?)`,
      [storeCode, storeName, 'EXTERNAL_CLINIC', address || null]
    );
    const storeId = result.insertId;
    await conn.query(
      `INSERT INTO clinic_details (store_id, address, contact_phone, lat, lng, distance_km, avg_speed_kmh)
       VALUES (?,?,?,?,?,?,?)`,
      [storeId, address || null, contactPhone || null, lat || null, lng || null, distanceKm || null, avgSpeedKmh || 40]
    );
    await conn.commit();
    await logAudit({ userId: req.session.user.user_id, username: req.session.user.username, action: 'CREATE_CLINIC', entityType: 'STORE', entityId: storeId, ip: req.ip });
    res.json({ storeId });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally { conn.release(); }
};

exports.updateClinic = async (req, res) => {
  const storeId = req.params.id;
  const { storeName, isActive, address, contactPhone, lat, lng, distanceKm, avgSpeedKmh } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[existing]] = await conn.query(`SELECT store_id FROM stores WHERE store_id = ? AND store_type = 'EXTERNAL_CLINIC'`, [storeId]);
    if (!existing) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบคลินิกนี้' }); }

    await conn.query(`UPDATE stores SET store_name=?, location=?, is_active=? WHERE store_id=?`,
      [storeName, address || null, isActive ? 1 : 0, storeId]);
    await conn.query(
      `INSERT INTO clinic_details (store_id, address, contact_phone, lat, lng, distance_km, avg_speed_kmh)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE address=VALUES(address), contact_phone=VALUES(contact_phone),
                               lat=VALUES(lat), lng=VALUES(lng), distance_km=VALUES(distance_km), avg_speed_kmh=VALUES(avg_speed_kmh)`,
      [storeId, address || null, contactPhone || null, lat || null, lng || null, distanceKm || null, avgSpeedKmh || 40]
    );
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally { conn.release(); }
};
