const express = require('express');
const router = express.Router();
const smsInboxController = require('../controllers/sms-inbox.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/sessions', checkPermission('view.sms_inbox '), smsInboxController.getSessions);
router.get('/sessions/:id/messages', checkPermission('view.sms_inbox'), smsInboxController.getSessionMessages);
router.post('/sessions/:id/assign', checkPermission('assign.sms_inbox'), smsInboxController.assignSession);
router.post('/sessions/:id/reply', checkPermission('reply.sms_inbox'), smsInboxController.sendManualReply);
router.post('/sessions/:id/resolve', checkPermission('reply.sms_inbox'), smsInboxController.resolveSession);

router.get('/team-members', checkPermission('assign.sms_inbox'), smsInboxController.getReplyTeamMembers);

module.exports = router;
