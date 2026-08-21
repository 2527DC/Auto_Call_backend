const express = require('express');
const router = express.Router();
const systemEmailTemplateController = require('../controllers/system-email-template.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/', checkPermission('view.settings'), systemEmailTemplateController.getAllEvents);
router.put('/:slug', checkPermission('update.settings'), systemEmailTemplateController.updateTemplate);

module.exports = router;
