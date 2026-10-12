const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const ctrl = require('../controllers/cycleCountController');

router.use(requireLogin);

router.post('/counts', ctrl.createCount);
router.get('/counts', ctrl.listCounts);
router.get('/counts/:id', ctrl.getCount);
router.put('/counts/:id/items', ctrl.saveCountItems);
router.post('/counts/:id/submit', ctrl.submitCount);
router.post('/counts/:id/cancel', ctrl.cancelCount);

module.exports = router;
