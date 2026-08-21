const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const GoogleCalendarSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    google_account_id: {
      type: Schema.Types.ObjectId,
      ref: 'GoogleAccount',
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    calendar_id: {
      type: String,
      trim: true
    },

    is_active: {
      type: Boolean,
      default: true
    },
    is_linked: {
      type: Boolean,
      default: false
    },
    description: {
      type: String,
      default: ''
    },
    timezone: {
      type: String,
      default: 'UTC'
    },

    last_synced_at: {
      type: Date,
      default: null
    },
    deleted_at: {
      type: Date,
      default: null
    }
  },
  {
    collection: 'google_calendars',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(GoogleCalendarSchema);

GoogleCalendarSchema.index({ user_id: 1 });
GoogleCalendarSchema.index({ user_id: 1, is_active: 1 });

module.exports = mongoose.model('GoogleCalendar', GoogleCalendarSchema);
