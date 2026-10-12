const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const ctrl = require('../controllers/replenishmentController');

router.use(requireLogin);

router.get('/preview', ctrl.previewAutoRequest);
router.post('/requests', ctrl.createRequest);
router.get('/requests', ctrl.listRequests);
router.get('/requests/:id', ctrl.getRequest);
router.post('/requests/:id/cancel', ctrl.cancelRequest);
router.get('/requests/:id/fulfill-preview', ctrl.getFulfillPreview);
router.post('/requests/:id/fulfill', ctrl.fulfillRequest);

module.exports = router;
