const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const templateController = require('../controllers/template.controller');

router.get('/all', templateController.getAllTemplates);

router.use(authenticate);
router.get('/self', checkPermission('view.templates'), templateController.getSelfTemplates);

router.post('/create', checkPermission('create.templates'), templateController.createTemplate);
router.put('/:id/update', checkPermission('update.templates'), templateController.updateTemplate);

router.delete('/delete', checkPermission('delete.templates'), templateController.deleteTemplate);

module.exports = router;
