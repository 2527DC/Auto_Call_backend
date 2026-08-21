const express = require('express');
const router = express.Router();
const whatsappCallController = require('../controllers/whatsapp-call.controller');

router.get('/webhook', whatsappCallController.webhook);
router.post('/webhook', whatsappCallController.webhook);

module.exports = router;
