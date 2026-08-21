const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SmsSessionSchema = new Schema(
  {
    contact_id: {
      type: Schema.Types.ObjectId,
      ref: 'Contact',
      default: null
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    phone_number: {
      type: String,
      required: true
    },
    campaign_id: {
      type: Schema.Types.ObjectId,
      ref: 'SMSCampaign',
      default: null
    },
    agent_id: {
      type: Schema.Types.ObjectId,
      ref: 'SMSAgent',
      default: null
    },
    assigned_member_id: {
      type: Schema.Types.ObjectId,
      ref: 'TeamMember',
      default: null
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'human_takeover'],
      default: 'active'
    },
    is_human_takeover: {
      type: Boolean,
      default: false
    }
  },
  {
    collection: 'sms_sessions',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(SmsSessionSchema);

SmsSessionSchema.index({ phone_number: 1 });
SmsSessionSchema.index({ user_id: 1 });
SmsSessionSchema.index({ status: 1 });

module.exports = mongoose.model('SmsSession', SmsSessionSchema);