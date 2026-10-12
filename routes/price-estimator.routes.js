const express = require('express');
const router = express.Router();
const priceEstimatorController = require('../controllers/price-estimator.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

// Provider costs and quotes are for your own staff: a client's team members and
// API keys are refused even if their team was given the permission.
const staffOnly = (req, res, next) => {
  if (req.authType === 'api_key' || req.user?.isTeamMember || req.user?.team_id) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  next();
};

router.use(authenticate, staffOnly);

router.get('/rates', checkPermission('view.price_estimator'), priceEstimatorController.getRates);
router.get('/quotes', checkPermission('view.price_estimator'), priceEstimatorController.listQuotes);
router.get('/quotes/:id', checkPermission('view.price_estimator'), priceEstimatorController.getQuote);
router.post('/quotes', checkPermission('manage.price_estimator'), priceEstimatorController.createQuote);
router.put('/quotes/:id', checkPermission('manage.price_estimator'), priceEstimatorController.updateQuote);
router.delete('/quotes/:id', checkPermission('manage.price_estimator'), priceEstimatorController.deleteQuote);

module.exports = router;
