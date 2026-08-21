const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const categoryController = require('../controllers/template-category.controller');

router.get('/all', categoryController.getAllCategories);

router.use(authenticate);
router.get('/self', checkPermission('view.template_categories'), categoryController.getSelfCategories);

router.post('/create', checkPermission('create.template_categories'), categoryController.createCategory);
router.put('/:id/update', checkPermission('update.template_categories'), categoryController.updateCategory);

router.delete('/delete', checkPermission('delete.template_categories'), categoryController.deleteCategory);

module.exports = router;    