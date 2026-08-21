'use strict';

const express = require('express');
const router = express.Router();
const callController = require('../controllers/call.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.post('/twiml', callController.generateTwiML);
router.post('/status', callController.handleStatusCallback);
router.post('/transfer-status', callController.handleTransferStatusCallback);
router.post('/recording-callback', callController.handleRecordingCallback);
router.post('/inbound', callController.handleInboundCall);

router.post('/plivo-xml', callController.generatePlivoXML);
router.post('/plivo-status', callController.handlePlivoStatusCallback);
router.post('/plivo-inbound', callController.handlePlivoInboundCall);

router.use(authenticate);

router.post('/place', checkPermission('create.calls'), callController.placeCall);
router.get('/logs', checkPermission('activity.calls'), callController.getCallLogs);
router.get('/:id/recording', checkPermission('view.calls'), callController.getCallRecording);



module.exports = router;
