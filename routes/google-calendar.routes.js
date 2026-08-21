'use strict';

const express = require('express');
const router = express.Router();
const googleCalendarController = require('../controllers/google-calendar.controller');
const { authenticate } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');

router.use(authenticate);

router.get('/', checkPermission('view.google_calendars'), googleCalendarController.getGoogleCalendars);
router.get('/list', checkPermission('view.google_calendars'), googleCalendarController.listUserGoogleCalendars);
router.post('/', checkPermission('create.google_calendars'), googleCalendarController.createGoogleCalendar);
router.put('/:id', checkPermission('update.google_calendars'), googleCalendarController.updateGoogleCalendar);
router.delete('/:id', checkPermission('delete.google_calendars'), googleCalendarController.deleteGoogleCalendar);
router.post('/bulk-delete', checkPermission('delete.google_calendars'), googleCalendarController.bulkDeleteGoogleCalendars);

router.get('/fetch-calendars/:google_account_id', checkPermission('create.google_calendars'), googleCalendarController.syncCalendars);
router.post('/:id/link', checkPermission('create.google_calendars'), googleCalendarController.linkCalendar);

router.get('/:calendar_id/events', authenticate, checkPermission('view.google_calendars'), googleCalendarController.listEvents);
router.post('/:calendar_id/events', authenticate, checkPermission('create.google_calendars'), googleCalendarController.createEvent);
router.put('/:calendar_id/events/:event_id', authenticate, checkPermission('update.google_calendars'), googleCalendarController.updateEvent);
router.delete('/:calendar_id/events/:event_id', authenticate, checkPermission('delete.google_calendars'), googleCalendarController.deleteEvent);

module.exports = router;