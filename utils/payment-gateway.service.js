'use strict';
const { db } = require('../models');
const User = db.User;
const Plan = db.Plan;
const crypto = require('crypto');
const PaymentGatewayConfig = require('../models/payment-gateway-config.model');

async function getGatewayConfig(gatewayName, userId) {
  try {
    const q = { gateway_name: gatewayName, is_enabled: true, deleted_at: null };
    if (userId) q.user_id = userId;
    const config = await PaymentGatewayConfig.findOne(q).lean();
    return config || null;
  } catch {
    return null;
  }
}

let _stripeInstance = null;
let _stripeCachedKey = null;

function _getStripeInstance(secretKey) {
  if (!secretKey) return null;
  if (_stripeInstance && _stripeCachedKey === secretKey) return _stripeInstance;
  const Stripe = require('stripe');
  _stripeCachedKey = secretKey;
  _stripeInstance = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' });
  return _stripeInstance;
}

const StripeService = {
  async _getStripe() {
    const config = await getGatewayConfig('stripe');
    const secretKey = config?.stripe_secret_key || process.env.STRIPE_SECRET_KEY;
    return _getStripeInstance(secretKey);
  },

  async createOrGetCustomer(user) {
    const stripe = await this._getStripe();
    if (!stripe) throw new Error('Stripe not configured');
    try {
      if (user.stripe_customer_id) {
        const customer = await stripe.customers.retrieve(user.stripe_customer_id);
        if (!customer.deleted) return customer;
      }
      return await stripe.customers.create({
        email: user.email,
        name: user.name,
        phone: user.phone,
        metadata: { user_id: user._id.toString() },
      });
    } catch (error) {
      throw new Error(error.message || 'Failed to create Stripe customer');
    }
  },

  async createSubscription(customerId, priceId, trialDays = 0) {
    const stripe = await this._getStripe();
    if (!stripe) throw new Error('Stripe not configured');
    try {
      const data = {
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card'],
        },
        expand: ['latest_invoice.payment_intent'],
      };
      if (trialDays > 0) data.trial_period_days = trialDays;
      return await stripe.subscriptions.create(data);
    } catch (error) {
      throw new Error(error.message || 'Failed to create Stripe subscription');
    }
  },

  async attachPaymentMethod(paymentMethodId, customerId) {
    const stripe = await this._getStripe();
    if (!stripe) throw new Error('Stripe not configured');
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
    return true;
  },

  async cancelSubscription(subscriptionId, cancelAtPeriodEnd = true) {
    const stripe = await this._getStripe();
    if (!stripe || !subscriptionId) return null;
    try {
      if (cancelAtPeriodEnd) {
        return await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
      }
      return await stripe.subscriptions.cancel(subscriptionId);
    } catch (error) {
      throw new Error(error.message || 'Failed to cancel Stripe subscription');
    }
  },

  async resumeSubscription(subscriptionId) {
    const stripe = await this._getStripe();
    if (!stripe) throw new Error('Stripe not configured');
    return await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
  },

  async updateSubscription(subscriptionId, newPriceId) {
    const stripe = await this._getStripe();
    if (!stripe) throw new Error('Stripe not configured');
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: subscription.items.data[0].id, price: newPriceId }],
      proration_behavior: 'create_prorations',
    });
  },

  async getSubscription(subscriptionId) {
    const stripe = await this._getStripe();
    if (!stripe || !subscriptionId) return null;
    try {
      return await stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      throw new Error(error.message || 'Failed to retrieve Stripe subscription');
    }
  },

  async createBillingPortalSession(customerId, returnUrl) {
    const stripe = await this._getStripe();
    if (!stripe) throw new Error('Stripe not configured');
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return { url: session.url };
  },

  async createProduct(name, description = null, metadata = {}) {
    const stripe = await this._getStripe();
    if (!stripe) throw new Error('Stripe not configured');
    return await stripe.products.create({ name, description: description || undefined, metadata });
  },

  async createPrice(productId, plan) {
    const stripe = await this._getStripe();
    if (!stripe) throw new Error('Stripe not configured');
    const currency = (plan.currency || 'usd').toString().toLowerCase();
    const unitAmount = Math.round((plan.amount || 0) * 100);
    const isRecurring = plan.billing_cycle === 'monthly' || plan.billing_cycle === 'yearly';
    const priceParams = {
      product: productId,
      currency,
      unit_amount: unitAmount,
      metadata: { plan_slug: plan.slug || '' },
    };
    if (isRecurring) {
      priceParams.recurring = { interval: plan.billing_cycle === 'yearly' ? 'year' : 'month' };
    }
    return await stripe.prices.create(priceParams);
  },

  async createPaymentLink(priceId, options = {}) {
    const stripe = await this._getStripe();
    if (!stripe) throw new Error('Stripe not configured');
    const params = {
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: options.metadata || {},
    };

    let redirectUrl = options.afterCompletionUrl;
    if (!redirectUrl) {
      if (process.env.FRONTEND_URL) {
        redirectUrl = `${process.env.FRONTEND_URL}/subscription/success`;
      } else {
        redirectUrl = `${process.env.APP_URL}/subscription/success`;
      }
    }
    params.after_completion = {
      type: 'redirect',
      redirect: { url: redirectUrl }
    };

    const paymentLink = await stripe.paymentLinks.create(params);
    return { id: paymentLink.id, url: paymentLink.url };
  },

  async createPriceAndPaymentLinkForExistingProduct(plan, productId) {
    const pid = productId || plan.stripe_product_id;
    if (!pid) return null;
    const stripe = await this._getStripe();
    if (!stripe) return null;
    const price = await this.createPrice(pid, plan);
    const paymentLink = await this.createPaymentLink(price.id, {
      metadata: { plan_id: plan._id.toString() },
    });
    return { priceId: price.id, paymentLinkId: paymentLink.id, paymentLinkUrl: paymentLink.url };
  },

  async createProductPriceAndPaymentLink(plan) {
    const stripe = await this._getStripe();
    if (!stripe) return null;
    try {
      const product = await this.createProduct(plan.name, plan.description || undefined, {
        plan_id: plan._id.toString(),
      });
      const price = await this.createPrice(product.id, plan);
      const paymentLink = await this.createPaymentLink(price.id, {
        metadata: { plan_id: plan._id.toString() },
      });
      return { productId: product.id, priceId: price.id, paymentLinkId: paymentLink.id, paymentLinkUrl: paymentLink.url };
    } catch (error) {
      console.error('Stripe createProductPriceAndPaymentLink error:', error.message);
      return null;
    }
  },

  async constructWebhookEvent(payload, signature) {
    const stripe = await this._getStripe();
    if (!stripe) throw new Error('Stripe not configured');
    const config = await getGatewayConfig('stripe');
    const webhookSecret = config?.stripe_webhook_secret || process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error('Stripe webhook secret not configured');
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  },
};

let _razorpayInstance = null;
let _razorpayCachedKey = null;

async function _getRazorpayInstance() {
  const config = await getGatewayConfig('razorpay');
  const keyId = config?.razorpay_key_id || process.env.RAZORPAY_KEY_ID;
  const keySecret = config?.razorpay_key_secret || process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  const cacheKey = `${keyId}:${keySecret}`;
  if (_razorpayInstance && _razorpayCachedKey === cacheKey) return _razorpayInstance;
  const Razorpay = require('razorpay');
  _razorpayCachedKey = cacheKey;
  _razorpayInstance = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return _razorpayInstance;
}

const RazorpayService = {
  async _getRazorpay() {
    return await _getRazorpayInstance();
  },

  async createOrGetCustomer(user) {
    const razorpay = await this._getRazorpay();
    if (!razorpay) throw new Error('Razorpay not configured');
    try {
      if (user.razorpay_customer_id) {
        try {
          return await razorpay.customers.fetch(user.razorpay_customer_id);
        } catch (_) { }
      }
      return await razorpay.customers.create({
        name: user.name,
        email: user.email,
        contact: user.phone,
        fail_existing: 0,
        notes: { user_id: user._id.toString() },
      });
    } catch (error) {
      throw new Error(error?.error?.description || error.message || 'Failed to create Razorpay customer');
    }
  },

  async createPlan(plan) {
    const razorpay = await this._getRazorpay();
    if (!razorpay) {
      console.warn('Razorpay not configured, skipping plan creation');
      return null;
    }
    try {
      const config = await getGatewayConfig('razorpay');
      const currency = (plan.currency || config?.currency || 'INR').toString().toUpperCase();
      const amount = Math.max(100, Math.round((plan.amount || 0) * 100));
      const period = (plan.billing_cycle === 'yearly' || plan.billing_cycle === 'lifetime') ? 'yearly' : 'monthly';
      const created = await razorpay.plans.create({
        period,
        interval: 1,
        item: {
          name: plan.name || 'Plan',
          amount,
          currency,
          description: (plan.description || '').substring(0, 500),
        },
        notes: { plan_id: plan._id?.toString() || '' },
      });
      return { razorpayPlanId: created.id };
    } catch (error) {
      throw new Error(error?.error?.description || error.message || 'Failed to create Razorpay plan');
    }
  },

  async createSubscriptionLink(planId, userId, options = {}) {
    const razorpay = await this._getRazorpay();
    if (!razorpay) throw new Error('Razorpay not configured');

    try {
      const totalCount = options.totalCount != null ? options.totalCount : 10;

      const payload = {
        plan_id: planId,
        total_count: totalCount,
        quantity: 1,
        customer_notify: options.customerNotify !== false ? 1 : 0,
        notes: {
          user_id: userId.toString(),
          ...(options.planIdDb && { plan_id_db: options.planIdDb.toString() }),
        },
      };

      if (options.expireBy) {
        const expireAt = new Date(options.expireBy);
        if (!isNaN(expireAt.getTime())) {
          payload.expire_by = Math.floor(expireAt.getTime() / 1000);
        }
      }

      const subscription = await razorpay.subscriptions.create(payload);
      return { id: subscription.id, short_url: subscription.short_url };
    } catch (error) {
      console.error('Razorpay createSubscriptionLink error:', error);
      const errorMsg = error.response?.data?.error?.description || error?.error?.description || error.message || 'Failed to create Razorpay subscription link';
      throw new Error(errorMsg);
    }
  },

  async createRazorpaySubscription(customerId, planId, totalCount = 0, startAt = null) {
    const razorpay = await this._getRazorpay();
    if (!razorpay) throw new Error('Razorpay not configured');
    const data = {
      plan_id: planId,
      customer_id: customerId,
      total_count: totalCount,
      quantity: 1,
      notify: 1,
    };
    if (startAt) data.start_at = Math.floor(new Date(startAt).getTime() / 1000);
    return await razorpay.subscriptions.create(data);
  },

  async cancelSubscription(subscriptionId, atCycleEnd = true) {
    const razorpay = await this._getRazorpay();
    if (!razorpay || !subscriptionId) return null;
    try {
      return await razorpay.subscriptions.cancel(subscriptionId, atCycleEnd ? 1 : 0);
    } catch (error) {
      throw new Error(error?.error?.description || error.message || 'Failed to cancel Razorpay subscription');
    }
  },

  async pauseSubscription(subscriptionId) {
    const razorpay = await this._getRazorpay();
    if (!razorpay) throw new Error('Razorpay not configured');
    return await razorpay.subscriptions.pause(subscriptionId);
  },

  async resumeSubscription(subscriptionId) {
    const razorpay = await this._getRazorpay();
    if (!razorpay) throw new Error('Razorpay not configured');
    return await razorpay.subscriptions.resume(subscriptionId);
  },

  async updateSubscription(subscriptionId, updateData) {
    const razorpay = await this._getRazorpay();
    if (!razorpay) throw new Error('Razorpay not configured');
    return await razorpay.subscriptions.update(subscriptionId, updateData);
  },

  async getSubscription(subscriptionId) {
    const razorpay = await this._getRazorpay();
    if (!razorpay) throw new Error('Razorpay not configured');
    return await razorpay.subscriptions.fetch(subscriptionId);
  },

  verifyPaymentSignature(razorpayPaymentId, razorpaySubscriptionId, razorpaySignature) {
    try {
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      if (!keySecret) return false;
      const generated = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpayPaymentId}|${razorpaySubscriptionId}`)
        .digest('hex');
      return generated === razorpaySignature;
    } catch {
      return false;
    }
  },

  async verifyWebhookSignature(payload, signature) {
    try {
      const config = await getGatewayConfig('razorpay');
      const secret = config?.razorpay_webhook_secret || process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
      if (!secret) return false;
      const bodyString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const expected = crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
      return expected === signature;
    } catch {
      return false;
    }
  },
};

const PayPalService = {
  async _getConfig() {
    const config = await getGatewayConfig('paypal');
    const clientId = config?.paypal_client_id || process.env.PAYPAL_CLIENT_ID;
    const clientSecret = config?.paypal_client_secret || process.env.PAYPAL_CLIENT_SECRET;
    const mode = config?.paypal_mode || process.env.PAYPAL_MODE || 'sandbox';
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      apiUrl: mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
    };
  },

  async getAccessToken() {
    const cfg = await this._getConfig();
    if (!cfg) throw new Error('PayPal credentials not configured');
    const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    const response = await fetch(`${cfg.apiUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) throw new Error('Failed to get PayPal access token');
    const data = await response.json();
    return { token: data.access_token, apiUrl: cfg.apiUrl };
  },

  async createProduct(plan) {
    const cfg = await this._getConfig();
    if (!cfg) {
      console.warn('PayPal not configured, skipping product creation');
      return null;
    }
    try {
      const { token, apiUrl } = await this.getAccessToken();
      const response = await fetch(`${apiUrl}/v1/catalogs/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          name: plan.name,
          description: plan.description || 'Subscription Plan',
          type: 'SERVICE',
          category: 'SOFTWARE',
        }),
      });
      if (!response.ok) throw new Error('Failed to create PayPal product');
      const data = await response.json();
      return { paypalProductId: data.id };
    } catch (error) {
      console.error('PayPal createProduct error:', error.message);
      throw error;
    }
  },

  async createPlan(paypalProductId, plan) {
    const cfg = await this._getConfig();
    if (!cfg) {
      console.warn('PayPal not configured, skipping plan creation');
      return null;
    }
    try {
      const { token, apiUrl } = await this.getAccessToken();
      const currency = (plan.currency || 'USD').toString().toUpperCase();
      const intervalUnit = plan.billing_cycle === 'yearly' ? 'YEAR' : 'MONTH';
      const response = await fetch(`${apiUrl}/v1/billing/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          product_id: paypalProductId,
          name: plan.name,
          description: plan.description || 'Subscription Plan',
          status: 'ACTIVE',
          billing_cycles: [{
            frequency: { interval_unit: intervalUnit, interval_count: 1 },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: {
              fixed_price: { value: (plan.amount || 0).toFixed(2), currency_code: currency },
            },
          }],
          payment_preferences: {
            auto_bill_outstanding: true,
            setup_fee_failure_action: 'CONTINUE',
            payment_failure_threshold: 3,
          },
        }),
      });
      if (!response.ok) throw new Error('Failed to create PayPal plan');
      const data = await response.json();
      return { paypalPlanId: data.id };
    } catch (error) {
      console.error('PayPal createPlan error:', error.message);
      throw error;
    }
  },

  async createSubscription(paypalPlanId, userId, returnUrl, cancelUrl) {
    const cfg = await this._getConfig();
    if (!cfg) {
      console.warn('PayPal not configured');
      return null;
    }
    try {
      const { token, apiUrl } = await this.getAccessToken();
      const response = await fetch(`${apiUrl}/v1/billing/subscriptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'PayPal-Request-Id': `sub-${userId}-${Date.now()}`,
        },
        body: JSON.stringify({
          plan_id: paypalPlanId,
          custom_id: userId ? userId.toString() : undefined,
          application_context: {
            brand_name: process.env.APP_NAME || 'Autocall',
            locale: 'en-US',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'SUBSCRIBE_NOW',
            return_url: returnUrl || `${process.env.FRONTEND_URL}/subscription/success`,
            cancel_url: cancelUrl || `${process.env.FRONTEND_URL}/subscription/cancel`,
          },
        }),
      });
      if (!response.ok) throw new Error('Failed to create PayPal subscription');
      const data = await response.json();
      return {
        paypalSubscriptionId: data.id,
        approvalUrl: data.links?.find(l => l.rel === 'approve')?.href,
        links: data.links,
        data,
      };
    } catch (error) {
      console.error('PayPal createSubscription error:', error.message);
      throw error;
    }
  },

  async cancelSubscription(subscriptionId, reason = 'Not needed anymore') {
    const cfg = await this._getConfig();
    if (!cfg || !subscriptionId) return null;
    try {
      const { token, apiUrl } = await this.getAccessToken();
      const response = await fetch(`${apiUrl}/v1/billing/subscriptions/${subscriptionId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error('Failed to cancel PayPal subscription');
      return true;
    } catch (error) {
      console.error('PayPal cancelSubscription error:', error.message);
      throw error;
    }
  },

  async getSubscription(subscriptionId) {
    const cfg = await this._getConfig();
    if (!cfg) throw new Error('PayPal not configured');
    try {
      const { token, apiUrl } = await this.getAccessToken();
      const response = await fetch(`${apiUrl}/v1/billing/subscriptions/${subscriptionId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to retrieve PayPal subscription');
      return await response.json();
    } catch (error) {
      console.error('PayPal getSubscription error:', error.message);
      throw error;
    }
  },

  async verifyWebhookSignature(rawBody, reqHeaders) {
    const cfg = await this._getConfig();
    if (!cfg) return false;
    try {
      const configModel = await getGatewayConfig('paypal');
      const webhookId = configModel?.config?.webhook_id || configModel?.webhook_id || process.env.PAYPAL_WEBHOOK_ID;
      if (!webhookId) {
        console.warn('PayPal Webhook ID not configured, unable to verify signature');
        return false;
      }

      const webhookEvent = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

      const { token, apiUrl } = await this.getAccessToken();

      const verifyPayload = {
        auth_algo: reqHeaders['paypal-auth-algo'],
        cert_url: reqHeaders['paypal-cert-url'],
        transmission_id: reqHeaders['paypal-transmission-id'],
        transmission_sig: reqHeaders['paypal-transmission-sig'],
        transmission_time: reqHeaders['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: webhookEvent
      };

      const response = await fetch(`${apiUrl}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(verifyPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PayPalVerify] Failed to verify PayPal webhook signature:', errorText);
        console.error('[PayPalVerify] Response status:', response.status);
        return false;
      }

      const data = await response.json();
      return data.verification_status === 'SUCCESS';
    } catch (error) {
      console.error('PayPal verifyWebhookSignature error:', error.message);
      return false;
    }
  },
};

function calculatePeriodEnd(startDate, billingCycle, duration = 1) {
  const date = new Date(startDate);
  const d = parseInt(duration) || 1;

  switch (billingCycle) {
    case 'monthly':
      date.setMonth(date.getMonth() + d);
      break;
    case 'yearly':
      date.setFullYear(date.getFullYear() + d);
      break;
    case 'free_trial':
    case 'free Trial':
      date.setDate(date.getDate() + d);
      break;
    case 'lifetime':
      date.setFullYear(date.getFullYear() + 100);
      break;
    default:
      date.setMonth(date.getMonth() + d);
  }

  return date;
}

async function activateUserSubscription(userId, planId) {
  try {
    const plan = await Plan.findById(planId);
    if (!plan) {
      console.warn(`[activateUserSubscription] Plan ${planId} not found for user ${userId}`);
      return;
    }

    await User.findByIdAndUpdate(userId, {
      plan_id: planId,
      total_credits: plan.total_credits || 0
    });

    console.log(`[activateUserSubscription] User ${userId} updated with ${plan.total_credits} credits from plan ${plan.name}`);
  } catch (err) {
    console.error(`[activateUserSubscription] Error updating user ${userId}:`, err.message);
  }
}

async function activateTopUp(userId, planId) {
  try {
    const plan = await Plan.findById(planId);
    if (!plan || plan.plan_type !== 'top_up') {
      console.warn(`[activateTopUp] Top-up Plan ${planId} not found or invalid type for user ${userId}`);
      return;
    }

    const validityDays = plan.validity_days || 0;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + validityDays);

    await User.findByIdAndUpdate(userId, {
      $inc: {
        total_credits: plan.total_credits || 0,
        top_up_credits: plan.total_credits || 0
      },
      top_up_expires_at: expiryDate
    });

    console.log(`[activateTopUp] User ${userId} updated with ${plan.total_credits} top-up credits valid for ${validityDays} days`);
  } catch (err) {
    console.error(`[activateTopUp] Error activating top-up for user ${userId}:`, err.message);
  }
}

async function registerWebhook(config, baseUrl) {
  const { gateway_name, stripe_secret_key, razorpay_key_id, razorpay_key_secret, paypal_client_id, paypal_client_secret, paypal_mode } = config;

  if (gateway_name === 'stripe') {
    const secretKey = stripe_secret_key || process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return { webhook_id: null, webhook_secret: null, error: 'Stripe secret key not configured' };

    const Stripe = require('stripe');
    const stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' });
    const webhookUrl = `${baseUrl}/api/webhook/stripe`;

    try {
      const existingWebhooks = await stripe.webhookEndpoints.list();
      const duplicate = existingWebhooks.data.find(w => w.url === webhookUrl);
      if (duplicate) {
        console.log(`[PaymentGW] Deleting duplicate Stripe webhook: ${duplicate.id}`);
        await stripe.webhookEndpoints.del(duplicate.id);
      }

      const webhook = await stripe.webhookEndpoints.create({
        url: webhookUrl,
        enabled_events: [
          'checkout.session.completed',
          'invoice.payment_succeeded',
          'invoice.payment_failed',
          'customer.subscription.updated',
          'customer.subscription.deleted',
        ],
      });
      return { webhook_id: webhook.id, webhook_secret: webhook.secret, webhook_url: webhookUrl };
    } catch (err) {
      console.error('[registerWebhook] Stripe registration FAILED:', err.message);
      if (err.raw) console.error('[registerWebhook] Stripe Raw Error:', JSON.stringify(err.raw));
      return { webhook_id: null, webhook_secret: null, error: err.message, webhook_url: webhookUrl };
    }
  }

  if (gateway_name === 'razorpay') {
    const keyId = razorpay_key_id || process.env.RAZORPAY_KEY_ID;
    const keySecret = razorpay_key_secret || process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) return { webhook_id: null, webhook_secret: null, error: 'Razorpay credentials not configured' };

    const webhookSecret = crypto.randomBytes(16).toString('hex');
    const webhookUrl = `${baseUrl}/api/webhook/razorpay`;
    return { webhook_id: `razorpay_${Date.now()}`, webhook_secret: webhookSecret, webhook_url: webhookUrl };
  }

  if (gateway_name === 'paypal') {
    const clientId = paypal_client_id || process.env.PAYPAL_CLIENT_ID;
    const clientSecret = paypal_client_secret || process.env.PAYPAL_CLIENT_SECRET;
    const mode = paypal_mode || process.env.PAYPAL_MODE || 'sandbox';
    if (!clientId || !clientSecret) return { webhook_id: null, webhook_secret: null, error: 'PayPal credentials not configured' };

    const apiUrl = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    const webhookUrl = `${baseUrl}/api/webhook/paypal`;

    try {
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(`${apiUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${auth}` },
        body: 'grant_type=client_credentials',
      });

      if (!tokenRes.ok) {
        const errorData = await tokenRes.json();
        return { webhook_id: null, webhook_secret: null, error: errorData.error_description || 'PayPal auth failed', webhook_url: webhookUrl };
      }

      const { access_token: token } = await tokenRes.json();

      const listRes = await fetch(`${apiUrl}/v1/notifications/webhooks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (listRes.ok) {
        const { webhooks } = await listRes.json();
        const existing = webhooks?.find(w => w.url === webhookUrl);
        if (existing) {
          await fetch(`${apiUrl}/v1/notifications/webhooks/${existing.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }

      const createRes = await fetch(`${apiUrl}/v1/notifications/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          url: webhookUrl,
          event_types: [
            { name: 'BILLING.SUBSCRIPTION.ACTIVATED' },
            { name: 'BILLING.SUBSCRIPTION.CANCELLED' },
            { name: 'BILLING.SUBSCRIPTION.EXPIRED' },
            { name: 'BILLING.SUBSCRIPTION.SUSPENDED' },
            { name: 'PAYMENT.SALE.COMPLETED' },
            { name: 'PAYMENT.SALE.DENIED' },
          ],
        }),
      });
      const webhook = await createRes.json();
      if (webhook.id) {
        return { webhook_id: webhook.id, webhook_secret: null, webhook_url: webhookUrl };
      } else {
        return { webhook_id: null, webhook_secret: null, error: webhook.message || 'Failed to create PayPal webhook', webhook_url: webhookUrl };
      }
    } catch (err) {
      console.error('[registerWebhook] PayPal registration FAILED:', err.message);
      return { webhook_id: null, webhook_secret: null, error: err.message, webhook_url: webhookUrl };
    }
  }

  return { webhook_id: null, webhook_secret: null, webhook_url: `${baseUrl}/api/webhook/${gateway_name}` };
}

async function unregisterWebhook(config) {
  const { gateway_name, stripe_secret_key, paypal_client_id, paypal_client_secret, paypal_mode, webhook_id } = config;
  if (!webhook_id) return;

  if (gateway_name === 'stripe') {
    const secretKey = stripe_secret_key || process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return;
    try {
      const Stripe = require('stripe');
      const stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' });
      await stripe.webhookEndpoints.del(webhook_id);
    } catch (err) {
      console.warn('[unregisterWebhook] Stripe error:', err.message);
    }
    return;
  }

  if (gateway_name === 'paypal') {
    const clientId = paypal_client_id || process.env.PAYPAL_CLIENT_ID;
    const clientSecret = paypal_client_secret || process.env.PAYPAL_CLIENT_SECRET;
    const mode = paypal_mode || process.env.PAYPAL_MODE || 'sandbox';
    if (!clientId || !clientSecret) return;
    try {
      const apiUrl = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(`${apiUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${auth}` },
        body: 'grant_type=client_credentials',
      });
      const { access_token: token } = await tokenRes.json();
      await fetch(`${apiUrl}/v1/notifications/webhooks/${webhook_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.warn('[unregisterWebhook] PayPal error:', err.message);
    }
  }
}

async function testConnection(config) {
  const { gateway_name, stripe_secret_key, razorpay_key_id, razorpay_key_secret, paypal_client_id, paypal_client_secret, paypal_mode } = config;

  if (gateway_name === 'stripe') {
    const secretKey = stripe_secret_key || process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return { connected: false, message: 'Stripe secret key not configured' };
    try {
      const Stripe = require('stripe');
      const stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' });
      await stripe.balance.retrieve();
      return { connected: true, message: 'Stripe connection successful' };
    } catch (err) {
      return { connected: false, message: `Stripe error: ${err.message}` };
    }
  }

  if (gateway_name === 'razorpay') {
    const keyId = razorpay_key_id || process.env.RAZORPAY_KEY_ID;
    const keySecret = razorpay_key_secret || process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) return { connected: false, message: 'Razorpay credentials not configured' };
    try {
      const Razorpay = require('razorpay');
      const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
      await rzp.payments.all({ count: 1 });
      return { connected: true, message: 'Razorpay connection successful' };
    } catch (err) {
      return { connected: false, message: `Razorpay error: ${err.message}` };
    }
  }

  if (gateway_name === 'paypal') {
    const clientId = paypal_client_id || process.env.PAYPAL_CLIENT_ID;
    const clientSecret = paypal_client_secret || process.env.PAYPAL_CLIENT_SECRET;
    const mode = paypal_mode || process.env.PAYPAL_MODE || 'sandbox';
    if (!clientId || !clientSecret) return { connected: false, message: 'PayPal credentials not configured' };
    try {
      const apiUrl = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const res = await fetch(`${apiUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${auth}` },
        body: 'grant_type=client_credentials',
      });
      if (!res.ok) return { connected: false, message: 'PayPal authentication failed' };
      return { connected: true, message: 'PayPal connection successful' };
    } catch (err) {
      return { connected: false, message: `PayPal error: ${err.message}` };
    }
  }

  if (gateway_name === 'manual') {
    return { connected: true, message: 'Manual gateway always available' };
  }

  return { connected: false, message: 'Unknown gateway' };
}

async function isGatewayConfigured(gatewayName, userId) {
  const cfg = await getGatewayConfig(gatewayName, userId);
  switch (gatewayName) {
    case 'stripe':
      return !!(cfg && cfg.stripe_secret_key || process.env.STRIPE_SECRET_KEY);
    case 'razorpay':
      return !!(
        (cfg && cfg.razorpay_key_id && cfg.razorpay_key_secret) ||
        (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
      );
    case 'paypal':
      return !!(
        (cfg && cfg.paypal_client_id && cfg.paypal_client_secret) ||
        (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET)
      );
    case 'manual':
      return true;
    default:
      return false;
  }
}

module.exports = {
  StripeService,
  RazorpayService,
  PayPalService,
  calculatePeriodEnd,
  registerWebhook,
  unregisterWebhook,
  testConnection,
  isGatewayConfigured,
  activateUserSubscription,
  activateTopUp,
  getGatewayConfig,
  stripeService: StripeService,
  razorpayService: RazorpayService,
  paypalService: PayPalService,
};