const mongoose = require('mongoose')
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper')

const CampaignSchema = new Schema(
  {
    name: {
      type: String,
      required: true
    },
    typeId: {
      type: Schema.Types.ObjectId,
      ref: 'CampaignType',
      required: true
    },
    description: {
      type: String,
      default: ''
    },
    agentId: {
      type: Schema.Types.ObjectId,
      ref: 'Agent',
      required: true
    },
    phoneNumberId: {
      type: Schema.Types.ObjectId,
      refPath: 'phoneNumberModel',
      required: true
    },
    phoneNumberModel: {
      type: String,
      required: true,
      enum: ['PhoneNumber', 'WhatsappPhoneNumber'],
      default: 'PhoneNumber'
    },
    callSchedule: {
      type: new Schema({
        callStartTime: { type: String, required: true },
        callEndTime: { type: String, required: true },
        timeZone: { type: String, default: 'Asia/Kolkata' },
        dayOfWeek: [{ type: String, enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], required: true }]
      })
    },
    autoRetrySettings: {
      type: new Schema({
        enabled: { type: Boolean, default: false },
        maxAttempts: { type: Number, default: 3 },
        retryInterval: { type: String, default: '1 hour' },
        retryWhen: [{ type: String, enum: ['No Answer', 'Busy', 'Call Failed'], default: ['No Answer'] }]
      }, { _id: false }),
      default: undefined
    },
    contactFile: {
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
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    campaignStatus: {
      type: String,
      enum: ['Draft', 'Active', 'Completed', 'Failed', 'Paused', 'Cancelled'],
      default: 'Draft'
    },
    fail_reason: {
      type: String
    }
  },
  {
    collection: 'campaigns',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
)

addVirtualId(CampaignSchema)

CampaignSchema.index({ name: 1 }, {
  unique: true,
  collation: { locale: 'en', strength: 2 }
});

module.exports = mongoose.model('Campaign', CampaignSchema)