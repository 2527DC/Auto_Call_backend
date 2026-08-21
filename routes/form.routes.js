'use strict';

const express = require('express');
const router = express.Router();
const formController = require('../controllers/form.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/', checkPermission('view.forms'), formController.getForms);
router.post('/', checkPermission('create.forms'), formController.createForm);
router.get('/:id', checkPermission('view.forms'), formController.getForm);
router.put('/:id', checkPermission('update.forms'), formController.updateForm);
router.delete('/delete', checkPermission('delete.forms'), formController.deleteForm);
router.get('/:id/responses', checkPermission('view.forms'), formController.getFormResponses);

module.exports = router;
