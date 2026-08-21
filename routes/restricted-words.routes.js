const express = require('express');
const router = express.Router();
const restrictedWordsController = require('../controllers/restricted-words.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.post('/create', checkPermission('create.restricted_words'), restrictedWordsController.addRestrictedWord);
router.get('/', checkPermission('view.restricted_words'), restrictedWordsController.getRestrictedWords);
router.put('/:id/update', checkPermission('update.restricted_words'), restrictedWordsController.updateRestrictedWord);
router.delete('/:id/delete', checkPermission('delete.restricted_words'), restrictedWordsController.deleteRestrictedWord);

router.get('/users', checkPermission('view.restricted_words'), restrictedWordsController.getRestrictedUsers);
router.get('/users/:call_id', checkPermission('view.restricted_words'), restrictedWordsController.getRestrictedUserByCallId);
router.post('/users/:call_id/scan', checkPermission('update.restricted_words'), restrictedWordsController.scanCallTranscript);
router.post('/users/:id/action', checkPermission('update.restricted_words'), restrictedWordsController.takeAction);

module.exports = router;