const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SMSLogSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    campaign_id: {
      type: Schema.Types.ObjectId,
      ref: 'SMSCampaign',
      default: null
    },
    lead_name: {
      type: String,
      default: ''
    },
    fail_reason: {
      type: String,
      default: ''
    },
    twilio_message_sid: {
      type: String,
      default: null
    },
    from_number: {
      type: String,
      required: true
    },
    to_number: {
      type: String,
      required: true
    },
    message_body: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['queued', 'sent', 'delivered', 'failed'],
      default: 'queued'
    },
    direction: {
      type: String,
      enum: ['outbound', 'inbound'],
      default: 'outbound'
    },
    started_at: {
      type: Date,
      default: Date.now
    }
  },
  {
    collection: 'sms_logs',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(SMSLogSchema);

SMSLogSchema.index({ user_id: 1 });
SMSLogSchema.index({ campaign_id: 1 });
SMSLogSchema.index({ twilio_message_sid: 1 });

module.exports = mongoose.model('SMSLog', SMSLogSchema);
