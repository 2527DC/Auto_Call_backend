const express = require('express');
const router = express.Router();
const userSettingsController = require('../controllers/user-settings.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/', checkPermission('view.user_settings'), userSettingsController.getUserSetting);
router.put('/update', checkPermission('update.user_settings'), userSettingsController.updateUserSetting);

module.exports = router;
