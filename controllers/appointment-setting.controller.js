'use strict';

const { db } = require('../models');
const AppointmentSetting = db.AppointmentSetting;

exports.getAppointmentSetting = async (req, res) => {
  try {
    const userId = req.user.id;
    let appSettings = await AppointmentSetting.findOne({ user_id: userId });

    if (!appSettings) {
      appSettings = await AppointmentSetting.create({ user_id: userId });
    }

    res.status(200).json({
      success: true,
      data: appSettings
    });
  } catch (error) {
    console.error('Error getting appointment settings:', error);
    res.status(500).json({ success: false, message: 'Failed to get appointment settings' });
  }
};

exports.updateAppointmentSetting = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      allow_overlapping,
      buffer_time,
      max_appointments_per_day,
      confirmation_channel,
      confirmation_message_template,
      slots
    } = req.body;

    let appSettings = await AppointmentSetting.findOne({ user_id: userId });
    if (!appSettings) {
      appSettings = new AppointmentSetting({ user_id: userId });
    }

    if (allow_overlapping !== undefined) appSettings.allow_overlapping = allow_overlapping;
    if (buffer_time !== undefined) appSettings.buffer_time = buffer_time;
    if (max_appointments_per_day !== undefined) appSettings.max_appointments_per_day = max_appointments_per_day;
    if (confirmation_channel !== undefined) appSettings.confirmation_channel = confirmation_channel;
    if (confirmation_message_template !== undefined) appSettings.confirmation_message_template = confirmation_message_template;
    if (slots !== undefined) appSettings.slots = slots;

    await appSettings.save();

    res.status(200).json({
      success: true,
      message: 'Appointment settings updated successfully',
      data: appSettings
    });
  } catch (error) {
    console.error('Error updating appointment settings:', error);
    res.status(500).json({ success: false, message: 'Failed to update appointment settings' });
  }
};
