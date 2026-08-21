const express = require('express')
const router = express.Router()
const { uploadSingle } = require('../utils/upload');
const { authenticate } = require('../middlewares/auth')
const { checkPermission } = require('../middlewares/permission')
const SMSCampaignController = require('../controllers/sms-campaign.controller')

router.use(authenticate)

router.post('/create', checkPermission('create.sms_campaign'), uploadSingle('sms-campaign-contacts', 'contactFile', ['csv']), SMSCampaignController.create)
router.get('/', checkPermission('view.sms_campaign'), SMSCampaignController.getAll)
router.get('/:id', checkPermission('view.sms_campaign'), SMSCampaignController.getById)
router.get('/:id/history', checkPermission('view.sms_campaign'), SMSCampaignController.getHistory)
router.put('/:id/update', checkPermission('update.sms_campaign'), uploadSingle('sms-campaign-contacts', 'contactFile', ['csv']), SMSCampaignController.update)
router.delete('/:id/delete', checkPermission('delete.sms_campaign'), SMSCampaignController.delete)

module.exports = router 