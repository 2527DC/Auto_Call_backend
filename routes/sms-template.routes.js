const express = require('express')
const router = express.Router()
const { authenticate } = require('../middlewares/auth')
const { checkPermission } = require('../middlewares/permission')
const SMSTemplateController = require('../controllers/sms-template.controller')

router.use(authenticate)

router.get('/all', checkPermission('view.sms_template'), SMSTemplateController.getAll)
router.get('/self', checkPermission('view.sms_template'), SMSTemplateController.getSelf)
router.post('/create', checkPermission('create.sms_template'), SMSTemplateController.create)
router.put('/:id/update', checkPermission('update.sms_template'), SMSTemplateController.update)
router.delete('/:id/delete', checkPermission('delete.sms_template'), SMSTemplateController.delete)

module.exports = router