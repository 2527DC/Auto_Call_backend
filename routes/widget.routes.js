const express = require('express');
const router = express.Router();
const widgetController = require('../controllers/widget.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.get('/public/:key', widgetController.getPublicWidget);
router.post('/voice-webhook', widgetController.handleWidgetVoice);
router.get('/token/:key', widgetController.getWidgetToken);

router.get('/analytics', authenticate, widgetController.getWidgetAnalytics);
router.get('/', authenticate, checkPermission('view.widgets'), widgetController.getWidgets);
router.post('/', authenticate, checkPermission('create.widgets'), widgetController.createWidget);
router.get('/:id', authenticate, checkPermission('view.widgets'), widgetController.getWidget);
router.put('/:id', authenticate, checkPermission('update.widgets'), widgetController.updateWidget);
router.delete('/delete', authenticate, checkPermission('delete.widgets'), widgetController.deleteWidget);
router.get('/:id/embed', authenticate, checkPermission('view.widgets'), widgetController.getEmbedCode);

module.exports = router;