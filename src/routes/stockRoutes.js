const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const ctrl = require('../controllers/stockController');

router.use(requireLogin);
router.get('/', ctrl.listStock);                 // ?storeId=
router.get('/lookup', ctrl.lookupForScan);        // ?storeId=&code=
router.get('/lots', ctrl.listLotsForDrug);        // ?storeId=&drugId=
router.post('/issue', ctrl.issueStock);
router.post('/issue-fefo', ctrl.issueStockFefo);
router.post('/receive', ctrl.receiveStock);
router.get('/config', ctrl.listStoreDrugConfig);  // ?storeId=

module.exports = router;
