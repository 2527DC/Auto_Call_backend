const express = require('express');
const router = express.Router();
const blogTagController = require('../controllers/blog-tag.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.get('/', blogTagController.getAll);
router.get('/:id', blogTagController.getById);

router.use(authenticate);
router.post('/', checkPermission('create.blog_tags'), blogTagController.create);
router.put('/:id', checkPermission('update.blog_tags'), blogTagController.update);
router.delete('/:id', checkPermission('delete.blog_tags'), blogTagController.delete);

module.exports = router;