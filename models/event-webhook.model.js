'use strict';

const mongoose = require('mongoose');

const EventWebhookSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    endpoint_url: {
      type: String,
      required: true,
      trim: true
    },
    events: [{
      type: String,
      enum: [
        'Call Initiated',
        'Call Ringing',
        'Call Picked Up',
        'Call Finished',
        'Call Errored',
        'Call Redirected',
        'Unanswered',
        'Number Busy',
        'Left Voicemail',
        'Inbound Call Arrived',
        'Inbound Call Handled',
        'Inbound Call Finished',
        'Inbound Call Unanswered',
        'Campaign Initiated',
        'Campaign Halted',
        'Campaign Restarted',
        'Campaign Finished',
        'Campaign Errored',
        'Campaign Aborted',
        'Flow Initiated',
        'Flow Finished',
        'Flow Errored'
      ]
    }],
    is_active: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    collection: 'event_webhooks'
  }
);

EventWebhookSchema.virtual('id').get(function() {
  return this._id.toHexString();
});

EventWebhookSchema.set('toJSON', {
  virtuals: true
});

module.exports = mongoose.model('EventWebhook', EventWebhookSchema);
