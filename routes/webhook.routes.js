const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');
const smsWebhookController = require('../controllers/sms-webhook.controller');

router.post('/stripe', express.raw({ type: 'application/json' }), webhookController.stripeWebhook);
router.post('/razorpay', express.json(), webhookController.razorpayWebhook);
router.post('/paypal', express.raw({ type: 'application/json' }), webhookController.paypalWebhook);

router.post('/twilio-sms', express.urlencoded({ extended: true }), smsWebhookController.twilioWebhook);
router.post('/plivo-sms', express.urlencoded({ extended: true }), smsWebhookController.plivoWebhook);

module.exports = router;
