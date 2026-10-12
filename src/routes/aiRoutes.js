const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const ctrl = require('../controllers/aiController');

router.use(requireLogin);
router.post('/chat', ctrl.chat);
router.post('/reset', ctrl.resetChat);

module.exports = router;
