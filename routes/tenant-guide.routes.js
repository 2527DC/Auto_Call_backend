const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const tenantGuideController = require('../controllers/tenant-guide.controller');

router.use(authenticate);

router.post('/create', checkPermission('create.tenant_guide'), tenantGuideController.create);
router.get('/', checkPermission('view.tenant_guide'), tenantGuideController.getAll);
router.get('/:id/', checkPermission('view.tenant_guide'), tenantGuideController.getById);
router.put('/:id/update', checkPermission('update.tenant_guide'), tenantGuideController.update);
router.delete('/:id/delete', checkPermission('delete.tenant_guide'), tenantGuideController.delete);
router.delete('/:guideId/endpoint/:endpointId/delete', checkPermission('delete.tenant_guide'), tenantGuideController.deleteEndpoint);

module.exports = router;