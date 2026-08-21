const express = require('express');
const router = express.Router();
const numberPurchaseController = require('../controllers/number-purchase.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const { uploader } = require('../utils/upload');

router.use(authenticate);

router.get('/available', checkPermission('view.phone_numbers'), numberPurchaseController.getAvailableNumbers);
router.post('/initiate', checkPermission('create.phone_numbers'), numberPurchaseController.initiatePurchase);
router.post('/payment-success/:id', checkPermission('create.phone_numbers'), numberPurchaseController.markPaymentSuccess);

router.post('/upload-kyc/:id', checkPermission('create.phone_numbers'), uploader('kyc_documents').any(), numberPurchaseController.uploadKycDocuments);
router.get('/admin', checkPermission('view.admin_dashboard'), numberPurchaseController.getAllRequests);
router.post('/admin/:id/verify', checkPermission('view.admin_dashboard'), numberPurchaseController.verifyRequest);

module.exports = router;