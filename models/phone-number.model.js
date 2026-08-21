const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const PhoneNumberSchema = new Schema(
  {
    phone_number: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    sid: {
      type: String,
      unique: true,
      sparse: true
    },
    type: {
      type: String,
      enum: ['verified', 'purchased', 'sip'],
      required: true
    },
    is_system_pool: {
      type: Boolean,
      default: true
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    provider: {
      type: String,
      default: 'twilio'
    },
    sip_trunk_id: {
      type: Schema.Types.ObjectId,
      ref: 'SipTrunk',
      default: null
    },
    label: {
      type: String,
      default: null
    },
    capabilities: {
      type: [String],
      default: ['inbound', 'outbound']
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },
    is_synced_to_elevenlabs: {
      type: Boolean,
      default: false
    },
    elevenlabs_phone_number_id: {
      type: String,
      default: null
    },
    agent_id: {
      type: Schema.Types.ObjectId,
      ref: 'Agent',
      default: null
    },
    purchase_price: {
      type: Number,
      default: 0
    },
    validity_days: {
      type: Number,
      default: 0
    },
    expires_at: {
      type: Date,
      default: null
    }
  },
  {
    collection: 'phone_numbers',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(PhoneNumberSchema);

PhoneNumberSchema.index({ phone_number: 1 });
PhoneNumberSchema.index({ is_system_pool: 1 });
PhoneNumberSchema.index({ user_id: 1 });

module.exports = mongoose.model('PhoneNumber', PhoneNumberSchema);