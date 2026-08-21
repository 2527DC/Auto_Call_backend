const express = require('express');
const router = express.Router();
const teamController = require('../controllers/team.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.post('/create', checkPermission('create.teams'), teamController.createTeam);
router.get('/', checkPermission('view.teams'), teamController.getAllTeams);
router.get('/permissions', checkPermission('view.teams'), teamController.getPermissions);
router.get('/:id', checkPermission('view.teams'), teamController.getTeamById);
router.put('/:id', checkPermission('update.teams'), teamController.updateTeam);
router.delete('/delete', checkPermission('delete.teams'), teamController.deleteTeam);
router.patch('/:id/toggle-status', checkPermission('update.teams'), teamController.toggleTeamStatus);

module.exports = router;
