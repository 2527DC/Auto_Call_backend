'use strict';

const express = require('express');
const router = express.Router();
const sipTrunkController = require('../controllers/sip-trunk.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/', checkPermission('view.trunks'), sipTrunkController.getSipTrunks);
router.post('/add', checkPermission('create.trunks'), sipTrunkController.createSipTrunk);
router.put('/:id', checkPermission('update.trunks'), sipTrunkController.updateSipTrunk);
router.delete('/:id', checkPermission('delete.trunks'), sipTrunkController.deleteSipTrunk);

module.exports = router;
