'use strict';

const express = require('express');
const router = express.Router();
const emailTemplateController = require('../controllers/email-template.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.post('/bulk-delete', checkPermission('delete.email_templates'), emailTemplateController.bulkDeleteEmailTemplates);
router.get('/', checkPermission('view.email_templates'), emailTemplateController.getEmailTemplates);
router.get('/:id', checkPermission('view.email_templates'), emailTemplateController.getEmailTemplateById);
router.post('/', checkPermission('create.email_templates'), emailTemplateController.createEmailTemplate);
router.put('/:id', checkPermission('update.email_templates'), emailTemplateController.updateEmailTemplate);

module.exports = router;