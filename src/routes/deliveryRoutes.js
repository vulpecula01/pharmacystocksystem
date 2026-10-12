const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const ctrl = require('../controllers/deliveryController');

router.use(requireLogin);

router.get('/eligible-transfers', ctrl.listEligibleTransfers);
router.get('/drivers', ctrl.listDriverCandidates);
router.post('/trips', ctrl.createTrip);
router.get('/trips', ctrl.listTrips);
router.get('/trips/:id/driver-view', ctrl.getTripForDriver);
router.post('/trips/:id/status', ctrl.updateTripStatus);
router.post('/trips/:id/position', ctrl.postPosition);

module.exports = router;
