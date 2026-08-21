'use strict';

const express = require('express');
const router = express.Router();
const googleController = require('../controllers/google.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.get('/connect', authenticate, checkPermission('connect.google_accounts'), googleController.connect);
router.get('/callback', googleController.callback);

router.use(authenticate);

router.get('/accounts', checkPermission('view.google_accounts'), googleController.listAccounts);
router.delete('/accounts/:id', checkPermission('disconnect.google_accounts'), googleController.disconnectAccount);

module.exports = router;