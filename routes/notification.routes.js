const express = require('express')
const { Router } = express
const router = Router()
const { authenticate } = require('../middlewares/auth')
const notificationController = require('../controllers/notification.controller')

router.use(authenticate)

router.get('/', notificationController.getNotifications);
router.put('/:id/read', notificationController.markAsRead);

module.exports = router