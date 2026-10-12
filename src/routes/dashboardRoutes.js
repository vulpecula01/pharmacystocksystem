const express = require('express');
const router = express.Router();
const { requireLogin, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/dashboardController');

router.use(requireLogin);

// Dashboard สถานะแผนกแบบเขียว/เหลือง/แดง - เข้าถึงได้ทุก Role ที่ login แล้ว (แต่ละคนเห็นแค่ Store ตัวเอง ยกเว้น Admin เห็นทุก Store)
router.get('/store-summary', ctrl.storeSummary);
router.get('/store-summary/:storeId/detail', ctrl.storeDetail);

// ภาพรวมระดับโรงพยาบาล (มูลค่า Inventory รวม, กราฟ ฯลฯ) - เฉพาะ Admin เท่านั้น
router.get('/summary', requireAdmin, ctrl.summary);

module.exports = router;
