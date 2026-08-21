const express = require('express');
const router = express.Router();
const planController = require('../controllers/plan.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.get('/', planController.getPlans);
router.get('/:id', planController.getPlanById);

router.use(authenticate);
router.post('/', checkPermission('create.plans'), planController.createPlan);
router.put('/:id', checkPermission('update.plans'), planController.updatePlan);
router.delete('/:id', checkPermission('delete.plans'), planController.deletePlan);
router.post('/sync-to-gateways', checkPermission('update.plans'), planController.syncPlansToGateways);

module.exports = router;
