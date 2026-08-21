const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsapp.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.get('/webhook', whatsappController.webhook);
router.post('/webhook', whatsappController.webhook);

router.use(authenticate);

router.post('/signup', checkPermission('connect.whatsapp'), whatsappController.handleEmbeddedSignup);
router.get('/manual-connect-details', checkPermission('view.whatsapp'), whatsappController.getManualConnectDetails);
router.post('/manual-connect', checkPermission('connect.whatsapp'), whatsappController.manualConnect);
router.get('/phone-numbers', checkPermission('view.whatsapp'), whatsappController.getPhoneNumbers);
router.get('/connections', checkPermission('view.whatsapp'), whatsappController.getConnections);
router.post('/disconnect', checkPermission('disconnect.whatsapp'), whatsappController.disconnectWaba);

module.exports = router;
