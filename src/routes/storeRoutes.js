const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const ctrl = require('../controllers/storeController');

router.use(requireLogin);
router.get('/', ctrl.listAccessibleStores);

module.exports = router;
