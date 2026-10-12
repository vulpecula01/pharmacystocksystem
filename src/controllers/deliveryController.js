// ----------------------------------------------------------------------------
// ระบบติดตามการส่งยาไปคลินิก (Delivery Tracking)
// - ผูกกับ Transfer ที่มีอยู่แล้วในระบบเสมอ (Transfer ปลายทางต้องเป็น Store ประเภท EXTERNAL_CLINIC)
// - ตำแหน่ง GPS ส่งมาจากมือถือคนขับ (ฟรี ไม่ใช้ Maps API ใดๆ) แสดงผลบนแผนที่ฟรี (Leaflet/OpenStreetMap)
// - ETA คำนวณแบบเส้นตรง (Haversine) หารด้วยความเร็วเฉลี่ยโดยประมาณ ไม่ใช่ระยะทางตามถนนจริง
// - ยืนยันรับยาที่ปลายทางทำผ่านลิงก์สาธารณะ (tracking_token) ไม่ต้อง login แล้วเรียก
//   receiveTransferGoods() ตัวเดียวกับที่หน้า Transfer ปกติใช้ เพื่อให้ตัดสต๊อกถูกต้องเหมือนกันเสมอ
// ----------------------------------------------------------------------------

const crypto = require('crypto');
const pool = require('../config/db');
const { canAccessStore, isAdminRole } = require('../middleware/auth');
const { receiveTransferGoods } = require('../utils/stock');
const { estimateRemaining } = require('../utils/geo');
const { logAudit } = require('../utils/audit');

function generateToken() {
  return crypto.randomBytes(16).toString('hex'); // 32 ตัวอักษร
}

// Transfer ที่ยังไม่มี Delivery Trip ผูกอยู่ และปลายทางเป็นคลินิก (EXTERNAL_CLINIC) - ใช้เลือกตอนสร้างรอบส่งยา
exports.listEligibleTransfers = async (req, res) => {
  try {
    const user = req.session.user;
    const where = [`t.status = 'TRANSFER_PENDING'`, `ts.store_type = 'EXTERNAL_CLINIC'`, `dt.trip_id IS NULL`];
    const params = [];
    if (!isAdminRole(user.role_code)) {
      const storeIds = user.stores.map(s => s.store_id);
      if (storeIds.length === 0) return res.json([]);
      where.push(`t.from_store_id IN (${storeIds.map(() => '?').join(',')})`);
      params.push(...storeIds);
    }
    const [rows] = await pool.query(
      `SELECT t.transfer_id, t.transfer_no, fs.store_name AS from_store_name, ts.store_name AS to_store_name,
              (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = t.transfer_id) AS item_count
       FROM transfers t
       JOIN stores fs ON fs.store_id = t.from_store_id
       JOIN stores ts ON ts.store_id = t.to_store_id
       LEFT JOIN delivery_trips dt ON dt.transfer_id = t.transfer_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// รายชื่อ user ที่ตั้งเป็นคนขับได้ (ใช้ user ที่มีอยู่แล้วในระบบทั้งหมดที่ Active)
exports.listDriverCandidates = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT user_id, full_name, username FROM users WHERE is_active = 1 ORDER BY full_name`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.createTrip = async (req, res) => {
  const user = req.session.user;
  const { transferId, driverUserId, vehicleInfo, avgSpeedKmh } = req.body;
  if (!transferId || !driverUserId) return res.status(400).json({ error: 'กรุณาระบุ Transfer และคนขับ' });

  try {
    const [[transfer]] = await pool.query(
      `SELECT t.transfer_id, t.from_store_id, t.to_store_id, t.status, cd.distance_km, cd.avg_speed_kmh
       FROM transfers t
       JOIN stores ts ON ts.store_id = t.to_store_id
       LEFT JOIN clinic_details cd ON cd.store_id = t.to_store_id
       WHERE t.transfer_id = ? AND ts.store_type = 'EXTERNAL_CLINIC'`,
      [transferId]
    );
    if (!transfer) return res.status(404).json({ error: 'ไม่พบ Transfer นี้ หรือปลายทางไม่ใช่คลินิก' });
    if (transfer.status !== 'TRANSFER_PENDING') return res.status(400).json({ error: 'Transfer นี้ไม่ได้อยู่ในสถานะรอรับ' });
    if (!canAccessStore(user, transfer.from_store_id)) return res.status(403).json({ error: 'ไม่มีสิทธิ์สร้างรอบส่งยาจาก Store ต้นทางนี้' });

    const [[dup]] = await pool.query(`SELECT trip_id FROM delivery_trips WHERE transfer_id = ?`, [transferId]);
    if (dup) return res.status(400).json({ error: 'Transfer นี้มีรอบส่งยาอยู่แล้ว' });

    const token = generateToken();
    const [result] = await pool.query(
      `INSERT INTO delivery_trips (transfer_id, driver_user_id, vehicle_info, tracking_token, distance_km, avg_speed_kmh, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [transferId, driverUserId, vehicleInfo || null, token, transfer.distance_km || null, avgSpeedKmh || null, user.user_id]
    );

    await logAudit({
      userId: user.user_id, username: user.username, action: 'DELIVERY_TRIP_CREATE',
      entityType: 'DELIVERY_TRIP', entityId: result.insertId, storeId: transfer.from_store_id,
      detail: { transferId, driverUserId }, ip: req.ip
    });

    res.json({ tripId: result.insertId, trackingToken: token, trackingPath: `/track/${token}` });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

function tripListQuery(extraWhere, params) {
  return pool.query(
    `SELECT dt.*, t.transfer_no, fs.store_name AS from_store_name, ts.store_name AS to_store_name,
            u.full_name AS driver_name, cd.lat AS clinic_lat, cd.lng AS clinic_lng,
            (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = dt.transfer_id) AS item_count
     FROM delivery_trips dt
     JOIN transfers t ON t.transfer_id = dt.transfer_id
     JOIN stores fs ON fs.store_id = t.from_store_id
     JOIN stores ts ON ts.store_id = t.to_store_id
     JOIN users u ON u.user_id = dt.driver_user_id
     LEFT JOIN clinic_details cd ON cd.store_id = t.to_store_id
     ${extraWhere ? 'WHERE ' + extraWhere : ''}
     ORDER BY dt.created_at DESC
     LIMIT 200`,
    params
  );
}

exports.listTrips = async (req, res) => {
  try {
    const user = req.session.user;
    let rows;
    if (isAdminRole(user.role_code)) {
      [rows] = await tripListQuery('', []);
    } else {
      // Store user ทั่วไป: เห็นรอบส่งยาที่ตัวเองเป็นคนขับ หรือที่ต้นทางเป็น Store ที่ตัวเองมีสิทธิ์เข้าถึง
      const storeIds = user.stores.map(s => s.store_id);
      const clauses = [`dt.driver_user_id = ?`];
      const params = [user.user_id];
      if (storeIds.length) {
        clauses.push(`t.from_store_id IN (${storeIds.map(() => '?').join(',')})`);
        params.push(...storeIds);
      }
      [rows] = await tripListQuery(`(${clauses.join(' OR ')})`, params);
    }
    res.json(rows.map(decorateTripEta));
  } catch (err) { res.status(500).json({ error: err.message }); }
};

function decorateTripEta(trip) {
  const { distanceKm, etaText } = estimateRemaining({
    currentLat: trip.last_lat, currentLng: trip.last_lng,
    destLat: trip.clinic_lat, destLng: trip.clinic_lng,
    fallbackDistanceKm: trip.distance_km, avgSpeedKmh: trip.avg_speed_kmh
  });
  return { ...trip, distanceRemainingKm: distanceKm, etaText };
}

async function assertDriverOwnsTrip(user, tripId) {
  const [[trip]] = await pool.query(`SELECT * FROM delivery_trips WHERE trip_id = ?`, [tripId]);
  if (!trip) { const e = new Error('ไม่พบรอบส่งยานี้'); e.status = 404; throw e; }
  if (trip.driver_user_id !== user.user_id && !isAdminRole(user.role_code)) {
    const e = new Error('เฉพาะคนขับที่ได้รับมอบหมายเท่านั้น'); e.status = 403; throw e;
  }
  return trip;
}

exports.getTripForDriver = async (req, res) => {
  try {
    const trip = await assertDriverOwnsTrip(req.session.user, req.params.id);
    const [[clinic]] = await pool.query(
      `SELECT s.store_name, cd.address, cd.lat, cd.lng, cd.distance_km, cd.avg_speed_kmh
       FROM transfers t JOIN stores s ON s.store_id = t.to_store_id
       LEFT JOIN clinic_details cd ON cd.store_id = s.store_id
       WHERE t.transfer_id = ?`,
      [trip.transfer_id]
    );
    res.json({ trip, clinic, trackingUrl: `/track/${trip.tracking_token}` });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
};

exports.updateTripStatus = async (req, res) => {
  const { status, cancelReason } = req.body;
  const VALID = ['DEPARTED', 'ARRIVED', 'CANCELLED'];
  if (!VALID.includes(status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
  try {
    const trip = await assertDriverOwnsTrip(req.session.user, req.params.id);
    if (trip.status === 'DELIVERED' || trip.status === 'CANCELLED') {
      return res.status(400).json({ error: 'รอบส่งยานี้จบแล้ว ไม่สามารถแก้ไขสถานะได้' });
    }
    const setCols = { DEPARTED: 'departed_at', ARRIVED: 'arrived_at' };
    const col = setCols[status];
    await pool.query(
      `UPDATE delivery_trips SET status = ? ${col ? `, ${col} = NOW()` : ''} ${status === 'CANCELLED' ? ', cancel_reason = ?' : ''} WHERE trip_id = ?`,
      status === 'CANCELLED' ? [status, cancelReason || null, req.params.id] : [status, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
};

// คนขับส่งพิกัด GPS ปัจจุบัน (เรียกทุก 30 วินาทีจากหน้าจอมือถือ ระหว่างสถานะ DEPARTED เท่านั้น)
exports.postPosition = async (req, res) => {
  const { lat, lng } = req.body;
  if (lat === undefined || lng === undefined) return res.status(400).json({ error: 'ต้องระบุ lat/lng' });
  try {
    const trip = await assertDriverOwnsTrip(req.session.user, req.params.id);
    if (trip.status !== 'DEPARTED') return res.status(400).json({ error: 'ส่งพิกัดได้เฉพาะระหว่างสถานะ "ออกเดินทางแล้ว" เท่านั้น' });

    await pool.query(`INSERT INTO delivery_positions (trip_id, lat, lng) VALUES (?,?,?)`, [req.params.id, lat, lng]);
    await pool.query(`UPDATE delivery_trips SET last_lat=?, last_lng=?, last_position_at=NOW() WHERE trip_id=?`, [lat, lng, req.params.id]);

    const [[clinic]] = await pool.query(
      `SELECT cd.lat, cd.lng FROM transfers t LEFT JOIN clinic_details cd ON cd.store_id = t.to_store_id WHERE t.transfer_id = ?`,
      [trip.transfer_id]
    );
    const est = estimateRemaining({
      currentLat: lat, currentLng: lng, destLat: clinic?.lat, destLng: clinic?.lng,
      fallbackDistanceKm: trip.distance_km, avgSpeedKmh: trip.avg_speed_kmh
    });
    res.json({ ok: true, distanceRemainingKm: est.distanceKm, etaText: est.etaText });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
};

// ---------- Public (ไม่ต้อง login) - หน้าติดตามสถานะสำหรับคลินิกปลายทาง ----------
exports.getPublicTrip = async (req, res) => {
  try {
    const [[trip]] = await pool.query(`SELECT * FROM delivery_trips WHERE tracking_token = ?`, [req.params.token]);
    if (!trip) return res.status(404).json({ error: 'ไม่พบลิงก์ติดตามนี้ (อาจพิมพ์ไม่ครบหรือลิงก์หมดอายุ)' });

    const [[info]] = await pool.query(
      `SELECT t.transfer_no, fs.store_name AS from_store_name,
              ts.store_name AS to_store_name, cd.address, cd.lat AS clinic_lat, cd.lng AS clinic_lng
       FROM transfers t
       JOIN stores fs ON fs.store_id = t.from_store_id
       JOIN stores ts ON ts.store_id = t.to_store_id
       LEFT JOIN clinic_details cd ON cd.store_id = t.to_store_id
       WHERE t.transfer_id = ?`,
      [trip.transfer_id]
    );
    const [items] = await pool.query(
      `SELECT d.drug_name, d.unit, ti.qty_transfer
       FROM transfer_items ti JOIN drug_master d ON d.drug_id = ti.drug_id
       WHERE ti.transfer_id = ?`,
      [trip.transfer_id]
    );
    const [trail] = await pool.query(
      `SELECT lat, lng, recorded_at FROM delivery_positions WHERE trip_id = ? ORDER BY recorded_at ASC LIMIT 500`,
      [trip.trip_id]
    );

    const est = estimateRemaining({
      currentLat: trip.last_lat, currentLng: trip.last_lng,
      destLat: info.clinic_lat, destLng: info.clinic_lng,
      fallbackDistanceKm: trip.distance_km, avgSpeedKmh: trip.avg_speed_kmh
    });

    res.json({
      trip: {
        status: trip.status, departedAt: trip.departed_at, arrivedAt: trip.arrived_at, deliveredAt: trip.delivered_at,
        lastLat: trip.last_lat, lastLng: trip.last_lng, lastPositionAt: trip.last_position_at,
        vehicleInfo: trip.vehicle_info
      },
      transferNo: info.transfer_no, fromStoreName: info.from_store_name, toStoreName: info.to_store_name,
      clinicAddress: info.address, clinicLat: info.clinic_lat, clinicLng: info.clinic_lng,
      items, trail,
      distanceRemainingKm: est.distanceKm, etaText: est.etaText
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// คลินิกกดยืนยันว่ารับยาแล้ว (ไม่ต้อง login - ยืนยันตัวตนด้วย token ในลิงก์เท่านั้น)
// ตัดสถานะ Trip เป็น DELIVERED และรับสต๊อกเข้า Store ของคลินิกจริง ผ่านฟังก์ชันเดียวกับหน้า Transfer ปกติ
exports.confirmPublicDelivery = async (req, res) => {
  const { receiverName } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[trip]] = await conn.query(`SELECT * FROM delivery_trips WHERE tracking_token = ? FOR UPDATE`, [req.params.token]);
    if (!trip) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบลิงก์ติดตามนี้' }); }
    if (trip.status === 'DELIVERED') { await conn.rollback(); return res.status(400).json({ error: 'รายการนี้ถูกยืนยันรับไปแล้ว' }); }
    if (trip.status === 'CANCELLED') { await conn.rollback(); return res.status(400).json({ error: 'รอบส่งยานี้ถูกยกเลิกไปแล้ว' }); }

    // ผู้ที่ระบบบันทึกเป็นผู้ทำรายการ (stock_transactions.user_id ต้องอ้างอิง user จริงในระบบเสมอ)
    // ใช้คนขับของรอบนี้เป็นผู้บันทึกแทน เพราะคลินิกไม่มีบัญชีผู้ใช้ในระบบ ส่วนชื่อผู้รับจริงจะถูกบันทึกแยกไว้ในฟิลด์ received_by_name และ remark ของ Transfer
    await receiveTransferGoods(conn, {
      transferId: trip.transfer_id, userId: trip.driver_user_id, receivedByName: receiverName || ''
    });
    await conn.query(
      `UPDATE delivery_trips SET status='DELIVERED', delivered_at=NOW(), received_by_name=? WHERE trip_id=?`,
      [receiverName || null, trip.trip_id]
    );
    await conn.commit();

    await logAudit({
      userId: trip.driver_user_id, username: null, action: 'DELIVERY_CONFIRM_PUBLIC',
      entityType: 'DELIVERY_TRIP', entityId: trip.trip_id,
      detail: { receiverName: receiverName || null, transferId: trip.transfer_id }, ip: req.ip
    });

    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(err.status || 400).json({ error: err.message });
  } finally { conn.release(); }
};
