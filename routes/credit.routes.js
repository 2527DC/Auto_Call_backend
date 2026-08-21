'use strict';

const express = require('express');
const router = express.Router();
const creditController = require('../controllers/credit.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/balance', creditController.getCreditBalance);
router.get('/usage-history', creditController.getCreditUsageHistory);
router.get('/statistics', creditController.getCreditStatistics);

module.exports = router;