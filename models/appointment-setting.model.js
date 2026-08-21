const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SlotIntervalSchema = new Schema({
  from: { type: String, required: true },
  to: { type: String, required: true }
}, { _id: false });

const SlotSchema = new Schema({
  day: {
    type: String,
    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    required: true
  },
  intervals: [SlotIntervalSchema],
  is_enabled: { type: Boolean, default: true }
}, { _id: false });

const AppointmentSettingSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    allow_overlapping: {
      type: Boolean,
      default: false
    },
    buffer_time: {
      type: Number,
      default: 5
    },
    max_appointments_per_day: {
      type: Number,
      default: null
    },
    confirmation_channel: {
      type: String,
      enum: ['none', 'sms', 'whatsapp'],
      default: 'none'
    },
    confirmation_message_template: {
      type: String,
      default: ''
    },
    slots: {
      type: [SlotSchema],
      default: [
        { day: 'monday', intervals: [{ from: '09:00', to: '17:00' }], is_enabled: true },
        { day: 'tuesday', intervals: [{ from: '09:00', to: '17:00' }], is_enabled: true },
        { day: 'wednesday', intervals: [{ from: '09:00', to: '17:00' }], is_enabled: true },
        { day: 'thursday', intervals: [{ from: '09:00', to: '17:00' }], is_enabled: true },
        { day: 'friday', intervals: [{ from: '09:00', to: '17:00' }], is_enabled: true },
        { day: 'saturday', intervals: [{ from: '09:00', to: '17:00' }], is_enabled: false },
        { day: 'sunday', intervals: [{ from: '09:00', to: '17:00' }], is_enabled: false }
      ]
    }
  },
  {
    collection: 'appointment_settings',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(AppointmentSettingSchema);

AppointmentSettingSchema.index({ user_id: 1 });

module.exports = mongoose.model('AppointmentSetting', AppointmentSettingSchema);
