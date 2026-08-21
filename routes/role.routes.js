const express = require('express');
const router = express.Router();
const roleController = require('../controllers/role.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/permissions/all', checkPermission('view.roles'), roleController.getAllPermissions);

router.get('/', checkPermission('view.roles'), roleController.getRoles);
router.get('/active/all', checkPermission('view.roles'), roleController.getActiveRoles);
router.get('/:id', checkPermission('view.roles'), roleController.getRoleById);
router.post('/', checkPermission('create.roles'), roleController.createRole);
router.put('/:id', checkPermission('update.roles'), roleController.updateRole);
router.delete('/:id', checkPermission('delete.roles'), roleController.deleteRole);
router.get('/:id/permissions', checkPermission('view.roles'), roleController.getRolePermissions);

module.exports = router;