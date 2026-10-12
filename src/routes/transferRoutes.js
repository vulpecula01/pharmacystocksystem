const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const ctrl = require('../controllers/transferController');

router.use(requireLogin);
router.get('/', ctrl.listTransfers);
router.get('/:id', ctrl.getTransfer);
router.post('/', ctrl.createTransfer);
router.post('/:id/send', ctrl.sendTransfer);
router.post('/:id/receive', ctrl.receiveTransfer);
router.post('/:id/cancel', ctrl.cancelTransfer);

module.exports = router;
