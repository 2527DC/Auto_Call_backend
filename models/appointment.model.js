const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const AppointmentSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    call_id: {
      type: Schema.Types.ObjectId,
      ref: 'Call',
      default: null
    },
    flow_id: {
      type: Schema.Types.ObjectId,
      ref: 'Flow',
      default: null
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true
    },
    appointment_date: {
      type: Date,
      required: true
    },
    appointment_time: {
      type: String,
      required: true
    },
    appointment_type: {
      type: String,
      default: 'General'
    },
    status: {
      type: String,
      enum: ['scheduled', 'confirmed', 'completed', 'rescheduled', 'cancelled'],
      default: 'scheduled'
    },
    google_event_id: {
      type: String,
      default: null
    },
    meet_link: {
      type: String,
      default: null
    },
    notes: {
      type: String,
      default: ''
    }
  },
  {
    collection: 'appointments',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(AppointmentSchema);

AppointmentSchema.index({ user_id: 1 });
AppointmentSchema.index({ appointment_date: 1 });
AppointmentSchema.index({ status: 1 });

module.exports = mongoose.model('Appointment', AppointmentSchema);
