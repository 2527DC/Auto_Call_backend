const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const controller = require('../controllers/landing-page.controller');

router.get('/', controller.getLandingPage);

router.use(authenticate);
router.put('/', checkPermission('update.settings'), controller.updateLandingPage);

module.exports = router;
