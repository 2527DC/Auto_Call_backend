'use strict';

const express = require('express');
const router = express.Router();
const outcomeController = require('../controllers/outcome.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

// The client's call outcomes and lead statuses
router.get('/settings', checkPermission('view.leads'), outcomeController.getSettings);
router.put('/settings', checkPermission('update.leads'), outcomeController.updateSettings);
router.post('/settings/preset', checkPermission('update.leads'), outcomeController.applyPreset);
router.post('/settings/test', checkPermission('update.leads'), outcomeController.testOnCall);

// A call's outcome
router.put('/calls/:id', checkPermission('update.leads'), outcomeController.setCallOutcome);
router.post('/calls/:id/analyze', checkPermission('update.leads'), outcomeController.reanalyzeCall);
router.post('/calls/analyze-past', checkPermission('update.leads'), outcomeController.analyzePastCalls);

// Leads: contacts with their status across calls
router.get('/leads', checkPermission('view.leads'), outcomeController.listLeads);
router.get('/leads/export', checkPermission('view.leads'), outcomeController.exportLeads);
router.post('/leads/bulk', checkPermission('update.leads'), outcomeController.bulkUpdateLeads);
router.get('/leads/:id', checkPermission('view.leads'), outcomeController.getLead);
router.put('/leads/:id/status', checkPermission('update.leads'), outcomeController.setLeadStatus);
router.post('/leads/:id/unlock', checkPermission('update.leads'), outcomeController.unlockLead);
router.post('/leads/:id/notes', checkPermission('update.leads'), outcomeController.addLeadNote);
router.put('/leads/:id/tags', checkPermission('update.leads'), outcomeController.setLeadTags);

// Campaigns: call people again by outcome
router.post('/campaigns/:id/recall', checkPermission('update.leads'), outcomeController.recallCampaign);

// Follow-ups: callbacks and team tasks
router.get('/follow-ups', checkPermission('view.leads'), outcomeController.listFollowUps);
router.post('/follow-ups', checkPermission('update.leads'), outcomeController.createFollowUp);
router.put('/follow-ups/:id', checkPermission('update.leads'), outcomeController.updateFollowUp);
router.post('/follow-ups/:id/done', checkPermission('update.leads'), outcomeController.completeFollowUp);
router.post('/follow-ups/:id/cancel', checkPermission('update.leads'), outcomeController.cancelFollowUp);
router.post('/follow-ups/:id/call-now', checkPermission('update.leads'), outcomeController.callFollowUpNow);

module.exports = router;
