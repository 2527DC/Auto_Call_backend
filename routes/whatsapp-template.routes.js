'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const whatsappTemplateController = require('../controllers/whatsapp-template.controller');
const { checkPermission } = require('../middlewares/permission');
const { uploader } = require('../utils/upload');

router.use(authenticate);

router.post('/create', uploader('attachments').fields([{ name: 'file', maxCount: 1 }]), checkPermission('create.whatsapp_template'), whatsappTemplateController.createTemplate);
router.get('/', checkPermission('view.whatsapp_template'), whatsappTemplateController.getAllTemplates);
router.get('/meta-list', checkPermission('view.whatsapp_template'), whatsappTemplateController.getTemplatesFromMeta);
router.get('/:id', checkPermission('view.whatsapp_template'), whatsappTemplateController.getTemplateById);
router.post('/sync', checkPermission('update.whatsapp_template'), whatsappTemplateController.syncTemplatesFromMeta);
router.post('/sync-status', checkPermission('update.whatsapp_template'), whatsappTemplateController.syncTemplatesStatusFromMeta);
router.put('/:id', uploader('attachments').fields([{ name: 'file', maxCount: 1 }]), checkPermission('update.whatsapp_template'), whatsappTemplateController.updateTemplate);
router.delete('/:id', checkPermission('delete.whatsapp_template'), whatsappTemplateController.deleteTemplate);

module.exports = router;
