const express = require('express')
const router = express.Router()
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const contactGroupController = require('../controllers/contact-group.controller');

router.use(authenticate)

router.post('/create', checkPermission('create.contact_group'), contactGroupController.createGroup);
router.get('/', checkPermission('view.contact_group'), contactGroupController.getAllGroups);
router.get('/:id', checkPermission('view.contact_group'), contactGroupController.getGroupById);
router.put('/:id/update', checkPermission('update.contact_group'), contactGroupController.updateGroup);
router.delete('/:id/delete', checkPermission('delete.contact_group'), contactGroupController.deleteGroup);

module.exports = router