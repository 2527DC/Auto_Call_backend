'use strict';

const mongoose = require('mongoose');
const { addVirtualId } = require('../utils/modelHelper');

const PlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    plan_type: {
      type: String,
      enum: ['subscription', 'prepaid', 'lifetime', 'top_up'],
      default: 'subscription',
    },
    billing_cycle: {
      type: String,
      enum: ['monthly', 'yearly', 'one_time'],
      default: 'monthly',
    },
    validity_days: {
      type: Number,
      min: 0,
      default: null,
    },
    stripe_product_id: {
      type: String,
      default: null,
    },
    stripe_price_id: {
      type: String,
      default: null,
    },
    stripe_payment_link_id: {
      type: String,
      default: null,
    },
    stripe_payment_link_url: {
      type: String,
      default: null,
    },
    paypal_plan_id: {
      type: String,
      default: null,
    },
    paypal_plan_id_monthly: {
      type: String,
      default: null,
    },
    paypal_plan_id_yearly: {
      type: String,
      default: null,
    },
    razorpay_plan_id: {
      type: String,
      default: null,
    },
    total_credits: {
      type: Number,
      default: 0,
    },
    agent_limit: {
      type: Number,
      default: -1,
    },
    campaign_limit_per_day: {
      type: Number,
      default: -1,
    },
    flow_limit: {
      type: Number,
      default: -1,
    },
    knowledgebase_limit: {
      type: Number,
      default: -1,
    },
    storage_limit: {
      type: Number,
      default: -1,
    },
    contact_limit: {
      type: Number,
      default: -1,
    },
    sms_agent_limit: {
      type: Number,
      default: -1,
    },
    sms_campaign_limit_per_day: {
      type: Number,
      default: -1,
    },
    campaign_sms_limit: {
      type: Number,
      default: -1,
    },
    is_popular: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    currency: {
      type: String,
      enum: ['USD', 'INR', 'EUR', 'GBP'],
      default: 'USD',
    }
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    collection: 'plans',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

PlanSchema.virtual('allowed_payment_gateways').get(function () {
  const gateways = [];
  if (this.stripe_product_id && this.stripe_price_id && this.stripe_payment_link_url) gateways.push('stripe');
  if (this.razorpay_plan_id) gateways.push('razorpay');
  if (this.paypal_plan_id || this.paypal_plan_id_monthly || this.paypal_plan_id_yearly) gateways.push('paypal');
  return gateways;
});

addVirtualId(PlanSchema);

PlanSchema.index({ slug: 1 }, { unique: true });
PlanSchema.index({ status: 1 });

PlanSchema.pre('save', function (next) {
  if (this.plan_type === 'top_up') {
    this.agent_limit = -1;
    this.campaign_limit_per_day = -1;
    this.flow_limit = -1;
    this.knowledgebase_limit = -1;
    this.storage_limit = -1;
    this.contact_limit = -1;
    this.sms_agent_limit = -1;
    this.sms_campaign_limit_per_day = -1;
    this.campaign_sms_limit = -1;
  }
  next();
});

PlanSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function (next) {
  const update = this.getUpdate();
  const isTopUp = update.plan_type === 'top_up' || (update.$set && update.$set.plan_type === 'top_up');

  if (isTopUp) {
    if (update.$set) {
      update.$set.agent_limit = -1;
      update.$set.campaign_limit_per_day = -1;
      update.$set.flow_limit = -1;
      update.$set.knowledgebase_limit = -1;
      update.$set.storage_limit = -1;
      update.$set.contact_limit = -1;
      update.$set.sms_agent_limit = -1;
      update.$set.sms_campaign_limit_per_day = -1;
      update.$set.campaign_sms_limit = -1;
    } else {
      update.agent_limit = -1;
      update.campaign_limit_per_day = -1;
      update.flow_limit = -1;
      update.knowledgebase_limit = -1;
      update.storage_limit = -1;
      update.contact_limit = -1;
      update.sms_agent_limit = -1;
      update.sms_campaign_limit_per_day = -1;
      update.campaign_sms_limit = -1;
    }
  }
  next();
});

PlanSchema.methods.isFreePlan = function () {
  return this.amount === 0;
};

module.exports = mongoose.model('Plan', PlanSchema);
