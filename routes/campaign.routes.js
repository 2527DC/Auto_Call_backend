'use strict';

const express = require('express');
const router = express.Router();
const { uploadSingle } = require('../utils/upload');
const campaignController = require('../controllers/campaign.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/', checkPermission('view.campaigns'), campaignController.getCampaigns);
router.get('/:id', checkPermission('view.campaigns'), campaignController.getCampaignById);
router.get('/:id/history', checkPermission('view.campaigns'), campaignController.getCampaignHistory);
router.post('/create', checkPermission('create.campaigns'), uploadSingle('campaign-contacts', 'contactFile', ['csv']), campaignController.createCampaign);
router.put('/:id/update', checkPermission('update.campaigns'), uploadSingle('campaign-contacts', 'contactFile', ['csv']), campaignController.updateCampaign);
router.delete('/:id/delete', checkPermission('delete.campaigns'), campaignController.deleteCampaign);

module.exports = router;
