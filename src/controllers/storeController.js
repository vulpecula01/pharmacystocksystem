const pool = require('../config/db');
const { isAdminRole } = require('../middleware/auth');

// คืนรายการ Store ที่ user คนนี้เข้าถึงได้ (Admin/Super Admin เห็นทุก store)
exports.listAccessibleStores = async (req, res) => {
  try {
    const user = req.session.user;
    let rows;
    if (isAdminRole(user.role_code)) {
      [rows] = await pool.query(
        `SELECT store_id, store_code, store_name, store_type, location, is_active
         FROM stores ORDER BY store_type, store_name`
      );
    } else {
      rows = user.stores;
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
