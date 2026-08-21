'use strict';

const { db } = require('../models');
const Appointment = db.Appointment;
const Flow = db.Flow;
const appointmentService = require('../services/appointmentService');
const smsAutomationService = require('../services/smsAutomationService');

exports.getAppointments = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, date, range, search, page = 1, limit = 10, sortBy = 'appointment_date', sortOrder = 'desc' } = req.query;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    let query = { user_id: userId };
    if (status && status !== 'all') query.status = status;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query.appointment_date = { $gte: start, $lte: end };
    } else if (range === 'today') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      query.appointment_date = { $gte: start, $lte: end };
    } else if (range === 'upcoming') {
      query.appointment_date = { $gte: new Date() };
      if (!query.status) query.status = { $in: ['scheduled', 'confirmed'] };
    } else if (range === 'past') {
      query.appointment_date = { $lt: new Date() };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const appointments = await Appointment.find(query)
      .populate('call_id', 'twilio_call_sid from_number to_number duration')
      .populate('flow_id', 'name')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Appointment.countDocuments(query);
    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({ 
      success: true, 
      data: appointments,
      pagination: {
        total,
        page: parseInt(page),
        pages: totalPages
      }
    });
  } catch (error) {
    console.error('Get Appointments Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.getStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    const [total, upcoming, completed, cancelled, rescheduled] = await Promise.all([
      Appointment.countDocuments({ user_id: userId }),
      Appointment.countDocuments({
        user_id: userId,
        appointment_date: { $gte: now },
        status: { $in: ['scheduled', 'confirmed'] }
      }),
      Appointment.countDocuments({ user_id: userId, status: 'completed' }),
      Appointment.countDocuments({ user_id: userId, status: 'cancelled' }),
      Appointment.countDocuments({ user_id: userId, status: 'rescheduled' }),
    ]);

    res.json({
      success: true,
      data: { total, upcoming, completed, cancelled, rescheduled }
    });
  } catch (error) {
    console.error('Get Stats Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { status, appointment_date, appointment_time } = req.body;

    const validStatuses = ['scheduled', 'confirmed', 'completed', 'rescheduled', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    if (appointment_date && appointment_time) {
      const check = await appointmentService.checkAvailability(userId, appointment_date, appointment_time, id);
      if (!check.available) {
        return res.status(400).json({ success: false, message: check.reason });
      }
    }

    const updateData = { status };
    if (appointment_date) {
      const dateObj = new Date(appointment_date);
      dateObj.setHours(0, 0, 0, 0);
      updateData.appointment_date = dateObj;
    }
    if (appointment_time) {
      updateData.appointment_time = appointment_time;
    }

    const appointment = await Appointment.findOneAndUpdate(
      { _id: id, user_id: userId },
      updateData,
      { new: true }
    );

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }

    if (appointment.flow_id) {
      const flow = await Flow.findById(appointment.flow_id);
      if (flow && flow.nodes) {
        const bookNode = flow.nodes.find(n => n.type === 'book_slot');
        if (bookNode && bookNode.data) {
          const googleCalendarId = bookNode.data.google_calendar_id || null;
          if (googleCalendarId && appointment.google_event_id) {
            await appointmentService.updateGoogleCalendarEvent(userId, appointment, googleCalendarId);
          }
          
          const googleSheetId = bookNode.data.google_sheet_id || null;
          const googleSheetName = bookNode.data.google_sheet_name || null;
          const googleSheetRange = bookNode.data.google_sheet_range || null;
          
          if (googleSheetId) {
             await appointmentService.updateGoogleSheetRow(userId, appointment, googleSheetId, googleSheetName, googleSheetRange);
          }
        }
      }
    }

    if (status === 'rescheduled' && appointment_date && appointment_time) {
      await smsAutomationService.sendRescheduleSMS(userId, appointment);
    }

    res.json({ success: true, message: 'Status updated', data: appointment });
  } catch (error) {
    console.error('Update Status Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
