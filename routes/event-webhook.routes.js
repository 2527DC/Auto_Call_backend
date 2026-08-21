'use strict';

const express = require('express');
const router = express.Router();
const eventWebhookController = require('../controllers/event-webhook.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.post('/', checkPermission('create.webhooks'), eventWebhookController.createWebhook);
router.get('/', checkPermission('view.webhooks'), eventWebhookController.getWebhooks);
router.get('/:id', checkPermission('view.webhooks'), eventWebhookController.getWebhookById);
router.put('/:id', checkPermission('update.webhooks'), eventWebhookController.updateWebhook);
router.delete('/:id', checkPermission('delete.webhooks'), eventWebhookController.deleteWebhook);

module.exports = router;
