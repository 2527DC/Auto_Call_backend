'use strict';

const express = require('express');
const router = express.Router();
const googleSheetController = require('../controllers/google-sheet.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/', checkPermission('view.google_sheets'), googleSheetController.getGoogleSheets);
router.post('/', checkPermission('create.google_sheets'), googleSheetController.createGoogleSheet);
router.delete('/:id', checkPermission('delete.google_sheets'), googleSheetController.deleteGoogleSheet);
router.post('/bulk-delete', checkPermission('delete.google_sheets'), googleSheetController.bulkDeleteGoogleSheets);
router.post('/sync-sheets', checkPermission('create.google_sheets'), googleSheetController.syncSheets);
router.post('/:id/link', checkPermission('create.google_sheets'), googleSheetController.linkGoogleSheet);

router.get('/:sheet_id/values', authenticate, checkPermission('view.google_sheets'), googleSheetController.readSheet);
router.post('/:sheet_id/values', authenticate, checkPermission('update.google_sheets'), googleSheetController.writeSheet);
module.exports = router;