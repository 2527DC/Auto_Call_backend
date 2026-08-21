const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const CookieSchema = new Schema(
  {
    consent_id: {
      type: String,
      required: true,
      index: true
    },
    consent_type: {
      type: String,
      enum: ['accept', 'decline', 'preferences'],
      required: true
    },
    preferences: {
      type: Schema.Types.Mixed,
      default: {
        essential: true,
        call_history: true,
        ai_personalization: false,
        analytics: false
      }
    },
    ip_address: {
      type: String,
      default: ''
    },
    user_agent: {
      type: String,
      default: ''
    },
    logged_at: {
      type: Date,
      default: Date.now,
      required: true
    }
  },
  {
    collection: 'cookie_consent_logs',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(CookieSchema);

CookieSchema.index({ consent_id: 1, logged_at: -1 });

module.exports = mongoose.model('CookieConsentLog', CookieSchema);
