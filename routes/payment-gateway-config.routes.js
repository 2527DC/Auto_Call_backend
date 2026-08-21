const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const gatewayConfigController = require('../controllers/payment-gateway-config.controller');

router.get('/enabled', gatewayConfigController.getEnabledGateways);

router.use(authenticate);

router.get('/webhook-urls', checkPermission('view.payment_gateway_config'), gatewayConfigController.getWebhookUrls);

router.put('/trial-settings', checkPermission('update.payment_gateway_config'), gatewayConfigController.updateTrialSettings);

router.get('/transactions', checkPermission('view.payment_gateway_config'), gatewayConfigController.getTransactions);

router.get('/', checkPermission('view.payment_gateway_config'), gatewayConfigController.getGateways);
router.post('/', checkPermission('update.payment_gateway_config'), gatewayConfigController.createGateway);

router.get('/:name', checkPermission('view.payment_gateway_config'), gatewayConfigController.getGatewayConfigByName);
router.put('/:gateway_name', checkPermission('update.payment_gateway_config'), gatewayConfigController.updateGateway);
router.patch('/:name/toggle', checkPermission('update.payment_gateway_config'), gatewayConfigController.toggleGatewayStatus);
router.delete('/:name', checkPermission('update.payment_gateway_config'), gatewayConfigController.deleteGateway);
router.post('/:name/test', checkPermission('update.payment_gateway_config'), gatewayConfigController.testGateway);
router.post('/:name/reregister-webhook', checkPermission('update.payment_gateway_config'), gatewayConfigController.reregisterWebhook);

module.exports = router;