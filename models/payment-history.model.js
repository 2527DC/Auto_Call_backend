'use strict';

const mongoose = require('mongoose');
const { addVirtualId } = require('../utils/modelHelper');

const PaymentHistorySchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    subscription_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },
    plan_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'USD',
    },
    payment_method: {
      type: String,
      default: null,
    },
    payment_status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'refunded'],
      default: 'pending',
    },
    transaction_id: {
      type: String,
      default: null,
    },
    payment_gateway: {
      type: String,
      enum: ['stripe', 'razorpay', 'paypal', 'manual', 'free', 'admin generated'],
      default: null,
    },
    invoice_number: {
      type: String,
      unique: true,
      sparse: true,
      default: null,
    },
    paid_at: {
      type: Date,
      default: null,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    collection: 'payment_histories',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(PaymentHistorySchema);

PaymentHistorySchema.index({ user_id: 1 });
PaymentHistorySchema.index({ subscription_id: 1 });
PaymentHistorySchema.index({ plan_id: 1 });
PaymentHistorySchema.index({ payment_status: 1 });
PaymentHistorySchema.index({ paid_at: 1 });
PaymentHistorySchema.index({ deleted_at: 1 });

module.exports = mongoose.model('PaymentHistory', PaymentHistorySchema);
