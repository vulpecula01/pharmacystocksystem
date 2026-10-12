const express = require('express');
const router = express.Router();
const { requireLogin, requireAdmin, isAdminRole } = require('../middleware/auth');

router.get('/', requireLogin, (req, res) => {
  if (isAdminRole(req.session.user.role_code)) return res.redirect('/admin/dashboard');
  res.redirect('/dashboard');
});

router.get('/dashboard', requireLogin, (req, res) => res.render('dashboard/index', { activePage: 'dashboard' }));

router.get('/stock', requireLogin, (req, res) => res.render('stock/index', { activePage: 'stock' }));
router.get('/scan', requireLogin, (req, res) => res.render('scan/index', { activePage: 'scan' }));
router.get('/transfers', requireLogin, (req, res) => res.render('transfers/list', { activePage: 'transfers' }));
router.get('/transfers/new', requireLogin, (req, res) => res.render('transfers/new', { activePage: 'transfers' }));
router.get('/transfers/:id', requireLogin, (req, res) => res.render('transfers/detail', { activePage: 'transfers', transferId: req.params.id }));
router.get('/reports', requireLogin, (req, res) => res.render('reports/index', { activePage: 'reports' }));
router.get('/ai', requireLogin, (req, res) => res.render('ai/index', { activePage: 'ai', currentUser: req.session.user }));

router.get('/delivery', requireLogin, (req, res) => res.render('delivery/list', { activePage: 'delivery' }));
router.get('/delivery/driver/:id', requireLogin, (req, res) => res.render('delivery/driver', { activePage: 'delivery', tripId: req.params.id }));

router.get('/replenishment', requireLogin, (req, res) => res.render('replenishment/list', { activePage: 'replenishment' }));

router.get('/cycle-count', requireLogin, (req, res) => res.render('cycle-count/list', { activePage: 'cycle-count' }));
router.get('/cycle-count/:id', requireLogin, (req, res) => res.render('cycle-count/detail', { activePage: 'cycle-count', countId: req.params.id }));

router.get('/admin/dashboard', requireLogin, requireAdmin, (req, res) => res.render('admin/dashboard', { activePage: 'admin-dashboard' }));
router.get('/admin/stores', requireLogin, requireAdmin, (req, res) => res.render('admin/stores', { activePage: 'admin-stores' }));
router.get('/admin/drugs', requireLogin, requireAdmin, (req, res) => res.render('admin/drugs', { activePage: 'admin-drugs' }));
router.get('/admin/config', requireLogin, requireAdmin, (req, res) => res.render('admin/config', { activePage: 'admin-config' }));
router.get('/admin/users', requireLogin, requireAdmin, (req, res) => res.render('admin/users', { activePage: 'admin-users' }));
router.get('/admin/audit-log', requireLogin, requireAdmin, (req, res) => res.render('admin/audit-log', { activePage: 'admin-audit' }));
router.get('/admin/clinics', requireLogin, requireAdmin, (req, res) => res.render('admin/clinics', { activePage: 'admin-clinics' }));

// หน้าติดตามสถานะสำหรับคลินิกปลายทาง - สาธารณะ ไม่ต้อง login (ยืนยันตัวตนด้วย token ในลิงก์เอง)
router.get('/track/:token', (req, res) => res.render('delivery/track', { activePage: 'track', token: req.params.token, layoutPublic: true }));

module.exports = router;
