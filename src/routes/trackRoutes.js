// เส้นทางสาธารณะ (ไม่ต้อง login) สำหรับคลินิกปลายทางติดตามสถานะการส่งยา
// ยืนยันตัวตนด้วย tracking_token ในลิงก์เท่านั้น (สุ่มยากพอที่จะไม่ให้เดาได้)
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/deliveryController');

router.get('/:token', ctrl.getPublicTrip);
router.post('/:token/confirm', ctrl.confirmPublicDelivery);

module.exports = router;
