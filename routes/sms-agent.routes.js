const express = require("express")
const router = express.Router()
const smsAgentController = require("../controllers/sms-agent.controller")
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/self', checkPermission('view.sms_agent'), smsAgentController.getSMSAgents);
router.get('/:id', checkPermission('view.sms_agent'), smsAgentController.getSMSAgentById);
router.post('/create', checkPermission('create.sms_agent'), smsAgentController.createSMSAgent);
router.put('/:id/update', checkPermission('update.sms_agent'), smsAgentController.updateSMSAgent);
router.delete('/bulk-delete', checkPermission('delete.sms_agent'), smsAgentController.bulkDeleteSMSAgents);
router.delete('/:id/delete', checkPermission('delete.sms_agent'), smsAgentController.deleteSMSAgent);

module.exports = router;