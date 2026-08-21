'use strict';

const express = require('express');
const router = express.Router();
const aiModelController = require('../controllers/ai-model.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/', checkPermission('view.ai_models'), aiModelController.getAIModels);
router.get('/:id', checkPermission('view.ai_models'), aiModelController.getAIModel);
router.post('/', checkPermission('create.ai_models'), aiModelController.createAIModel);
router.put('/:id', checkPermission('update.ai_models'), aiModelController.updateAIModel);
router.delete('/:id', checkPermission('delete.ai_models'), aiModelController.deleteAIModel);

module.exports = router;
