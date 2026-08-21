const express = require('express');
const router = express.Router();
const violenceController = require('../controllers/violence.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.post('/create', checkPermission('create.restricted_words'), violenceController.addViolenceWord);
router.get('/', checkPermission('view.restricted_words'), violenceController.getViolenceWords);
router.put('/:id/update', checkPermission('update.restricted_words'), violenceController.updateViolenceWord);
router.delete('/:id/delete', checkPermission('delete.restricted_words'), violenceController.deleteViolenceWord);

router.post('/users/:call_id/scan', checkPermission('update.restricted_words'), violenceController.scanCallTranscript);
router.post('/users/:id/action', checkPermission('update.restricted_words'), violenceController.takeAction);

module.exports = router;