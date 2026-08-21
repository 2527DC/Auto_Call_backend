const express = require('express');
const router = express.Router();
const { uploadSingle } = require('../utils/upload');
const contactController = require('../controllers/contact.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.post('/create', checkPermission('create.contacts'), contactController.createContact);
router.get('/', checkPermission('view.contacts'), contactController.getContacts);
router.put('/:id/update', checkPermission('update.contacts'), contactController.updateContact);
router.delete('/delete', checkPermission('delete.contacts'), contactController.bulkDeleteContacts);

router.post('/import', checkPermission('import.contacts'), uploadSingle('contacts', 'contactFile', ['csv']), contactController.importContacts);
router.get('/import-template', checkPermission('import.contacts'), contactController.downloadImportTemplate);
router.get('/export/csv', checkPermission('export.contacts'), contactController.exportContacts);

module.exports = router;
