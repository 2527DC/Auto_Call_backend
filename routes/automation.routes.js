const express = require('express');
const router = express.Router();
const automationController = require('../controllers/automation.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.post('/elevenlabs/tool', automationController.elevenLabsToolWebhook);

router.use(authenticate);

router.get('/email-templates', checkPermission('view.automation'), automationController.getEmailTemplates);
router.post('/email-templates', checkPermission('create.automation'), automationController.createEmailTemplate);

module.exports = router;
