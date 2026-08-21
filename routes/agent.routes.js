'use strict';

const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agent.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/', checkPermission('view.agents'), agentController.getAgents);
router.get('/:id', checkPermission('view.agents'), agentController.getAgentById);
router.post('/create', checkPermission('create.agents'), agentController.createAgent);
router.put('/:id', checkPermission('update.agents'), agentController.updateAgent);
router.delete('/bulk-delete', checkPermission('delete.agents'), agentController.bulkDeleteAgents);
router.delete('/:id', checkPermission('delete.agents'), agentController.deleteAgent);

module.exports = router;