'use strict';

const { db } = require('../models');
const Appointment = db.Appointment;
const UserSettings = db.UserSettings;
const GoogleAccount = db.GoogleAccount;
const AppointmentSetting = db.AppointmentSetting;
const { decrypt } = require('../utils/encryption-utils');
const axios = require('axios');
const { google } = require('googleapis');

class AppointmentService {
  async checkAvailability(userId, dateStr, timeStr, excludeAppointmentId = null) {
    try {
      let appSettings = await AppointmentSetting.findOne({ user_id: userId });
      if (!appSettings) {
        appSettings = await AppointmentSetting.create({ user_id: userId });
      }

      const appointmentDate = new Date(dateStr);
      const dayOfWeek = appointmentDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

      const daySlot = appSettings.slots ? appSettings.slots.find(s => s.day === dayOfWeek) : null;
      if (!daySlot || !daySlot.is_enabled || !daySlot.intervals || daySlot.intervals.length === 0) {
        const capitalizedDay = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1);
        return { available: false, reason: `We are closed on ${capitalizedDay}s.` };
      }

      const [appH, appM] = timeStr.split(':').map(Number);
      const appTotalMinutes = appH * 60 + appM;

      let inInterval = false;
      for (const interval of daySlot.intervals) {
        const [fromH, fromM] = interval.from.split(':').map(Number);
        const [toH, toM] = interval.to.split(':').map(Number);
        const fromMinutes = fromH * 60 + fromM;
        const toMinutes = toH * 60 + toM;

        if (appTotalMinutes >= fromMinutes && appTotalMinutes <= toMinutes) {
          inInterval = true;
          break;
        }
      }

      if (!inInterval) {
        return { available: false, reason: 'Selected time is outside our working hours or during a break.' };
      }

      if (!appSettings.allow_overlapping) {
        const query = {
          user_id: userId,
          appointment_date: appointmentDate,
          status: { $in: ['scheduled', 'confirmed', 'rescheduled'] },
          appointment_time: timeStr
        };
        if (excludeAppointmentId) {
          query._id = { $ne: excludeAppointmentId };
        }
        const existing = await Appointment.findOne(query);

        if (existing) {
          return { available: false, reason: 'This slot is already booked.' };
        }
      }

      if (appSettings.max_appointments_per_day) {
        const queryCount = {
          user_id: userId,
          appointment_date: appointmentDate,
          status: { $in: ['scheduled', 'confirmed', 'rescheduled'] }
        };
        if (excludeAppointmentId) {
          queryCount._id = { $ne: excludeAppointmentId };
        }
        const count = await Appointment.countDocuments(queryCount);

        if (count >= appSettings.max_appointments_per_day) {
          return { available: false, reason: 'We have reached our maximum appointments for this day.' };
        }
      }

      return { available: true };
    } catch (error) {
      console.error('Availability Check Error:', error);
      return { available: false, reason: 'Internal error checking availability' };
    }
  }

  async getGoogleAuth(settings) {
    const oauth2Client = new google.auth.OAuth2(
      settings.google_client_id,
      settings.google_client_secret,
      settings.google_redirect_uri
    );

    oauth2Client.setCredentials({
      access_token: settings.google_access_token,
      refresh_token: settings.google_refresh_token,
      expiry_date: settings.google_token_expiry ? new Date(settings.google_token_expiry).getTime() : null
    });

    oauth2Client.on('tokens', async (tokens) => {
      try {
        const update = {};
        if (tokens.access_token) update.google_access_token = tokens.access_token;
        if (tokens.expiry_date) update.google_token_expiry = new Date(tokens.expiry_date);
        if (tokens.refresh_token) update.google_refresh_token = tokens.refresh_token;

        if (Object.keys(update).length > 0) {
          await UserSettings.findOneAndUpdate({ user: settings.user }, update);
          console.log('[Google Auth] Access token auto-refreshed and saved.');
        }
      } catch (err) {
        console.error('[Google Auth] Failed to persist refreshed token:', err.message);
      }
    });

    return oauth2Client;
  }

  async syncToGoogleCalendar(userId, appointment, sendMeetLink = false, calendarId = null) {
    try {
      const googleAccount = await GoogleAccount.findOne({ user_id: userId, status: 'active', deleted_at: null });
      if (!googleAccount) {
        console.log('[Google Calendar] No active Google account found, skipping sync');
        return appointment;
      }

      if (!calendarId) {
        console.log('[Google Calendar] No calendar_id provided in flow, skipping sync');
        return appointment;
      }

      const accessToken = decrypt(googleAccount.access_token);

      const startDateTime = new Date(appointment.appointment_date);
      const [hours, minutes] = appointment.appointment_time.split(':').map(Number);
      startDateTime.setHours(hours, minutes);

      const endDateTime = new Date(startDateTime);
      endDateTime.setMinutes(startDateTime.getMinutes() + 30);

      const event = {
        summary: `Appointment: ${appointment.name}`,
        description: `Booked via AI Call. Phone: ${appointment.phone}`,
        start: { dateTime: startDateTime.toISOString() },
        end: { dateTime: endDateTime.toISOString() },
      };

      if (sendMeetLink) {
        event.conferenceData = {
          createRequest: {
            requestId: `meet-${appointment._id}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        };
      }

      const response = await axios.post(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
        event,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          params: sendMeetLink ? { conferenceDataVersion: 1 } : {}
        }
      );

      appointment.google_event_id = response.data.id;
      if (response.data.hangoutLink) {
        appointment.meet_link = response.data.hangoutLink;
      }
      await appointment.save();

      console.log(`[Google Calendar] Event created: ${response.data.htmlLink}`);
      return appointment;
    } catch (error) {
      console.error('[Google Calendar] Sync Error:', error.response?.data || error.message);
      return appointment;
    }
  }

  async updateGoogleCalendarEvent(userId, appointment, calendarId = null) {
    try {
      if (!appointment.google_event_id) {
        console.log('[Google Calendar Update] No google_event_id, cannot update.');
        return appointment;
      }

      const googleAccount = await GoogleAccount.findOne({ user_id: userId, status: 'active', deleted_at: null });
      if (!googleAccount) {
        console.log('[Google Calendar Update] No active Google account found, skipping update');
        return appointment;
      }

      if (!calendarId) {
        console.log('[Google Calendar Update] No calendar_id provided, skipping update');
        return appointment;
      }

      const accessToken = decrypt(googleAccount.access_token);

      const startDateTime = new Date(appointment.appointment_date);
      const [hours, minutes] = appointment.appointment_time.split(':').map(Number);
      startDateTime.setHours(hours, minutes);

      const endDateTime = new Date(startDateTime);
      endDateTime.setMinutes(startDateTime.getMinutes() + 30);

      const event = {
        summary: `Appointment: ${appointment.name} (${appointment.status})`,
        description: `Booked via AI Call. Phone: ${appointment.phone}\nStatus: ${appointment.status}`,
        start: { dateTime: startDateTime.toISOString() },
        end: { dateTime: endDateTime.toISOString() },
      };

      await axios.patch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${appointment.google_event_id}`,
        event,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[Google Calendar] Event updated: ${appointment.google_event_id}`);
      return appointment;
    } catch (error) {
      console.error('[Google Calendar Update] Error:', error.response?.data || error.message);
      return appointment;
    }
  }

  async syncToGoogleSheet(userId, appointment, spreadsheetId = null, sheetName = null, range = null) {
    try {
      const googleAccount = await GoogleAccount.findOne({ user_id: userId, status: 'active', deleted_at: null });
      if (!googleAccount) {
        console.log('[Google Sheet] No active Google account found, skipping sync');
        return;
      }

      if (!spreadsheetId) {
        console.log('[Google Sheet] No spreadsheet_id provided in flow, skipping sync');
        return;
      }

      const accessToken = decrypt(googleAccount.access_token);
      const targetSheetName = sheetName || 'Sheet1';
      const targetRange = range || 'A:E';
      const rangeStr = `${targetSheetName}!${targetRange}`;
      const values = [[
        appointment.name,
        appointment.phone,
        appointment.appointment_date.toDateString(),
        appointment.appointment_time,
        appointment.status
      ]];

      await axios.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${rangeStr}:append?valueInputOption=USER_ENTERED`,
        { values },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[Google Sheet] Row appended to ${spreadsheetId}`);
    } catch (error) {
      console.error('[Google Sheet] Sync Error:', error.response?.data || error.message);
    }
  }

  async updateGoogleSheetRow(userId, appointment, spreadsheetId = null, sheetName = null, range = null) {
    try {
      const googleAccount = await GoogleAccount.findOne({ user_id: userId, status: 'active', deleted_at: null });
      if (!googleAccount || !spreadsheetId) return;

      const accessToken = decrypt(googleAccount.access_token);
      const targetSheetName = sheetName || 'Sheet1';
      
      const getResponse = await axios.get(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${targetSheetName}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );

      const rows = getResponse.data.values;
      if (!rows || rows.length === 0) {
        return this.syncToGoogleSheet(userId, appointment, spreadsheetId, sheetName, range);
      }

      let rowIndexToUpdate = -1;
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i] || [];
        if (row.includes(appointment.phone)) {
          rowIndexToUpdate = i;
          break;
        }
      }

      if (rowIndexToUpdate === -1) {
        console.log('[Google Sheet Update] Phone not found, appending instead.');
        return this.syncToGoogleSheet(userId, appointment, spreadsheetId, sheetName, range);
      }

      const sheetRowNumber = rowIndexToUpdate + 1;
      const values = [[
        appointment.name,
        appointment.phone,
        appointment.appointment_date.toDateString(),
        appointment.appointment_time,
        appointment.status
      ]];

      const updateRange = `${targetSheetName}!A${sheetRowNumber}:E${sheetRowNumber}`;

      await axios.put(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${updateRange}?valueInputOption=USER_ENTERED`,
        { values },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[Google Sheet] Row ${sheetRowNumber} updated in ${spreadsheetId}`);
    } catch (error) {
      console.error('[Google Sheet Update] Error:', error.response?.data || error.message);
    }
  }
}

module.exports = new AppointmentService();
