const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const userController = require('../controllers/user.controller');
const { uploadSingle } = require('../utils/upload');

router.use(authenticate);

router.get('/all', checkPermission('view.members'), userController.getAllUsers);
router.get('/export', checkPermission('view.members'), userController.exportUsers);
router.post('/create', uploadSingle('avatars','avatar'), checkPermission('create.members'), userController.createUser);
router.post('/import', uploadSingle('imports', 'file'), checkPermission('create.members'), userController.importUsers);
router.get('/import-template', checkPermission('view.members'), userController.downloadImportTemplate);
router.put('/update', uploadSingle('avatars','avatar'), checkPermission('update.members'), userController.updateUser);
router.put('/:id/update/status', checkPermission('update.members'), userController.updateUserStatus);
router.post('/add-bonus-credits', checkPermission('update.members'), userController.addBonusCredits);
router.delete('/delete', checkPermission('delete.members'), userController.deleteUser);

module.exports = router;