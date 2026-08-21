'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const campaignTypeController = require('../controllers/campaign-type.controller');

router.use(authenticate);

router.get('/', checkPermission('view.campaign_types'), campaignTypeController.getAllCampaignTypes);
router.get('/:id', checkPermission('view.campaign_types'), campaignTypeController.getCampaignTypeById);
router.post('/create', checkPermission('create.campaign_types'), campaignTypeController.createCampaignType);
router.put('/:id/update', checkPermission('update.campaign_types'), campaignTypeController.updateCampaignType);
router.put('/:id/update-status', checkPermission('update.campaign_types'), campaignTypeController.updateCampaignStatus);
router.delete('/delete', checkPermission('delete.campaign_types'), campaignTypeController.deleteCampaignType);

module.exports = router;
