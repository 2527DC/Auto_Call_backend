const express = require('express');
const multer = require('multer');
const router = express.Router();
const controller = require('../controllers/whatsapp-automation.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const { requireWhatsappBeta } = require('../middlewares/whatsappBeta');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

router.use(authenticate, requireWhatsappBeta);

router.get('/flows', checkPermission('view.whatsapp_automation'), controller.listFlows);
router.post('/flows', checkPermission('create.whatsapp_automation'), controller.createFlow);
router.get('/flows/:id', checkPermission('view.whatsapp_automation'), controller.getFlow);
router.put('/flows/:id', checkPermission('update.whatsapp_automation'), controller.updateFlow);
router.post('/flows/:id/status', checkPermission('update.whatsapp_automation'), controller.setStatus);
router.post('/flows/:id/duplicate', checkPermission('create.whatsapp_automation'), controller.duplicateFlow);
router.delete('/flows/:id', checkPermission('delete.whatsapp_automation'), controller.deleteFlow);
router.get('/flows/:id/runs', checkPermission('view.whatsapp_automation'), controller.listRuns);
router.post('/flows/:id/simulate', checkPermission('update.whatsapp_automation'), controller.simulate);
router.post('/validate', checkPermission('view.whatsapp_automation'), controller.validate);
router.get('/options', checkPermission('view.whatsapp_automation'), controller.options);
router.post('/media', checkPermission('update.whatsapp_automation'), upload.single('file'), controller.uploadMedia);
router.get('/ai-settings', checkPermission('view.whatsapp_automation'), controller.getAiSettings);
router.put('/ai-settings', checkPermission('update.whatsapp_automation'), controller.saveAiSettings);
router.post('/ai-settings/test', checkPermission('update.whatsapp_automation'), controller.testAi);

module.exports = router;
