const express = require('express');
const multer = require('multer');
const router = express.Router();
const controller = require('../controllers/whatsapp-inbox.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const { requireWhatsappBeta } = require('../middlewares/whatsappBeta');

// Files go straight to WhatsApp and our storage, so they stay in memory (Meta's max for video/audio).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

router.use(authenticate, requireWhatsappBeta);

router.get('/setup', checkPermission('view.whatsapp_inbox'), controller.setup);
router.post('/setup/subscribe', checkPermission('reply.whatsapp_inbox'), controller.subscribeWebhook);
router.get('/conversations', checkPermission('view.whatsapp_inbox'), controller.listConversations);
router.get('/conversations/:id', checkPermission('view.whatsapp_inbox'), controller.getConversation);
router.get('/conversations/:id/messages', checkPermission('view.whatsapp_inbox'), controller.listMessages);
router.post('/conversations/:id/messages', checkPermission('reply.whatsapp_inbox'), upload.single('file'), controller.sendMessage);
router.post('/conversations/:id/read', checkPermission('view.whatsapp_inbox'), controller.markRead);
router.patch('/conversations/:id', checkPermission('reply.whatsapp_inbox'), controller.updateConversation);
router.post('/conversations/:id/assign', checkPermission('assign.whatsapp_inbox'), controller.assign);
router.post('/conversations/:id/bot', checkPermission('reply.whatsapp_inbox'), controller.setBot);
router.post('/messages/:id/react', checkPermission('reply.whatsapp_inbox'), controller.react);
router.get('/team-members', checkPermission('assign.whatsapp_inbox'), controller.teamMembers);
router.get('/templates', checkPermission('view.whatsapp_inbox'), controller.templates);
router.get('/quick-replies', checkPermission('view.whatsapp_inbox'), controller.getQuickReplies);
router.put('/quick-replies', checkPermission('reply.whatsapp_inbox'), controller.saveQuickReplies);

module.exports = router;
