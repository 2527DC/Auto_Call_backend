const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const emailLogSchema = new Schema(
  {
    campaign: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    to: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    status: {
      type: String,
      enum: ['queued', 'sent', 'failed', 'bounced'],
      default: 'queued'
    },
    error: {
      type: String
    },
    sentAt: {
      type: Date
    }
  },
  {
    collection: 'email_logs',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

addVirtualId(emailLogSchema);

emailLogSchema.index({ campaign: 1, user: 1 });
emailLogSchema.index({ status: 1 });
emailLogSchema.index({ sentAt: -1 });
emailLogSchema.index({ created_at: -1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);