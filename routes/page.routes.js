const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const pageController = require('../controllers/page.controller');

router.get('/slug/:slug', pageController.getPageBySlug);

router.use(authenticate);

router.get('/', checkPermission('view.pages'), pageController.fetchPages);

router.post('/create', checkPermission('create.pages'), pageController.createPage);
router.put('/update/:id', checkPermission('update.pages'), pageController.updatePage);
router.put('/:id/update/status', checkPermission('update.pages'), pageController.updatePageStatus);
router.delete('/delete', checkPermission('delete.pages'), pageController.deletePage);

module.exports = router;