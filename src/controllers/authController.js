const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { logAudit } = require('../utils/audit');

exports.showLogin = (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
};

exports.login = async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await pool.query(
      `SELECT u.user_id, u.username, u.password_hash, u.full_name, u.is_active,
              r.role_id, r.role_code, r.role_name
       FROM users u JOIN roles r ON r.role_id = u.role_id
       WHERE u.username = ?`,
      [username]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.render('login', { error: 'ไม่พบผู้ใช้งาน หรือบัญชีถูกระงับ' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.render('login', { error: 'รหัสผ่านไม่ถูกต้อง' });
    }

    const [stores] = await pool.query(
      `SELECT s.store_id, s.store_code, s.store_name, s.store_type,
              usa.can_issue, usa.can_receive
       FROM user_store_access usa
       JOIN stores s ON s.store_id = usa.store_id
       WHERE usa.user_id = ? AND s.is_active = 1`,
      [user.user_id]
    );

    req.session.user = {
      user_id: user.user_id,
      username: user.username,
      full_name: user.full_name,
      role_id: user.role_id,
      role_code: user.role_code,
      role_name: user.role_name,
      stores
    };

    await logAudit({
      userId: user.user_id, username: user.username, action: 'LOGIN',
      ip: req.ip
    });

    // สำคัญ: บังคับให้บันทึก Session ลง MySQL ให้เสร็จก่อน redirect เสมอ
    // (ป้องกัน race condition ที่ request ถัดไปมาถึงก่อน session ถูกเขียนลง DB จริง
    // ซึ่งจะทำให้ระบบมองว่ายังไม่ได้ login และเด้งกลับไปหน้า login แบบสุ่มๆ)
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.render('login', { error: 'เกิดข้อผิดพลาดในการบันทึก Session กรุณาลองใหม่อีกครั้ง' });
      }
      res.redirect('/');
    });
    return;
  } catch (err) {
    console.error(err);
    res.render('login', { error: 'เกิดข้อผิดพลาด: ' + err.message });
  }
};

exports.logout = async (req, res) => {
  const user = req.session.user;
  if (user) {
    await logAudit({ userId: user.user_id, username: user.username, action: 'LOGOUT', ip: req.ip });
  }
  req.session.destroy(() => res.redirect('/login'));
};
