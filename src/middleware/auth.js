// Middleware สำหรับตรวจสอบ Login และสิทธิ์การเข้าถึงตาม Store

function requireLogin(req, res, next) {
  if (!req.session.user) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    }
    return res.redirect('/login');
  }
  res.locals.currentUser = req.session.user;
  next();
}

const ADMIN_ROLES = ['SUPER_ADMIN', 'PHARMACY_ADMIN'];

// เข้าหน้า Admin ได้ทั้ง Super Admin และ Pharmacy Admin
function requireAdmin(req, res, next) {
  if (!req.session.user || !ADMIN_ROLES.includes(req.session.user.role_code)) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(403).json({ error: 'เฉพาะ Admin เท่านั้น' });
    }
    return res.status(403).render('error', { message: 'คุณไม่มีสิทธิ์เข้าถึงหน้านี้ (เฉพาะ Admin)' });
  }
  next();
}

// เฉพาะ Super Admin เท่านั้น (จัดการบัญชี Admin คนอื่น, ตั้งค่าระบบระดับสูง)
function requireSuperAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role_code !== 'SUPER_ADMIN') {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(403).json({ error: 'เฉพาะ Super Admin เท่านั้น' });
    }
    return res.status(403).render('error', { message: 'คุณไม่มีสิทธิ์เข้าถึงหน้านี้ (เฉพาะ Super Admin)' });
  }
  next();
}

// ตรวจสอบว่า user มีสิทธิ์เข้าถึง store ที่ระบุหรือไม่ (Admin/Super Admin เข้าถึงได้ทุก store)
function canAccessStore(user, storeId) {
  if (!user) return false;
  if (ADMIN_ROLES.includes(user.role_code)) return true;
  return (user.stores || []).some(s => Number(s.store_id) === Number(storeId));
}

function isAdminRole(roleCode) {
  return ADMIN_ROLES.includes(roleCode);
}

function requireStoreAccess(paramName = 'storeId') {
  return (req, res, next) => {
    const storeId = req.params[paramName] || req.body.storeId || req.query.storeId;
    if (!canAccessStore(req.session.user, storeId)) {
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เข้าถึง Store นี้' });
      }
      return res.status(403).render('error', { message: 'คุณไม่มีสิทธิ์เข้าถึง Store นี้' });
    }
    next();
  };
}

module.exports = { requireLogin, requireAdmin, requireSuperAdmin, canAccessStore, requireStoreAccess, isAdminRole, ADMIN_ROLES };
