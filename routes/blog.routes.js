const express = require('express');
const router = express.Router();
const blogController = require('../controllers/blog.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

const { uploader } = require('../utils/upload');

const blogUpload = uploader('blogs');

router.get('/', blogController.getAll);
router.get('/slug/:slug', blogController.getBySlug);
router.get('/:id', blogController.getById);

router.use(authenticate);
router.post('/', checkPermission('create.blogs'), blogUpload.fields([{ name: 'thumbnail', maxCount: 1 }, { name: 'meta_image', maxCount: 1 }]), blogController.create);
router.put('/:id', checkPermission('update.blogs'), blogUpload.fields([{ name: 'thumbnail', maxCount: 1 }, { name: 'meta_image', maxCount: 1 }]), blogController.update);
router.delete('/:id', checkPermission('delete.blogs'), blogController.delete);

module.exports = router;
