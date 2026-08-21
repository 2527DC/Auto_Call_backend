'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const dashboardController = require('../controllers/dashboard.controller');

router.get('/', authenticate, checkPermission('view.admin_dashboard'), dashboardController.getAdminDashboardData);
router.get('/user', authenticate, checkPermission('view.dashboard'), dashboardController.getUserDashboardData);
router.get('/team-member', authenticate, checkPermission('view.team_member_dashboard'), dashboardController.getTeamMemberDashboardData);

module.exports = router;
