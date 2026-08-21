const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const faqController = require('../controllers/faq.controller');

router.get('/all', faqController.getAllFaqs);
router.use(authenticate);

router.post('/create', checkPermission('create.faqs'), faqController.createFaq);
router.put('/:id/update', checkPermission('update.faqs'), faqController.updateFaq);
router.put('/:id/update/status', checkPermission('update.faqs'), faqController.updateFaqStatus);

router.delete('/delete', checkPermission('delete.faqs'), faqController.deleteFaq);

module.exports = router;