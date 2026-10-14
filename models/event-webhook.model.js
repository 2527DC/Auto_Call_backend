'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const newSecret = () => `whsec_${crypto.randomBytes(24).toString('hex')}`;

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
        'Flow Errored',
        'Call Analyzed',
        'Lead Status Changed',
        'Follow-up Due'
      ]
    }],
    is_active: {
      type: Boolean,
      default: true
    },
    // Signs every delivery (X-Voxeno-Signature), so the receiver can check it came from us.
    // Set on save, not as a default: a default would be filled in (unsaved, and
    // different each time) whenever a webhook saved before signing is loaded.
    secret: {
      type: String
    },
    // Call transcripts are personal data: sent only to webhooks that ask for them.
    include_transcript: {
      type: Boolean,
      default: false
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

EventWebhookSchema.pre('save', function () {
  if (!this.secret) this.secret = newSecret();
});

EventWebhookSchema.statics.newSecret = newSecret;

module.exports = mongoose.model('EventWebhook', EventWebhookSchema);
