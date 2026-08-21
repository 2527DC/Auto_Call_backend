const express = require('express');
const router = express.Router();
const blogCategoryController = require('../controllers/blog-category.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

const { uploader } = require('../utils/upload');

const blogCategoryUpload = uploader('blog-categories');

router.get('/', blogCategoryController.getAll);
router.get('/:id', blogCategoryController.getById);

router.use(authenticate);
router.post('/', checkPermission('create.blog_categories'), blogCategoryUpload.fields([{ name: 'image', maxCount: 1 }, { name: 'meta_image', maxCount: 1 }]), blogCategoryController.create);
router.put('/:id', checkPermission('update.blog_categories'), blogCategoryUpload.fields([{ name: 'image', maxCount: 1 }, { name: 'meta_image', maxCount: 1 }]), blogCategoryController.update);
router.delete('/:id', checkPermission('delete.blog_categories'), blogCategoryController.delete);

module.exports = router;