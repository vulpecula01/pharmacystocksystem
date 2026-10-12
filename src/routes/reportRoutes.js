const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const ctrl = require('../controllers/reportController');

router.use(requireLogin);
router.get('/movement', ctrl.stockMovement);       // ?storeId&type&drugId&from&to  (RECEIVE/ISSUE/TRANSFER_IN/TRANSFER_OUT/ADJUSTMENT)
router.get('/transfers', ctrl.transferReport);      // ?storeId&from&to&direction
router.get('/stock-balance', ctrl.stockBalance);    // ?storeId
router.get('/stock-by-lot', ctrl.stockByLot);       // ?storeId
router.get('/near-expiry', ctrl.nearExpiry);        // ?storeId
router.get('/export/:type', ctrl.exportReport);     // excel export

module.exports = router;
