'use strict';

const { db } = require('../models');
const GoogleCalendar = db.GoogleCalendar;
const { getAuthenticatedClient, handleGoogleApiError } = require('../utils/google-api-helper');
const axios = require('axios');

exports.createGoogleCalendar = async (req, res) => {
  try {
    const userId = req.user.id;
    const { google_account_id, name, is_active, description, timezone, create_in_google } = req.body;

    if (!google_account_id) {
      return res.status(400).json({ success: false, message: 'google_account_id is required' });
    }

    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    let finalCalendarId = '';

    if (create_in_google) {
      try {
        const authClient = await getAuthenticatedClient(google_account_id);
        const { token: accessToken } = await authClient.getAccessToken();
        
        const response = await axios.post(
          'https://www.googleapis.com/calendar/v3/calendars',
          { 
            summary: name,
            description: description || '',
            timeZone: timezone || 'UTC'
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        finalCalendarId = response.data.id;
      } catch (error) {
        const wasHandled = await handleGoogleApiError(error, google_account_id);
        const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
        return res.status(500).json({ success: false, message });
      }
    }

    const calendar = await GoogleCalendar.create({
      user_id: userId,
      google_account_id,
      name,
      calendar_id: finalCalendarId,

      is_active: is_active !== undefined ? is_active : true,
      is_linked: Boolean(create_in_google),
      description: description || '',
      timezone: timezone || 'UTC',

    });

    res.status(201).json({ success: true, message: 'Google Calendar added successfully', data: calendar });
  } catch (error) {
    console.error('Create Google Calendar Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to create Google Calendar' });
  }
};

exports.updateGoogleCalendar = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updateData = { ...req.body };

    delete updateData.user_id;
    delete updateData.google_account_id;

    const calendar = await GoogleCalendar.findOne({ _id: id, user_id: userId, deleted_at: null });
    if (!calendar) {
      return res.status(404).json({ success: false, message: 'Google Calendar not found' });
    }

    if ((updateData.name || updateData.description) && calendar.is_linked) {
      try {
        const authClient = await getAuthenticatedClient(calendar.google_account_id);
        const { token: accessToken } = await authClient.getAccessToken();
        
        await axios.patch(
          `https://www.googleapis.com/calendar/v3/calendars/${calendar.calendar_id}`,
          {
            summary: updateData.name || calendar.name,
            description: updateData.description !== undefined ? updateData.description : calendar.description
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (error) {
        const wasHandled = await handleGoogleApiError(error, calendar.google_account_id);
        const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
        return res.status(500).json({ success: false, message });
      }
    }

    const updatedCalendar = await GoogleCalendar.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    res.json({ 
      success: true, 
      message: 'Google Calendar updated successfully', 
      data: updatedCalendar 
    });
  } catch (error) {
    console.error('Update Google Calendar Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update Google Calendar' });
  }
};

exports.getGoogleCalendars = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      search, 
      name,
      calendar_id,

      is_active,
      timezone,
      sort_by = 'created_at',
      sort_order = 'desc',
      page = 1, 
      limit = 10 
    } = req.query;

    const query = { user_id: userId, deleted_at: null };
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { calendar_id: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { timezone: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (name) query.name = { $regex: name, $options: 'i' };
    if (calendar_id) query.calendar_id = calendar_id;

    if (is_active !== undefined) query.is_active = is_active === 'true';
    if (timezone) query.timezone = timezone;

    const sortOptions = {};
    const allowedSortFields = ['name', 'calendar_id', 'is_active', 'timezone', 'created_at', 'updated_at', 'last_synced_at'];
    
    if (allowedSortFields.includes(sort_by)) {
      sortOptions[sort_by] = sort_order === 'asc' ? 1 : -1;
    } else {
      sortOptions.created_at = -1;
    }

    const total = await GoogleCalendar.countDocuments(query);
    const calendars = await GoogleCalendar.find(query)
      .sort(sortOptions)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: calendars,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error('Get Google Calendars Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.deleteGoogleCalendar = async (req, res) => {
  try {
    const { id } = req.params;
    const { delete_from } = req.query;
    const userId = req.user.id;

    const calendar = await GoogleCalendar.findOne({ _id: id, user_id: userId, deleted_at: null });
    if (!calendar) {
      return res.status(404).json({ success: false, message: 'Google Calendar not found' });
    }

    if (delete_from === 'google' && calendar.is_linked) {
      try {
        const authClient = await getAuthenticatedClient(calendar.google_account_id);
        const { token: accessToken } = await authClient.getAccessToken();
        
        await axios.delete(
          `https://www.googleapis.com/calendar/v3/calendars/${calendar.calendar_id}`,
          { headers: { Authorization: `Bearer ${accessToken}` }}
        );
      } catch (error) {
        const wasHandled = await handleGoogleApiError(error, calendar.google_account_id);
        const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
        return res.status(500).json({ success: false, message });
      }
    }

    calendar.deleted_at = new Date();
    calendar.is_active = false;
    await calendar.save();

    res.json({ 
      success: true, 
      message: delete_from === 'google'
        ? 'Calendar deleted from both Google and Platform'
        : 'Calendar removed from Platform only' 
    });
  } catch (error) {
    console.error('Delete Google Calendar Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.bulkDeleteGoogleCalendars = async (req, res) => {
  try {
    const { ids, delete_from } = req.body;
    const userId = req.user.id;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'IDs array is required' });
    }

    const results = { success: [], failed: [] };

    for (const id of ids) {
      try {
        const calendar = await GoogleCalendar.findById(id);
        if (!calendar || calendar.user_id.toString() !== userId.toString()) {
          results.failed.push({ id, message: 'Calendar not found' });
          continue;
        }

        if (delete_from === 'google' && calendar.is_linked) {
          try {
            const authClient = await getAuthenticatedClient(calendar.google_account_id);
            const { token: accessToken } = await authClient.getAccessToken();
            
            await axios.delete(
              `https://www.googleapis.com/calendar/v3/calendars/${calendar.calendar_id}`,
              { headers: { Authorization: `Bearer ${accessToken}` }}
            );
          } catch (error) {
            console.error(`Failed to delete calendar ${id} from Google:`, error.message);
          }
        }

        calendar.deleted_at = new Date();
        calendar.is_active = false;
        await calendar.save();
        results.success.push(id);
      } catch (err) {
        results.failed.push({ id, message: err.message });
      }
    }

    res.json({ success: true, message: `Successfully deleted ${results.success.length} calendars`, results});
  } catch (error) {
    console.error('Bulk Delete Google Calendars Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// exports.fetchCalendars = async (req, res) => {
//   try {
//     const { google_account_id } = req.params;
//     const userId = req.user.id;

//     const authClient = await getAuthenticatedClient(google_account_id);
//     const { token: accessToken } = await authClient.getAccessToken();
    
//     const response = await axios.get(
//       'https://www.googleapis.com/calendar/v3/users/me/calendarList',
//       {
//         headers: {
//           Authorization: `Bearer ${accessToken}`
//         }
//       }
//     );
    
//     const calendars = response.data.items;

//     for (const cal of calendars) {
//       await GoogleCalendar.findOneAndUpdate(
//         { google_account_id, calendar_id: cal.id },
//         { 
//           name: cal.summary,
//           timezone: cal.timeZone || 'UTC',
//           is_primary: cal.primary || false,
//           deleted_at: null 
//         },
//         { upsert: true, new: true }
//       );
//     }

//     const savedCalendars = await GoogleCalendar.find({ google_account_id, deleted_at: null }).lean();

//     res.json({ success: true, calendars: savedCalendars });
//   } catch (error) {
//     console.error('Fetch Google calendars error:', error);
//     const wasHandled = await handleGoogleApiError(error, google_account_id);
//     const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
//     res.status(500).json({ success: false, message });
//   }
// };

exports.linkCalendar = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const calendar = await GoogleCalendar.findOne({ _id: id, user_id: userId, deleted_at: null });
    if (!calendar) {
      return res.status(404).json({ success: false, message: 'Calendar not found' });
    }

    if (calendar.is_linked) {
      return res.status(400).json({ success: false, message: 'Calendar is already linked' });
    }

    const authClient = await getAuthenticatedClient(calendar.google_account_id);
    const { token: accessToken } = await authClient.getAccessToken();

    const response = await axios.post(
      'https://www.googleapis.com/calendar/v3/calendars',
      {
        summary: calendar.name,
        description: calendar.description || '',
        timeZone: calendar.timezone || 'UTC'
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    calendar.calendar_id = response.data.id;
    calendar.is_linked = true;
    await calendar.save();

    res.json({ success: true, calendar, message: 'Calendar linked successfully' });
  } catch (error) {
    console.error('Link Google calendar error:', error.response?.data || error.message);
    const wasHandled = await handleGoogleApiError(error, req.params.id);
    let message = 'Failed to link calendar';
    if (error.response?.data?.error?.message) {
      message = error.response.data.error.message;
    } else if (wasHandled) {
      message = 'Google account unauthorized or expired. Please reconnect.';
    }
    res.status(500).json({ success: false, message });
  }
};

exports.syncCalendars = async (req, res) => {
  try {
    const userId = req.user.id;
    const { google_account_id } = req.params;
    const { calendars } = req.body;

    if (!google_account_id) {
      return res.status(400).json({ success: false, message: 'google_account_id is required' });
    }

    if (!calendars || !Array.isArray(calendars) || calendars.length === 0) {
      const authClient = await getAuthenticatedClient(google_account_id);
      const { token: accessToken } = await authClient.getAccessToken();
      
      const response = await axios.get(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
        {
          params: {
            fields: 'items(id, summary, timeZone, primary)'
          },
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      const existingCalendars = await GoogleCalendar.find({
        google_account_id,
        user_id: userId,
        deleted_at: null
      }).select('calendar_id');
      const existingCalendarIds = existingCalendars.map(c => c.calendar_id);
      
      const availableCalendars = response.data.items.filter(
        c => !existingCalendarIds.includes(c.id)
      );

      return res.json({ success: true, mode: 'list', calendars: availableCalendars });
    }

    const syncedCalendars = [];
    for (const cal of calendars) {
      const updatedCalendar = await GoogleCalendar.findOneAndUpdate(
        { google_account_id, calendar_id: cal.id, user_id: userId },
        { 
          name: cal.summary, 
          timezone: cal.timeZone || 'UTC',

          deleted_at: null, 
          is_linked: true 
        },
        { upsert: true, new: true }
      );
      syncedCalendars.push(updatedCalendar);
    }

    res.json({
      success: true,
      mode: 'sync',
      message: `${syncedCalendars.length} calendars synced successfully`,
      calendars: syncedCalendars
    });
  } catch (error) {
    console.error('Google Calendars sync error:', error.response?.data || error.message);
    const wasHandled = await handleGoogleApiError(error, req.body.google_account_id);
    const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
    res.status(500).json({ success: false, message });
  }
};

exports.listUserGoogleCalendars = async (req, res) => {
  try {
    const userId = req.user.id;

    const calendars = await GoogleCalendar.find({ 
      user_id: userId, 
      is_active: true,
      deleted_at: null 
    }).select('name calendar_id google_account_id');

    res.json({ success: true, data: calendars });
  } catch (error) {
    console.error('List User Google Calendars Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.listEvents = async (req, res) => {
  try {
    const { calendar_id } = req.params;
    const { timeMin, timeMax, maxResults = 100 } = req.query;
    const userId = req.user.id;

    const calendar = await GoogleCalendar.findOne({
      _id: calendar_id,
      user_id: userId,
      deleted_at: null
    });

    if (!calendar) {
      return res.status(404).json({ success: false, message: 'Calendar not found' });
    }

    const authClient = await getAuthenticatedClient(calendar.google_account_id);
    const { token: accessToken } = await authClient.getAccessToken();

    const response = await axios.get(
      `https://www.googleapis.com/calendar/v3/calendars/${calendar.calendar_id}/events`,
      {
        params: {
          timeMin: timeMin || new Date().toISOString(),
          timeMax: timeMax || undefined,
          maxResults: parseInt(maxResults),
          singleEvents: true,
          orderBy: 'startTime'
        },
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    res.json({
      success: true,
      events: response.data.items.map(item => ({
        id: item.id,
        summary: item.summary,
        description: item.description,
        location: item.location,
        start: item.start,
        end: item.end,
        status: item.status,
        attendees: item.attendees || [],
        htmlLink: item.htmlLink
      }))
    });
  } catch (error) {
    console.error('List Google Events Error:', error);
    const wasHandled = await handleGoogleApiError(error, req.params.calendar_id);
    const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
    res.status(500).json({ success: false, message });
  }
};

exports.createEvent = async (req, res) => {
  try {
    const { calendar_id } = req.params;
    const userId = req.user.id;
    const {
      summary,
      description,
      location,
      start,
      end,
      attendees,
      reminders,
      conferenceData
    } = req.body;

    const calendar = await GoogleCalendar.findOne({
      _id: calendar_id,
      user_id: userId,
      deleted_at: null
    });

    if (!calendar) {
      return res.status(404).json({ success: false, message: 'Calendar not found' });
    }

    const authClient = await getAuthenticatedClient(calendar.google_account_id);
    const { token: accessToken } = await authClient.getAccessToken();

    const requestBody = {
      summary,
      description: description || '',
      location: location || '',
      start: start,
      end: end
    };

    if (attendees && attendees.length > 0) {
      requestBody.attendees = attendees;
    }

    if (reminders) {
      requestBody.reminders = reminders;
    }

    if (conferenceData) {
      requestBody.conferenceData = conferenceData;
    }

    const response = await axios.post(
      `https://www.googleapis.com/calendar/v3/calendars/${calendar.calendar_id}/events`,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          conferenceDataVersion: conferenceData ? 1 : 0
        }
      }
    );

    res.status(201).json({
      success: true,
      message: 'Event created successfully',
      event: response.data
    });
  } catch (error) {
    console.error('Create Google Event Error:', error);
    const wasHandled = await handleGoogleApiError(error, req.params.calendar_id);
    const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
    res.status(500).json({ success: false, message });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const { calendar_id, event_id } = req.params;
    const userId = req.user.id;
    const {
      summary,
      description,
      location,
      start,
      end,
      attendees,
      reminders,
      status
    } = req.body;

    const calendar = await GoogleCalendar.findOne({
      _id: calendar_id,
      user_id: userId,
      deleted_at: null
    });

    if (!calendar) {
      return res.status(404).json({ success: false, message: 'Calendar not found' });
    }

    const authClient = await getAuthenticatedClient(calendar.google_account_id);
    const { token: accessToken } = await authClient.getAccessToken();

    const requestBody = {};
    if (summary !== undefined) requestBody.summary = summary;
    if (description !== undefined) requestBody.description = description;
    if (location !== undefined) requestBody.location = location;
    if (start !== undefined) requestBody.start = start;
    if (end !== undefined) requestBody.end = end;
    if (attendees !== undefined) requestBody.attendees = attendees;
    if (reminders !== undefined) requestBody.reminders = reminders;
    if (status !== undefined) requestBody.status = status;

    const response = await axios.put(
      `https://www.googleapis.com/calendar/v3/calendars/${calendar.calendar_id}/events/${event_id}`,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      message: 'Event updated successfully',
      event: response.data
    });
  } catch (error) {
    console.error('Update Google Event Error:', error);
    const wasHandled = await handleGoogleApiError(error, req.params.calendar_id);
    const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
    res.status(500).json({ success: false, message });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const { calendar_id, event_id } = req.params;
    const userId = req.user.id;

    const calendar = await GoogleCalendar.findOne({
      _id: calendar_id,
      user_id: userId,
      deleted_at: null
    });

    if (!calendar) {
      return res.status(404).json({ success: false, message: 'Calendar not found' });
    }

    const authClient = await getAuthenticatedClient(calendar.google_account_id);
    const { token: accessToken } = await authClient.getAccessToken();

    await axios.delete(
      `https://www.googleapis.com/calendar/v3/calendars/${calendar.calendar_id}/events/${event_id}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });
  } catch (error) {
    console.error('Delete Google Event Error:', error);
    const wasHandled = await handleGoogleApiError(error, req.params.calendar_id);
    const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
    res.status(500).json({ success: false, message });
  }
};