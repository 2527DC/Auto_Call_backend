'use strict';

const express = require('express');
const router = express.Router();
const kbController = require('../controllers/knowledge-base.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const { uploader } = require('../utils/upload');

const upload = uploader('knowledgebase');

router.use(authenticate);

router.get('/', checkPermission('view.knowledge_base'), kbController.getKnowledgeBase);
router.post('/create', checkPermission('create.knowledge_base'), upload.single('file'), kbController.createKnowledgeBase);
router.put('/edit/:id', checkPermission('update.knowledge_base'), upload.single('file'), kbController.editKnowledgeBase);
router.delete('/bulk-delete', checkPermission('delete.knowledge_base'), kbController.bulkDeleteKnowledgeBase);

module.exports = router;
