const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const contactInquiryController = require('../controllers/contact-inquiries.controller');

router.post('/create', contactInquiryController.createInquiry);

router.use(authenticate);
router.get('/all', checkPermission('view.contact_inquiries'), contactInquiryController.getAllInquiries);
router.get('/:id', checkPermission('view.contact_inquiries'), contactInquiryController.getInquiryById);
router.delete('/delete', checkPermission('delete.contact_inquiries'), contactInquiryController.deleteInquiry);

module.exports = router;