'use strict';

const mongoose = require('mongoose');
const { addVirtualId } = require('../utils/modelHelper');

const SubscriptionSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    plan_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
    },
    status: {
      type: String,
      enum: ['trial', 'active', 'expired', 'cancelled', 'suspended', 'pending', 'rejected'],
      default: 'pending',
    },
    started_at: {
      type: Date,
      default: Date.now,
    },
    trial_ends_at: {
      type: Date,
      default: null,
    },
    current_period_start: {
      type: Date,
      default: null,
    },
    current_period_end: {
      type: Date,
      default: null,
    },
    expires_at: {
      type: Date,
      default: null,
    },
    cancelled_at: {
      type: Date,
      default: null,
    },
    cancels_at: {
      type: Date,
      default: null,
    },
    stripe_subscription_id: { type: String, default: null },
    stripe_customer_id: { type: String, default: null },
    razorpay_subscription_id: { type: String, default: null },
    razorpay_customer_id: { type: String, default: null },
    paypal_subscription_id: { type: String, default: null },
    paypal_customer_id: { type: String, default: null },
    payment_gateway: {
      type: String,
      enum: ['stripe', 'razorpay', 'paypal', 'manual', 'free', 'admin generated'],
      default: null,
    },
    payment_method: {
      type: String,
      enum: ['card', 'upi', 'netbanking', 'wallet', 'manual', 'free', 'cash', 'bank_transfer', 'paypal'],
      default: null,
    },
    payment_status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    transaction_id: { type: String, default: null },
    amount_paid: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    payment_reference: { type: String, default: null },
    transaction_receipt: { type: String, default: null },
    manual_payment_type: {
      type: String,
      enum: ['bank_transfer', 'cash', 'check', 'other'],
      default: 'other',
    },
    bank_name: { type: String, default: null },
    bank_account_number: { type: String, default: null },
    bank_account_no: { type: String, default: null },
    bank_ifsc_code: { type: String, default: null },
    bank_ifsc_no: { type: String, default: null },
    bank_holder_name: { type: String, default: null },
    bank_swift_code: { type: String, default: null },
    bank_routing_number: { type: String, default: null },
    approved_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approved_at: { type: Date, default: null },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    duration: { type: Number, default: 1, min: 1 },
    auto_renew: { type: Boolean, default: true },
    features: { type: mongoose.Schema.Types.Mixed, default: null },
    notes: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    collection: 'subscriptions',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(SubscriptionSchema);

SubscriptionSchema.index({ user_id: 1, status: 1 });
SubscriptionSchema.index({ expires_at: 1 });
SubscriptionSchema.index({ plan_id: 1 });
SubscriptionSchema.index({ status: 1 });
SubscriptionSchema.index({ current_period_end: 1 });
SubscriptionSchema.index({ deleted_at: 1 });

SubscriptionSchema.query.active = function () {
  return this.where({ deleted_at: null, status: { $in: ['active', 'trial'] } });
};

SubscriptionSchema.methods.isActive = function () {
  const now = new Date();
  if (this.status === 'trial') {
    return !this.trial_ends_at || now <= this.trial_ends_at;
  }
  if (this.status === 'active') {
    return !this.expires_at || now <= this.expires_at;
  }
  return false;
};

SubscriptionSchema.methods.isExpired = function () {
  const now = new Date();
  if (this.expires_at && now > this.expires_at) return true;
  if (this.status === 'trial' && this.trial_ends_at && now > this.trial_ends_at) return true;
  return false;
};

SubscriptionSchema.methods.getFeatureLimit = function (feature, planFeatures) {
  if (this.features && this.features[feature] !== undefined) return this.features[feature];
  return planFeatures ? planFeatures[feature] : null;
};

module.exports = mongoose.model('Subscription', SubscriptionSchema);
