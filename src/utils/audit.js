const pool = require('../config/db');

/**
 * บันทึก Audit Trail
 */
async function logAudit({ userId, username, action, entityType, entityId, storeId, detail, ip }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, store_id, detail, ip_address)
       VALUES (?,?,?,?,?,?,?,?)`,
      [userId || null, username || null, action, entityType || null, entityId || null,
       storeId || null, detail ? JSON.stringify(detail) : null, ip || null]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

module.exports = { logAudit };
