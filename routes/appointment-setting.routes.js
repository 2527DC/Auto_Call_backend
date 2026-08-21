const express = require('express');
const router = express.Router();
const appointmentSettingController = require('../controllers/appointment-setting.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/', checkPermission('view.user_settings'), appointmentSettingController.getAppointmentSetting);
router.put('/update', checkPermission('update.user_settings'), appointmentSettingController.updateAppointmentSetting);

module.exports = router;
