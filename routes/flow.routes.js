'use strict';

const express = require('express');
const router = express.Router();
const flowController = require('../controllers/flow.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const { uploadSingle } = require('../utils/upload');

router.use(authenticate);

router.get('/', checkPermission('view.flows'), flowController.getFlows);
router.get('/:id', checkPermission('view.flows'), flowController.getFlowById);
router.post('/upload-audio', checkPermission('update.flows'), uploadSingle('audios', 'file', ['mp3', 'wav', 'webm', 'ogg', 'm4a']), flowController.uploadAudio);
router.post('/create', checkPermission('create.flows'), flowController.createFlow);
router.put('/:id', checkPermission('update.flows'), flowController.updateFlow);
router.delete('/bulk-delete', checkPermission('delete.flows'), flowController.bulkDeleteFlows);
router.delete('/:id', checkPermission('delete.flows'), flowController.deleteFlow);
router.post('/test', checkPermission('view.flows'), flowController.testFlow);

module.exports = router;