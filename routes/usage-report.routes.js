const express = require('express');
const router = express.Router();
const usageReportController = require('../controllers/usage-report.controller');
const { authenticate } = require('../middlewares/auth');

router.get('/credit-cost', authenticate, usageReportController.getCreditCost);
router.get('/', authenticate, usageReportController.getUsageReport);

module.exports = router;
