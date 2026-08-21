const express = require('express');
const router = express.Router();
const teamMemberController = require('../controllers/teamMember.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.post('/add', checkPermission('update.teams'), teamMemberController.addTeamMember);
router.post('/remove', checkPermission('update.teams'), teamMemberController.removeTeamMember);
router.get('/all', checkPermission('view.teams'), teamMemberController.getAllTeamMembers);
router.get('/transfer-teams', checkPermission('view.teams'), teamMemberController.getTeamsWithTransferPermission);
router.get('/:id', checkPermission('view.teams'), teamMemberController.getTeamMembers);

module.exports = router;
