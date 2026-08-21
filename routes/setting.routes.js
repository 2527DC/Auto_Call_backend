const express = require('express');
const router = express.Router();
const settingController = require('../controllers/setting.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const { uploader } = require('../utils/upload');

const uploadLogos = uploader('logos').fields([
    { name: 'favicon', maxCount: 1 },
    { name: 'logo_light', maxCount: 1 },
    { name: 'logo_dark', maxCount: 1 },
    { name: 'sidebar_logo', maxCount: 1 },
    { name: 'mobile_logo', maxCount: 1 },
    { name: 'landing_logo', maxCount: 1 },
    { name: 'favicon_notification_logo', maxCount: 1 },
    { name: 'onboarding_logo', maxCount: 1 },
    { name: 'maintenance_image', maxCount: 1 },
    { name: 'page_404_image', maxCount: 1 },
    { name: 'no_internet_image', maxCount: 1 }
]);

router.get('/public', settingController.getPublicSettings);

router.use(authenticate);
router.get('/', checkPermission('view.settings'), settingController.getSettings);

router.put('/update', uploadLogos, checkPermission('update.settings'), settingController.updateSettings);
router.post('/send-test-email', checkPermission('update.settings'), settingController.sendTestMail);

module.exports = router;
