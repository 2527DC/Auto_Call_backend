'use strict';

const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointment.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/', checkPermission('view.appointments'), appointmentController.getAppointments);
router.get('/stats', checkPermission('view.appointments'), appointmentController.getStats);
router.patch('/:id/status', checkPermission('update.appointments'), appointmentController.updateStatus);

module.exports = router;
