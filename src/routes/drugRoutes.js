const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const ctrl = require('../controllers/drugController');

router.use(requireLogin);
router.get('/', ctrl.searchDrugs);
router.get('/:id', ctrl.getDrug);
router.get('/:id/qrcode', ctrl.getQrCode);
router.get('/code/:code', ctrl.getDrugByCode);

module.exports = router;
