const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SMSCampaignSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    typeId: {
      type: Schema.Types.ObjectId,
      ref: 'CampaignType',
      required: true
    },
    phoneNumberId: {
      type: Schema.Types.ObjectId,
      ref: 'PhoneNumber',
      required: true
    },
    smsAgentId: {
      type: Schema.Types.ObjectId,
      ref: 'SMSAgent',
      required: true
    },
    content: {
      type: String,
      required: true
    },
    SMSSchedule: {
      type: new Schema({
        callStartTime: { type: String, required: true },
        callEndTime: { type: String, required: true },
        timeZone: { type: String, default: 'Asia/Kolkata' },
        dayOfWeek: [{ type: String, enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], required: true }]
      })
    },
    contact_file: {
      type: String,
    },
    contactIds: [{
      type: Schema.Types.ObjectId,
      ref: 'Contact'
    }],
    contactGroupIds: [{
      type: Schema.Types.ObjectId,
      ref: 'ContactGroup'
    }],
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['Draft', 'Active', 'Completed', 'Failed', 'Paused', 'Cancelled'],
      default: 'Draft'
    },
    fail_reason: {
      type: String
    }
  },
  {
    collection: 'sms_campaigns',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
)

addVirtualId(SMSCampaignSchema)

SMSCampaignSchema.index({ user_id: 1, name: 1 })

module.exports = mongoose.model('SMSCampaign', SMSCampaignSchema);