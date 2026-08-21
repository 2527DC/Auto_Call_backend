const express = require('express');
const router = express.Router();
const apiKeyController = require('../controllers/api-key.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.post('/create', checkPermission('create.api_keys'), apiKeyController.create);
router.get('/', checkPermission('view.api_keys'), apiKeyController.getAll);
router.get('/self', checkPermission('view.api_keys'), apiKeyController.getSelf);
router.put('/:id/regenerate', checkPermission('regenerate.api_keys'), apiKeyController.regenerate);
router.put('/:id/status', checkPermission('update_status.api_keys'), apiKeyController.updateStatus);
router.delete('/:id', checkPermission('delete.api_keys'), apiKeyController.delete);
router.get('/:id', checkPermission('view.api_keys'), apiKeyController.getById);

module.exports = router;