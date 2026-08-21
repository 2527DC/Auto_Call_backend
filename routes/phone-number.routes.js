'use strict';

const express = require('express');
const router = express.Router();
const phoneNumberController = require('../controllers/phone-number.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/', checkPermission('view.phone_numbers'), phoneNumberController.getPhoneNumbers);
router.get('/load-twilio', checkPermission('create.phone_numbers'), phoneNumberController.loadFromTwilio);
router.get('/load-plivo', checkPermission('create.phone_numbers'), phoneNumberController.loadFromPlivo);
router.post('/add', checkPermission('create.phone_numbers'), phoneNumberController.addNumbers);
router.post('/import-sip', checkPermission('create.phone_numbers'), phoneNumberController.importSipPhoneNumber);
router.post('/:id/sync-elevenlabs', checkPermission('update.phone_numbers'), phoneNumberController.syncPhoneNumberToElevenLabs);
router.put('/:id/purchase-price', checkPermission('update.phone_numbers'), phoneNumberController.updatePurchasePrice);
router.put('/:id', checkPermission('update.phone_numbers'), phoneNumberController.updatePhoneNumber);
router.delete('/:id', checkPermission('delete.phone_numbers'), phoneNumberController.deletePhoneNumber);

module.exports = router;