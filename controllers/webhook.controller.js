'use strict';

const { db } = require('../models');
const Subscription = db.Subscription;
const PaymentHistory = db.PaymentHistory;
const Plan = db.Plan;
const User = db.User;
const {
  StripeService,
  RazorpayService,
  PayPalService,
  calculatePeriodEnd,
  activateUserSubscription,
  activateTopUp,
} = require('../utils/payment-gateway.service');
const { generateInvoiceNumber } = require('../utils/invoice-helper');

exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = await StripeService.constructWebhookEvent(req.body, sig);
  } catch (err) {
    console.error('[StripeWebhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  res.json({ received: true });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log(`[StripeWebhook] checkout.session.completed – session: ${session.id}, sub: ${session.subscription}`);

        let subscription = null;
        if (session.subscription) {
          subscription = await Subscription.findOne({
            stripe_subscription_id: session.subscription,
            deleted_at: null,
          }).populate('plan_id');
        }

        if (!subscription && session.client_reference_id) {
          subscription = await Subscription.findOne({
            user_id: session.client_reference_id,
            payment_gateway: 'stripe',
            status: 'pending',
            deleted_at: null,
          })
            .sort({ created_at: -1 })
            .populate('plan_id');
        }

        if (subscription) {
          const plan = subscription.plan_id;
          const now = new Date();
          const periodEnd = calculatePeriodEnd(now, plan?.billing_cycle || 'monthly');

          subscription.status = 'active';
          subscription.payment_status = 'paid';
          subscription.stripe_subscription_id = session.subscription || subscription.stripe_subscription_id;
          subscription.stripe_customer_id = session.customer;
          subscription.current_period_start = now;
          subscription.current_period_end = periodEnd;
          subscription.expires_at = periodEnd;
          subscription.amount_paid = (session.amount_total || 0) / 100;
          if (plan?.features) subscription.features = plan.features;
          await subscription.save();

          await PaymentHistory.create({
            user_id: subscription.user_id,
            subscription_id: subscription._id,
            plan_id: plan?._id,
            amount: subscription.amount_paid,
            currency: session.currency?.toUpperCase() || subscription.currency,
            payment_method: 'card',
            payment_status: 'success',
            payment_gateway: 'stripe',
            transaction_id: session.payment_intent,
            invoice_number: generateInvoiceNumber(),
            paid_at: now,
          });

          if (plan?.plan_type === 'top_up') {
            await activateTopUp(subscription.user_id, plan?._id);
          } else {
            await activateUserSubscription(subscription.user_id, plan?._id);
          }

          console.log(`[StripeWebhook] Subscription ${subscription._id} activated`);
        } else {
          console.warn(`[StripeWebhook] No subscription matched for session ${session.id}`);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscription = await Subscription.findOne({
          stripe_subscription_id: invoice.subscription,
          deleted_at: null,
        }).populate('plan_id');

        if (subscription) {
          const now = new Date();
          const periodEnd = calculatePeriodEnd(now, subscription.plan_id?.billing_cycle || 'monthly');
          subscription.status = 'active';
          subscription.payment_status = 'paid';
          subscription.current_period_start = now;
          subscription.current_period_end = periodEnd;
          subscription.expires_at = periodEnd;
          await subscription.save();

          await PaymentHistory.create({
            user_id: subscription.user_id,
            subscription_id: subscription._id,
            plan_id: subscription.plan_id?._id,
            amount: (invoice.amount_paid || 0) / 100,
            currency: invoice.currency?.toUpperCase() || subscription.currency,
            payment_method: 'card',
            payment_status: 'success',
            payment_gateway: 'stripe',
            transaction_id: invoice.payment_intent,
            invoice_number: generateInvoiceNumber(),
            paid_at: now,
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscription = await Subscription.findOne({
          stripe_subscription_id: invoice.subscription,
          deleted_at: null,
        });
        if (subscription) {
          subscription.status = 'suspended';
          subscription.payment_status = 'failed';
          await subscription.save();
        }
        break;
      }

      case 'customer.subscription.updated': {
        const stripeSub = event.data.object;
        const subscription = await Subscription.findOne({
          stripe_subscription_id: stripeSub.id,
          deleted_at: null,
        });
        if (subscription) {
          if (stripeSub.cancel_at_period_end) {
            subscription.cancels_at = new Date(stripeSub.cancel_at * 1000);
            subscription.auto_renew = false;
          } else {
            subscription.cancels_at = null;
            subscription.auto_renew = true;
          }
          await subscription.save();
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object;
        const subscription = await Subscription.findOne({
          stripe_subscription_id: stripeSub.id,
          deleted_at: null,
        }).populate('plan_id');
        if (subscription) {
          subscription.status = 'cancelled';
          subscription.cancelled_at = new Date();
          subscription.auto_renew = false;
          await subscription.save();

          if (subscription.plan_id && subscription.plan_id.total_credits) {
            const userToUpdate = await User.findById(subscription.user_id);
            if (userToUpdate) {
              userToUpdate.total_credits = Math.max(0, (userToUpdate.total_credits || 0) - subscription.plan_id.total_credits);
              if (userToUpdate.plan_id && userToUpdate.plan_id.toString() === subscription.plan_id._id.toString()) {
                userToUpdate.plan_id = null;
              }
              await userToUpdate.save();
            }
          }
        }
        break;
      }

      default:
        console.log(`[StripeWebhook] Unhandled event: ${event.type}`);
    }
  } catch (error) {
    console.error('[StripeWebhook] Processing error:', error.message);
  }
};

exports.razorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawPayload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    const isValid = await RazorpayService.verifyWebhookSignature(rawPayload, signature);
    if (!isValid) {
      console.warn('[RazorpayWebhook] Invalid signature');
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    res.json({ received: true });

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType = event.event;

    switch (eventType) {
      case 'subscription.activated': {
        const rzpSub = event.payload?.subscription?.entity;
        if (!rzpSub?.id) break;
        const subscription = await Subscription.findOne({
          razorpay_subscription_id: rzpSub.id,
          deleted_at: null,
        }).populate('plan_id');

        if (subscription) {
          const now = new Date();
          const periodEnd = calculatePeriodEnd(now, subscription.plan_id?.billing_cycle || 'monthly');
          subscription.status = 'active';
          subscription.payment_status = 'paid';
          subscription.current_period_start = now;
          subscription.current_period_end = periodEnd;
          subscription.expires_at = periodEnd;
          if (subscription.plan_id?.features) subscription.features = subscription.plan_id.features;
          await subscription.save();

          if (subscription.plan_id?.plan_type === 'top_up') {
            await activateTopUp(subscription.user_id, subscription.plan_id?._id);
          } else {
            await activateUserSubscription(subscription.user_id, subscription.plan_id?._id);
          }

          console.log(`[RazorpayWebhook] Subscription ${subscription._id} activated`);
        }
        break;
      }

      case 'subscription.charged': {
        const rzpSub = event.payload?.subscription?.entity;
        const payment = event.payload?.payment?.entity;
        if (!rzpSub?.id) break;

        const subscription = await Subscription.findOne({
          razorpay_subscription_id: rzpSub.id,
          deleted_at: null,
        }).populate('plan_id');

        if (subscription) {
          const now = new Date();
          const periodEnd = calculatePeriodEnd(now, subscription.plan_id?.billing_cycle || 'monthly');
          subscription.status = 'active';
          subscription.current_period_start = now;
          subscription.current_period_end = periodEnd;
          subscription.expires_at = periodEnd;
          await subscription.save();

          if (payment) {
            const existingPayment = await PaymentHistory.findOne({
              transaction_id: payment.id,
              payment_gateway: 'razorpay',
            });

            if (!existingPayment) {
              await PaymentHistory.create({
                user_id: subscription.user_id,
                subscription_id: subscription._id,
                plan_id: subscription.plan_id?._id,
                amount: (payment.amount || 0) / 100,
                currency: payment.currency?.toUpperCase() || subscription.currency,
                payment_method: payment.method || 'card',
                payment_status: 'success',
                payment_gateway: 'razorpay',
                transaction_id: payment.id,
                invoice_number: generateInvoiceNumber(),
                paid_at: now,
              });
            }
          }
        }
        break;
      }

      case 'subscription.cancelled': {
        const rzpSub = event.payload?.subscription?.entity;
        if (!rzpSub?.id) break;
        const subscription = await Subscription.findOne({
          razorpay_subscription_id: rzpSub.id,
          deleted_at: null,
        }).populate('plan_id');
        if (subscription) {
          subscription.status = 'cancelled';
          subscription.cancelled_at = new Date();
          await subscription.save();

          if (subscription.plan_id && subscription.plan_id.total_credits) {
            const userToUpdate = await User.findById(subscription.user_id);
            if (userToUpdate) {
              userToUpdate.total_credits = Math.max(0, (userToUpdate.total_credits || 0) - subscription.plan_id.total_credits);
              if (userToUpdate.plan_id && userToUpdate.plan_id.toString() === subscription.plan_id._id.toString()) {
                userToUpdate.plan_id = null;
              }
              await userToUpdate.save();
            }
          }
        }
        break;
      }

      case 'subscription.completed': {
        const rzpSub = event.payload?.subscription?.entity;
        if (!rzpSub?.id) break;
        const subscription = await Subscription.findOne({
          razorpay_subscription_id: rzpSub.id,
          deleted_at: null,
        });
        if (subscription) {
          subscription.status = 'expired';
          await subscription.save();
        }
        break;
      }

      case 'subscription.halted':
      case 'payment.failed': {
        const rzpSub = event.payload?.subscription?.entity;
        if (rzpSub?.id) {
          const subscription = await Subscription.findOne({
            razorpay_subscription_id: rzpSub.id,
            deleted_at: null,
          });
          if (subscription) {
            subscription.status = 'suspended';
            subscription.payment_status = 'failed';
            await subscription.save();
          }
        }
        break;
      }

      default:
        console.log(`[RazorpayWebhook] Unhandled event: ${eventType}`);
    }
  } catch (error) {
    console.error('[RazorpayWebhook] Error:', error.message);
  }
};

exports.paypalWebhook = async (req, res) => {
  try {
    let rawBody;

    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString('utf8');
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
    } else if (req.body && Object.keys(req.body).length > 0) {
      console.warn('[PayPalWebhook] Body was already parsed as JSON, signature verification may fail');
      rawBody = JSON.stringify(req.body);
    } else {
      console.error('[PayPalWebhook] No body received');
      console.error('[PayPalWebhook] req.body type:', typeof req.body);
      console.error('[PayPalWebhook] req.body:', req.body);
      return res.status(400).json({ error: 'No webhook payload' });
    }

    console.log('[PayPalWebhook] Raw body length:', rawBody.length);
    console.log('[PayPalWebhook] Raw body preview:', rawBody.substring(0, 200));

    const reqBody = JSON.parse(rawBody);

    const isSandbox = process.env.PAYPAL_MODE === 'sandbox' || process.env.NODE_ENV !== 'production';
    let isValid;

    if (isSandbox) {
      console.log('[PayPalWebhook] Sandbox mode - skipping signature verification for development');
      isValid = true;
    } else {
      isValid = await PayPalService.verifyWebhookSignature(rawBody, req.headers);
      if (!isValid) {
        console.warn('[PayPalWebhook] Invalid signature');
        console.error('[PayPalWebhook] Headers received:', {
          'paypal-auth-algo': req.headers['paypal-auth-algo']?.substring(0, 20) + '...',
          'paypal-cert-url': req.headers['paypal-cert-url']?.substring(0, 50) + '...',
          'paypal-transmission-id': req.headers['paypal-transmission-id'],
          'paypal-transmission-sig': req.headers['paypal-transmission-sig']?.substring(0, 20) + '...',
          'paypal-transmission-time': req.headers['paypal-transmission-time'],
        });
        return res.status(400).json({ error: 'Invalid webhook signature' });
      }
    }

    res.json({ received: true });

    const eventType = reqBody?.event_type;
    const resource = reqBody?.resource;
    console.log(`[PayPalWebhook] Event: ${eventType}`);

    if (!eventType || !resource) return;

    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        const subscription = await Subscription.findOne({
          paypal_subscription_id: resource.id,
          deleted_at: null,
        }).populate('plan_id');

        if (subscription) {
          const now = new Date();
          const periodEnd = calculatePeriodEnd(now, subscription.plan_id?.billing_cycle || 'monthly');
          subscription.status = 'active';
          subscription.payment_status = 'paid';
          subscription.current_period_start = now;
          subscription.current_period_end = periodEnd;
          subscription.expires_at = periodEnd;
          if (subscription.plan_id?.features) subscription.features = subscription.plan_id.features;
          await subscription.save();

          if (subscription.plan_id?.plan_type === 'top_up') {
            await activateTopUp(subscription.user_id, subscription.plan_id?._id);
          } else {
            await activateUserSubscription(subscription.user_id, subscription.plan_id?._id);
          }

          console.log(`[PayPalWebhook] Subscription ${subscription._id} activated`);
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        const subscription = await Subscription.findOne({
          paypal_subscription_id: resource.id,
          deleted_at: null,
        }).populate('plan_id');
        if (subscription) {
          subscription.status = eventType === 'BILLING.SUBSCRIPTION.EXPIRED' ? 'expired' : 'cancelled';
          subscription.cancelled_at = new Date();
          subscription.auto_renew = false;
          await subscription.save();

          if (subscription.plan_id && subscription.plan_id.total_credits) {
            const userToUpdate = await User.findById(subscription.user_id);
            if (userToUpdate) {
              userToUpdate.total_credits = Math.max(0, (userToUpdate.total_credits || 0) - subscription.plan_id.total_credits);
              if (userToUpdate.plan_id && userToUpdate.plan_id.toString() === subscription.plan_id._id.toString()) {
                userToUpdate.plan_id = null;
              }
              await userToUpdate.save();
            }
          }
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.SUSPENDED': {
        const subscription = await Subscription.findOne({
          paypal_subscription_id: resource.id,
          deleted_at: null,
        });
        if (subscription) {
          subscription.status = 'suspended';
          subscription.payment_status = 'failed';
          await subscription.save();
        }
        break;
      }

      case 'PAYMENT.SALE.COMPLETED': {
        const paypalSubId = resource.billing_agreement_id;
        if (!paypalSubId) break;
        const subscription = await Subscription.findOne({
          paypal_subscription_id: paypalSubId,
          deleted_at: null,
        }).populate('plan_id');

        if (subscription) {
          const now = new Date();
          const periodEnd = calculatePeriodEnd(now, subscription.plan_id?.billing_cycle || 'monthly');
          subscription.status = 'active';
          subscription.current_period_start = now;
          subscription.current_period_end = periodEnd;
          subscription.expires_at = periodEnd;
          await subscription.save();

          await PaymentHistory.create({
            user_id: subscription.user_id,
            subscription_id: subscription._id,
            plan_id: subscription.plan_id?._id,
            amount: parseFloat(resource.amount?.total || 0),
            currency: resource.amount?.currency?.toUpperCase() || subscription.currency,
            payment_method: 'paypal',
            payment_status: 'success',
            payment_gateway: 'paypal',
            transaction_id: resource.id,
            invoice_number: generateInvoiceNumber(),
            paid_at: now,
          });
        }
        break;
      }

      case 'PAYMENT.SALE.DENIED':
      case 'PAYMENT.SALE.REFUNDED': {
        const paypalSubId = resource.billing_agreement_id;
        if (!paypalSubId) break;
        const subscription = await Subscription.findOne({
          paypal_subscription_id: paypalSubId,
          deleted_at: null,
        });
        if (subscription) {
          subscription.status = 'suspended';
          subscription.payment_status = eventType === 'PAYMENT.SALE.REFUNDED' ? 'refunded' : 'failed';
          await subscription.save();
        }
        break;
      }

      default:
        console.log(`[PayPalWebhook] Unhandled event: ${eventType}`);
    }
  } catch (error) {
    console.error('[PayPalWebhook] Error:', error.message);
  }
};
