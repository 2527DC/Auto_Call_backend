const express = require('express');
const router = express.Router();
const languageController = require('../controllers/language.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const { uploader } = require('../utils/upload');

const languageUpload = uploader('languages').fields([
  { name: 'flag', maxCount: 1 },
  { name: 'front_translation_file', maxCount: 1 }
]);

router.get('/', languageController.getLanguages);
router.get('/translations/:locale', languageController.getTranslations);

router.get('/:id', authenticate, checkPermission('view.languages'), languageController.getLanguageById);

router.post('/', authenticate, checkPermission('create.languages'), ...languageUpload, languageController.createLanguage);
router.put('/:id', authenticate, checkPermission('update.languages'), ...languageUpload, languageController.updateLanguage);
router.delete('/', authenticate, checkPermission('delete.languages'), languageController.deleteLanguages);

router.put('/:locale/translations', authenticate, checkPermission('update.languages'), languageController.updateTranslations);
router.patch('/:id/toggle-status', authenticate, checkPermission('update.languages'), languageController.toggleLanguageStatus);
router.patch('/:id/toggle-default', authenticate, checkPermission('update.languages'), languageController.toggleDefaultLanguage);

module.exports = router;