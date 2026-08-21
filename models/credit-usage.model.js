const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const CreditUsageSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    transaction_type: {
      type: String,
      enum: ['registration_bonus', 'call_deduction', 'sms_deduction', 'manual_add', 'manual_deduct', 'purchase','bonus_credit'],
      required: true
    },
    credits: {
      type: Number,
      required: true
    },
    balance_after: {
      type: Number,
      required: true
    },
    description: {
      type: String,
      default: ''
    },
    reference_id: {
      type: Schema.Types.ObjectId,
      default: null
    },
    reference_type: {
      type: String,
      enum: ['call', 'campaign', 'sms_campaign', 'admin_action', 'subscription', null],
      default: null
    }
  },
  {
    collection: 'credit_usages',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(CreditUsageSchema);

CreditUsageSchema.index({ user_id: 1 });
CreditUsageSchema.index({ transaction_type: 1 });
CreditUsageSchema.index({ created_at: -1 });
CreditUsageSchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model('CreditUsage', CreditUsageSchema);
