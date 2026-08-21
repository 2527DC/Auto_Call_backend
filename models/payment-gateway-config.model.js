'use strict';

const mongoose = require('mongoose');
const { addVirtualId } = require('../utils/modelHelper');

const PaymentGatewayConfigSchema = new mongoose.Schema(
  {
    gateway_name: {
      type: String,
      enum: ['stripe', 'razorpay', 'paypal', 'manual'],
      required: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    is_enabled: {
      type: Boolean,
      default: false,
    },
    is_test_mode: {
      type: Boolean,
      default: true,
    },
    stripe_secret_key: {
      type: String,
      default: null,
    },
    stripe_publishable_key: {
      type: String,
      default: null,
    },
    stripe_webhook_secret: {
      type: String,
      default: null,
    },
    razorpay_key_id: {
      type: String,
      default: null,
    },
    razorpay_key_secret: {
      type: String,
      default: null,
    },
    razorpay_webhook_secret: {
      type: String,
      default: null,
    },
    paypal_client_id: {
      type: String,
      default: null,
    },
    paypal_client_secret: {
      type: String,
      default: null,
    },
    paypal_mode: {
      type: String,
      enum: ['sandbox', 'live'],
      default: 'sandbox',
    },
    enable_manual_payment: {
      type: Boolean,
      default: false,
    },
    manual_payment_instructions: {
      type: String,
      default: null,
    },
    bank_details: {
      bank_name: {
        type: String,
        default: null,
      },
      account_holder_name: {
        type: String,
        default: null,
      },
      account_number: {
        type: String,
        default: null,
      },
      ifsc_code: {
        type: String,
        default: null,
      },
      branch_name: {
        type: String,
        default: null,
      },
      swift_code: {
        type: String,
        default: null,
      },
      routing_number: {
        type: String,
        default: null,
      },
    },
    currency: {
      type: String,
      default: 'USD',
    },
    supported_currencies: {
      type: [String],
      default: ['USD', 'EUR', 'GBP', 'INR'],
    },
    enable_trial: {
      type: Boolean,
      default: true,
    },
    trial_days_limit: {
      type: Number,
      default: 14,
    },
    stripe_webhook_url: {
      type: String,
      default: null,
    },
    razorpay_webhook_url: {
      type: String,
      default: null,
    },
    paypal_webhook_url: {
      type: String,
      default: null,
    },
    config: {
      type: Object,
      default: {},
    },
    notes: {
      type: String,
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
    collection: 'payment_gateway_configs',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(PaymentGatewayConfigSchema);

PaymentGatewayConfigSchema.index({ user_id: 1, gateway_name: 1 }, { unique: true });
PaymentGatewayConfigSchema.index({ user_id: 1, is_enabled: 1 });
PaymentGatewayConfigSchema.index({ deleted_at: 1 });

PaymentGatewayConfigSchema.statics.getActiveGateway = async function (gatewayName, userId) {
  const q = { gateway_name: gatewayName, is_enabled: true, deleted_at: null };
  if (userId) q.user_id = userId;
  return this.findOne(q);
};

PaymentGatewayConfigSchema.statics.getEnabledGateways = async function (userId) {
  const q = { is_enabled: true, deleted_at: null };
  if (userId) q.user_id = userId;
  return this.find(q).lean();
};

PaymentGatewayConfigSchema.methods.isConfigured = function () {
  switch (this.gateway_name) {
    case 'stripe':
      return !!(this.stripe_secret_key && this.stripe_webhook_secret);
    case 'razorpay':
      return !!(this.razorpay_key_id && this.razorpay_key_secret);
    case 'paypal':
      return !!(this.paypal_client_id && this.paypal_client_secret);
    case 'manual':
      return this.enable_manual_payment === true;
    default:
      return false;
  }
};

PaymentGatewayConfigSchema.methods.getSanitizedConfig = function () {
  const config = this.toObject();
  
  const maskValue = (val) => {
    if (!val) return val;
    if (val.length <= 4) return '*'.repeat(val.length);
    return '*'.repeat(val.length - 4) + val.slice(-4);
  };

  if (config.stripe_secret_key) config.stripe_secret_key = maskValue(config.stripe_secret_key);
  if (config.stripe_webhook_secret) config.stripe_webhook_secret = maskValue(config.stripe_webhook_secret);
  if (config.razorpay_key_secret) config.razorpay_key_secret = maskValue(config.razorpay_key_secret);
  if (config.razorpay_webhook_secret) config.razorpay_webhook_secret = maskValue(config.razorpay_webhook_secret);
  if (config.paypal_client_secret) config.paypal_client_secret = maskValue(config.paypal_client_secret);
  
  return config;
};

module.exports = mongoose.model('PaymentGatewayConfig', PaymentGatewayConfigSchema);
