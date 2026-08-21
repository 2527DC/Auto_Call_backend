'use strict';

const express = require('express');
const router = express.Router();
const dialerController = require('../controllers/dialer.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.post('/token', authenticate, checkPermission('initiateCall.virtual_phone'), dialerController.generateToken);
router.post('/outbound', dialerController.handleOutboundWebhook);

module.exports = router;
