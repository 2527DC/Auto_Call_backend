const express = require('express');
const router = express.Router();
const voiceController = require('../controllers/voice.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.get('/:voice_id/preview', voiceController.getVoicePreview);
router.get('/preview/:voice_id', voiceController.getVoicePreview);

router.use(authenticate);

router.get('/', checkPermission('view.voices'), voiceController.getAllVoices);
router.get('/sync', checkPermission('sync.voices'), voiceController.syncVoices);
router.post('/synthesize', checkPermission('synthesize.voices'), voiceController.synthesizeSpeech);
router.get('/models', checkPermission('view.voices'), voiceController.getVoiceModels);
router.patch('/:voice_id/status', checkPermission('sync.voices'), voiceController.updateVoiceStatus);

module.exports = router;