'use strict';

const mongoose = require('mongoose');
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
  getGatewayConfig,
} = require('../utils/payment-gateway.service');
const { generateInvoiceNumber } = require('../utils/invoice-helper');
const Role = db.Role;
const { sendNotification } = require('../utils/notificationHelper');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || DEFAULT_PAGE);
  const limit = Math.max(1, Math.min(MAX_LIMIT, parseInt(query.limit) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

exports.getUserSubscription = async (req, res) => {
  try {
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      user_id: userId,
      deleted_at: null,
      $or: [
        { status: { $in: ['active', 'trial'] } },
        { payment_gateway: 'manual', status: 'pending' },
      ],
    })
      .populate({ path: 'plan_id', select: '-stripe_price_id -stripe_product_id -stripe_payment_link_id -stripe_payment_link_url -razorpay_plan_id -paypal_plan_id' })
      .sort({ created_at: -1 })
      .lean();

    if (!subscription) {
      return res.status(200).json({ success: true, data: [], message: 'No active subscription found' });
    }

    return res.status(200).json({ success: true, data: subscription });
  } catch (error) {
    console.error('Get user subscription error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch subscription', error: error.message });
  }
};

exports.startTrial = async (req, res) => {
  try {
    const userId = req.user._id;
    const { plan_id } = req.body;

    const plan = await Plan.findOne({ _id: plan_id, status: 'active', deleted_at: null });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found or inactive' });
    }

    if (!plan.trial_days || plan.trial_days === 0) {
      return res.status(400).json({ success: false, message: 'This plan does not offer a trial period' });
    }

    const existingSub = await Subscription.findOne({
      user_id: userId,
      status: { $in: ['trial', 'active'] },
      deleted_at: null,
    });

    if (existingSub) {
      return res.status(409).json({ success: false, message: 'You already have an active subscription' });
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + plan.trial_days);
    const now = new Date();

    const subscription = await Subscription.create({
      user_id: userId,
      plan_id: plan._id,
      status: 'trial',
      started_at: now,
      trial_ends_at: trialEndsAt,
      current_period_start: now,
      current_period_end: trialEndsAt,
      expires_at: trialEndsAt,
      payment_gateway: 'free',
      payment_method: 'free',
      payment_status: 'paid',
      currency: plan.currency || 'USD',
      features: plan.features || null,
    });

    if (plan.plan_type === 'top_up') {
      await activateTopUp(userId, plan._id);
    } else {
      await activateUserSubscription(userId, plan._id);
    }

    return res.status(201).json({
      success: true,
      data: subscription,
      message: `Trial started successfully. Expires in ${plan.trial_days} days.`,
    });
  } catch (error) {
    console.error('Start trial error:', error);
    return res.status(500).json({ success: false, message: 'Failed to start trial', error: error.message });
  }
};

exports.createStripeSubscription = async (req, res) => {
  try {
    const { plan_id } = req.body;
    const userId = req.user._id;

    if (!plan_id || !mongoose.Types.ObjectId.isValid(plan_id)) {
      return res.status(400).json({ success: false, message: 'Valid plan ID is required' });
    }

    const plan = await Plan.findOne({ _id: plan_id, status: 'active', deleted_at: null });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found or inactive' });
    }

    if (!plan.stripe_payment_link_url) {
      return res.status(400).json({ success: false, message: 'Plan does not have a Stripe payment link configured' });
    }

    const existingActive = await Subscription.findOne({
      user_id: userId,
      status: { $in: ['active', 'trial'] },
      deleted_at: null,
    });

    if (plan.plan_type === 'top_up') {
      if (!existingActive) {
        return res.status(403).json({ success: false, message: 'Top-up requires an active subscription.' });
      }
    } else if (existingActive) {
      return res.status(409).json({ success: false, message: 'User already has an active subscription' });
    }

    let subscription = await Subscription.findOne({
      user_id: userId,
      plan_id: plan._id,
      status: 'pending',
      payment_gateway: 'stripe',
      deleted_at: null,
    });

    if (!subscription) {
      const now = new Date();
      const periodEnd = calculatePeriodEnd(now, plan.billing_cycle || 'monthly');
      subscription = await Subscription.create({
        user_id: userId,
        plan_id: plan._id,
        status: 'pending',
        started_at: now,
        current_period_start: now,
        current_period_end: periodEnd,
        payment_gateway: 'stripe',
        payment_method: 'card',
        payment_status: 'pending',
        currency: (plan.currency || 'USD').toString().toUpperCase(),
        features: plan.features || null,
      });
    }

    const separator = plan.stripe_payment_link_url.includes('?') ? '&' : '?';
    const params = new URLSearchParams();
    params.set('client_reference_id', userId.toString());
    if (req.user?.email) params.set('prefilled_email', req.user.email);

    const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    params.set('success_url', `${frontendUrl}/subscription/success`);
    params.set('cancel_url', `${frontendUrl}/subscription/cancel`);

    const paymentLink = `${plan.stripe_payment_link_url}${separator}${params.toString()}`;

    return res.status(200).json({
      success: true,
      message: 'Redirect user to the payment link to complete subscription',
      data: {
        subscription,
        payment_link: paymentLink,
        success_url: `${frontendUrl}/subscription/success`,
        cancel_url: `${frontendUrl}/subscription/cancel`,
        plan_id: plan._id,
        plan_name: plan.name,
      },
    });
  } catch (error) {
    console.error('Create Stripe subscription error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create Stripe subscription', error: error.message });
  }
};

exports.createRazorpaySubscription = async (req, res) => {
  try {
    const { plan_id } = req.body;
    const userId = req.user._id;

    if (!plan_id || !mongoose.Types.ObjectId.isValid(plan_id)) {
      return res.status(400).json({ success: false, message: 'Valid plan ID is required' });
    }

    const plan = await Plan.findOne({ _id: plan_id, status: 'active', deleted_at: null });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found or inactive' });
    }

    if (!plan.razorpay_plan_id) {
      return res.status(400).json({ success: false, message: 'Plan does not have Razorpay plan ID configured' });
    }

    const existingActive = await Subscription.findOne({
      user_id: userId,
      status: { $in: ['active', 'trial'] },
      deleted_at: null,
    });

    if (plan.plan_type === 'top_up') {
      if (!existingActive) {
        return res.status(403).json({ success: false, message: 'Top-up requires an active subscription.' });
      }
    } else if (existingActive) {
      return res.status(409).json({ success: false, message: 'User already has an active subscription' });
    }

    const returnUrl = `${process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`}/subscription/success`;
    const cancelUrl = `${process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`}/subscription/cancel`;

    const linkResult = await RazorpayService.createSubscriptionLink(
      plan.razorpay_plan_id,
      userId.toString(),
      {
        billingCycle: plan.billing_cycle,
        planIdDb: plan._id,
        notifyEmail: req.user?.email || undefined,
        notifyPhone: req.user?.phone || undefined,
        returnUrl,
        cancelUrl,
      }
    );

    const now = new Date();
    const periodEnd = calculatePeriodEnd(now, plan.billing_cycle || 'monthly');

    let subscription = await Subscription.findOne({
      user_id: userId,
      plan_id: plan._id,
      status: 'pending',
      payment_gateway: 'razorpay',
      deleted_at: null,
    });

    if (subscription) {
      subscription.razorpay_subscription_id = linkResult.id;
      subscription.current_period_end = periodEnd;
      await subscription.save();
    } else {
      subscription = await Subscription.create({
        user_id: userId,
        plan_id: plan._id,
        status: 'pending',
        started_at: now,
        current_period_start: now,
        current_period_end: periodEnd,
        payment_gateway: 'razorpay',
        payment_method: 'card',
        payment_status: 'pending',
        currency: (plan.currency || 'INR').toString().toUpperCase(),
        razorpay_subscription_id: linkResult.id,
        features: plan.features || null,
      });
    }

    const config = await getGatewayConfig('razorpay');
    const keyId = config?.razorpay_key_id || process.env.RAZORPAY_KEY_ID;

    return res.status(200).json({
      success: true,
      message: 'Redirect user to the subscription link to complete payment',
      data: {
        subscription,
        subscription_link: linkResult.short_url,
        payment_link: linkResult.short_url,
        gateway_order_id: linkResult.id,
        plan_id: plan._id,
        plan_name: plan.name,
        key_id: keyId,
      },
    });
  } catch (error) {
    console.error('Create Razorpay subscription error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create Razorpay subscription', error: error.message });
  }
};

exports.createPayPalSubscription = async (req, res) => {
  try {
    const { plan_id } = req.body;
    const userId = req.user._id;

    if (!plan_id || !mongoose.Types.ObjectId.isValid(plan_id)) {
      return res.status(400).json({ success: false, message: 'Valid plan ID is required' });
    }

    const plan = await Plan.findOne({ _id: plan_id, status: 'active', deleted_at: null });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found or inactive' });
    }

    if (!plan.paypal_plan_id) {
      return res.status(400).json({ success: false, message: 'Plan does not have PayPal plan ID configured' });
    }

    const existingActive = await Subscription.findOne({
      user_id: userId,
      status: { $in: ['active', 'trial'] },
      deleted_at: null,
    });

    if (plan.plan_type === 'top_up') {
      if (!existingActive) {
        return res.status(403).json({ success: false, message: 'Top-up requires an active subscription.' });
      }
    } else if (existingActive) {
      return res.status(409).json({ success: false, message: 'User already has an active subscription' });
    }

    const returnUrl = `${process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`}/subscription/success`;
    const cancelUrl = `${process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`}/subscription/cancel`;

    const paypalResult = await PayPalService.createSubscription(
      plan.paypal_plan_id,
      userId,
      returnUrl,
      cancelUrl
    );

    const approvalUrl = paypalResult.approvalUrl || paypalResult.links?.find(l => l.rel === 'approve')?.href;

    const now = new Date();
    const periodEnd = calculatePeriodEnd(now, plan.billing_cycle || 'monthly');

    let subscription = await Subscription.findOne({
      user_id: userId,
      plan_id: plan._id,
      status: 'pending',
      payment_gateway: 'paypal',
      deleted_at: null,
    });

    if (subscription) {
      subscription.paypal_subscription_id = paypalResult.paypalSubscriptionId;
      subscription.current_period_end = periodEnd;
      await subscription.save();
    } else {
      subscription = await Subscription.create({
        user_id: userId,
        plan_id: plan._id,
        status: 'pending',
        started_at: now,
        current_period_start: now,
        current_period_end: periodEnd,
        payment_gateway: 'paypal',
        payment_method: 'paypal',
        payment_status: 'pending',
        currency: (plan.currency || 'USD').toString().toUpperCase(),
        paypal_subscription_id: paypalResult.paypalSubscriptionId,
        features: plan.features || null,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'PayPal subscription initiated. Redirect user to the approval URL.',
      data: {
        subscription,
        paypal_subscription_id: paypalResult.paypalSubscriptionId,
        approval_url: approvalUrl,
        payment_link: approvalUrl,
        plan_id: plan._id,
        plan_name: plan.name,
      },
    });
  } catch (error) {
    console.error('Create PayPal subscription error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create PayPal subscription', error: error.message });
  }
};

exports.confirmSubscription = async (req, res) => {
  try {
    const {
      payment_gateway,
      session_id,
      paypal_subscription_id,
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_order_id,
      razorpay_signature,
    } = req.body;

    const userId = req.user._id;

    if (payment_gateway === 'razorpay') {
      if (!razorpay_payment_id || !razorpay_signature || (!razorpay_subscription_id && !razorpay_order_id)) {
        return res.status(400).json({ success: false, message: 'Missing Razorpay confirmation parameters' });
      }

      const idToVerify = razorpay_subscription_id || razorpay_order_id;
      const isValid = RazorpayService.verifyPaymentSignature(razorpay_payment_id, idToVerify, razorpay_signature);

      if (!isValid) {
        return res.status(400).json({ success: false, message: 'Invalid Razorpay signature' });
      }

      const subscription = await Subscription.findOne({
        user_id: userId,
        $or: [
          { razorpay_subscription_id: razorpay_subscription_id || 'null_placeholder' },
          { razorpay_order_id: razorpay_order_id || 'null_placeholder' },
        ],
        status: 'pending',
        deleted_at: null,
      }).populate('plan_id');

      if (!subscription) {
        const activeSub = await Subscription.findOne({
          user_id: userId,
          $or: [
            { razorpay_subscription_id: razorpay_subscription_id || 'null_placeholder' },
            { razorpay_order_id: razorpay_order_id || 'null_placeholder' },
          ],
          status: 'active',
          deleted_at: null,
        }).populate('plan_id');

        if (activeSub) {
          return res.status(200).json({ success: true, message: 'Subscription already active', data: activeSub });
        }
        return res.status(404).json({ success: false, message: 'Pending subscription not found' });
      }

      const plan = subscription.plan_id;
      const now = new Date();
      const periodEnd = calculatePeriodEnd(now, plan?.billing_cycle || 'monthly');

      subscription.status = 'active';
      subscription.payment_status = 'paid';
      subscription.current_period_start = now;
      subscription.current_period_end = periodEnd;
      subscription.expires_at = periodEnd;
      subscription.amount_paid = plan?.amount || 0;
      await subscription.save();

      const existingPayment = await PaymentHistory.findOne({
        transaction_id: razorpay_payment_id,
        payment_gateway: 'razorpay',
      });

      if (!existingPayment) {
        await PaymentHistory.create({
          user_id: userId,
          subscription_id: subscription._id,
          plan_id: plan?._id,
          amount: plan?.amount || 0,
          currency: subscription.currency || 'INR',
          payment_method: 'card',
          payment_status: 'success',
          payment_gateway: 'razorpay',
          transaction_id: razorpay_payment_id,
          invoice_number: generateInvoiceNumber(),
          paid_at: now,
        });
      }

      if (plan?.plan_type === 'top_up') {
        await activateTopUp(userId, plan?._id);
      } else {
        await activateUserSubscription(userId, plan?._id);
      }

      return res.status(200).json({ success: true, message: 'Subscription activated successfully', data: subscription });
    }

    if (payment_gateway === 'stripe' && session_id) {
      const activeSub = await Subscription.findOne({
        user_id: userId,
        payment_gateway: 'stripe',
        status: 'active',
        deleted_at: null
      }).populate('plan_id');

      if (activeSub) {
        return res.status(200).json({
          success: true,
          message: 'Subscription confirmed',
          data: activeSub,
          status: 'active'
        });
      }

      const pendingSub = await Subscription.findOne({
        user_id: userId,
        payment_gateway: 'stripe',
        status: 'pending',
        deleted_at: null
      }).populate('plan_id').sort({ created_at: -1 });

      if (pendingSub) {
        return res.status(200).json({
          success: false,
          message: 'Payment received, activating subscription...',
          data: pendingSub,
          status: 'pending',
          retry: true
        });
      }

      return res.status(200).json({
        success: false,
        message: 'No subscription found',
        status: 'not_found',
        retry: false
      });
    }

    if (payment_gateway === 'paypal' && paypal_subscription_id) {
      const subscription = await Subscription.findOne({
        user_id: userId,
        paypal_subscription_id: paypal_subscription_id,
        deleted_at: null
      }).populate('plan_id');

      if (subscription && subscription.status === 'active') {
        return res.status(200).json({ success: true, message: 'Subscription confirmed', data: subscription });
      }
      return res.status(404).json({ success: false, message: 'Subscription confirmation pending' });
    }

    return res.status(400).json({ success: false, message: 'Unsupported payment gateway or missing parameters' });

  } catch (error) {
    console.error('Confirm subscription error:', error);
    return res.status(500).json({ success: false, message: 'Failed to confirm subscription', error: error.message });
  }
};

exports.createManualSubscription = async (req, res) => {
  try {
    const {
      plan_id,
      payment_reference,
      manual_payment_type,
      bank_account_no,
      bank_name,
      bank_holder_name,
      bank_swift_code,
      bank_routing_number,
      bank_ifsc_no,
      bank_account_number,
      bank_ifsc_code,
    } = req.body;
    const userId = req.user._id;
    const transaction_receipt = req.file ? req.file.path : null;

    if (!plan_id || !mongoose.Types.ObjectId.isValid(plan_id)) {
      return res.status(400).json({ success: false, message: 'Valid plan ID is required' });
    }

    const plan = await Plan.findOne({ _id: plan_id, status: 'active', deleted_at: null });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found or inactive' });
    }

    const existingActive = await Subscription.findOne({
      user_id: userId,
      status: { $in: ['active', 'trial'] },
      deleted_at: null,
    });

    if (plan.plan_type === 'top_up') {
      if (!existingActive) {
        return res.status(403).json({ success: false, message: 'Top-up requires an active subscription.' });
      }
    } else if (existingActive) {
      return res.status(409).json({ success: false, message: 'User already has an active subscription' });
    }

    const existingPending = await Subscription.findOne({
      user_id: userId,
      plan_id: plan._id,
      payment_gateway: 'manual',
      status: 'pending',
      deleted_at: null,
    });
    if (existingPending) {
      return res.status(200).json({
        success: true,
        message: 'Manual payment subscription request already submitted. Awaiting admin approval.',
        data: existingPending,
      });
    }

    const now = new Date();
    const periodEnd = calculatePeriodEnd(now, plan.billing_cycle || 'monthly');

    const subscription = await Subscription.create({
      user_id: userId,
      plan_id: plan._id,
      status: 'pending',
      started_at: now,
      current_period_start: now,
      current_period_end: periodEnd,
      payment_gateway: 'manual',
      payment_method: manual_payment_type === 'bank_transfer' ? 'bank_transfer' : 'cash',
      payment_status: 'pending',
      payment_reference: payment_reference?.trim() || null,
      transaction_receipt,
      manual_payment_type: manual_payment_type || 'cash',
      bank_name: manual_payment_type === 'bank_transfer' ? (bank_name || null) : null,
      bank_account_no: manual_payment_type === 'bank_transfer' ? (bank_account_no || bank_account_number || null) : null,
      bank_account_number: manual_payment_type === 'bank_transfer' ? (bank_account_number || bank_account_no || null) : null,
      bank_holder_name: manual_payment_type === 'bank_transfer' ? (bank_holder_name || null) : null,
      bank_swift_code: manual_payment_type === 'bank_transfer' ? (bank_swift_code || null) : null,
      bank_routing_number: manual_payment_type === 'bank_transfer' ? (bank_routing_number || null) : null,
      bank_ifsc_no: manual_payment_type === 'bank_transfer' ? (bank_ifsc_no || bank_ifsc_code || null) : null,
      bank_ifsc_code: manual_payment_type === 'bank_transfer' ? (bank_ifsc_code || bank_ifsc_no || null) : null,
      currency: (plan.currency || 'USD').toString().toUpperCase(),
      amount_paid: 0,
      features: plan.features || null,
      auto_renew: false,
    });

    try {
      const adminRole = await Role.findOne({ name: 'super_admin' });
      if (adminRole) {
        const admins = await User.find({ roleId: adminRole._id });
        for (const admin of admins) {
          await sendNotification(
            req.app,
            admin._id,
            'subscription_pending',
            'New Manual Subscription Pending',
            `A new manual subscription request for plan ${plan.name} is waiting for your approval.`,
            { subscriptionId: subscription._id }
          );
        }
      }
    } catch (notifErr) {
      console.warn('Admin notification failed:', notifErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Manual payment subscription requested. Your subscription will be active after admin approval.',
      data: subscription,
    });
  } catch (error) {
    console.error('Create manual subscription error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create manual subscription', error: error.message });
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: id,
      user_id: userId,
      deleted_at: null,
    }).populate('plan_id');

    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Subscription not found' });
    }

    if (!['trial', 'active'].includes(subscription.status)) {
      return res.status(400).json({ success: false, message: 'Only active or trial subscriptions can be cancelled' });
    }

    try {
      if (subscription.payment_gateway === 'stripe' && subscription.stripe_subscription_id) {
        await StripeService.cancelSubscription(subscription.stripe_subscription_id, true);
      } else if (subscription.payment_gateway === 'razorpay' && subscription.razorpay_subscription_id) {
        await RazorpayService.cancelSubscription(subscription.razorpay_subscription_id, true);
      } else if (subscription.payment_gateway === 'paypal' && subscription.paypal_subscription_id) {
        await PayPalService.cancelSubscription(subscription.paypal_subscription_id);
      }
    } catch (gwErr) {
      console.warn('Gateway cancel warning:', gwErr.message);
    }

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

    return res.json({ success: true, data: subscription, message: 'Subscription cancelled successfully' });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    return res.status(500).json({ success: false, message: 'Failed to cancel subscription', error: error.message });
  }
};

exports.resumeSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: id,
      user_id: userId,
      deleted_at: null,
    }).populate('plan_id');

    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Subscription not found' });
    }

    try {
      if (subscription.payment_gateway === 'stripe' && subscription.stripe_subscription_id) {
        await StripeService.resumeSubscription(subscription.stripe_subscription_id);
        subscription.status = 'active';
        subscription.cancelled_at = null;
        subscription.auto_renew = true;
        await subscription.save();
        return res.json({ success: true, data: subscription, message: 'Subscription resumed successfully' });
      } else if (subscription.payment_gateway === 'razorpay' && subscription.razorpay_subscription_id) {
        await RazorpayService.resumeSubscription(subscription.razorpay_subscription_id);
        subscription.status = 'active';
        subscription.cancelled_at = null;
        subscription.auto_renew = true;
        await subscription.save();
        return res.json({ success: true, data: subscription, message: 'Subscription resumed successfully' });
      }
    } catch (gwErr) {
      console.warn('Gateway resume warning:', gwErr.message);
    }

    const plan = subscription.plan_id;
    if (plan?.stripe_payment_link_url) {
      return res.json({
        success: true,
        message: 'Please complete payment to resume',
        data: { payment_url: plan.stripe_payment_link_url },
      });
    }

    return res.status(400).json({ success: false, message: 'Automatic resume not available. Please create a new subscription.' });
  } catch (error) {
    console.error('Resume subscription error:', error);
    return res.status(500).json({ success: false, message: 'Failed to resume subscription', error: error.message });
  }
};

exports.changeSubscriptionPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const { new_plan_id } = req.body;

    const subscription = await Subscription.findOne({
      _id: id,
      user_id: userId,
      status: 'active',
      deleted_at: null,
    }).populate('plan_id');

    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Active subscription not found' });
    }

    const newPlan = await Plan.findOne({ _id: new_plan_id, status: 'active', deleted_at: null });
    if (!newPlan) {
      return res.status(404).json({ success: false, message: 'New plan not found or inactive' });
    }

    const oldPlan = subscription.plan_id;

    try {
      if (subscription.payment_gateway === 'stripe' && subscription.stripe_subscription_id && newPlan.stripe_price_id) {
        await StripeService.updateSubscription(subscription.stripe_subscription_id, newPlan.stripe_price_id);
      }
    } catch (gwErr) {
      console.warn('Gateway plan change warning:', gwErr.message);
    }

    subscription.plan_id = newPlan._id;
    subscription.features = newPlan.features || null;
    await subscription.save();

    const direction = (newPlan.amount || 0) >= ((oldPlan?.amount) || 0) ? 'upgraded' : 'downgraded';

    return res.json({
      success: true,
      data: subscription,
      message: `Subscription ${direction} successfully`,
    });
  } catch (error) {
    console.error('Change plan error:', error);
    return res.status(500).json({ success: false, message: 'Failed to change plan', error: error.message });
  }
};

exports.getMyPaymentHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page, limit, skip } = parsePagination(req.query);
    const { search, sortBy = 'paid_at', sortOrder = 'desc' } = req.query;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const filter = { user_id: userId, deleted_at: null };

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');

      const plans = await Plan.find({ name: searchRegex }).select('_id');
      const planIds = plans.map((p) => p._id);

      filter.$or = [
        { invoice_number: searchRegex },
        { transaction_id: searchRegex },
      ];

      if (planIds.length > 0) filter.$or.push({ plan_id: { $in: planIds } });
    }
    const [payments, total] = await Promise.all([
      PaymentHistory.find(filter)
        .populate('plan_id', 'name slug amount billing_cycle')
        .populate('subscription_id', 'expires_at current_period_end status')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(),
      PaymentHistory.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: payments,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Get my payment history error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch payment history', error: error.message });
  }
};

exports.getAllSubscriptions = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status, user_id, is_expiring_soon, search, sort_by = 'created_at', sort_order = 'desc' } = req.query;

    const matchQuery = { deleted_at: null };

    if (status) matchQuery.status = status;
    if (user_id && mongoose.Types.ObjectId.isValid(user_id)) {
      matchQuery.user_id = new mongoose.Types.ObjectId(user_id);
    }
    if (is_expiring_soon === 'true') {
      const now = new Date();
      const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      matchQuery.current_period_end = { $lte: next7Days, $gte: now };
      matchQuery.status = { $in: ['active', 'trial'] };
    }

    const sortDir = sort_order?.toLowerCase() === 'asc' ? 1 : -1;
    const sortField = sort_by || 'created_at';

    const pipeline = [
      { $match: matchQuery },
      { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'plans', localField: 'plan_id', foreignField: '_id', as: 'plan' } },
      { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
    ];

    if (search?.trim()) {
      pipeline.push({
        $match: {
          $or: [
            { 'user.name': { $regex: search.trim(), $options: 'i' } },
            { 'user.email': { $regex: search.trim(), $options: 'i' } },
            { 'plan.name': { $regex: search.trim(), $options: 'i' } },
            { payment_reference: { $regex: search.trim(), $options: 'i' } },
          ],
        },
      });
    }

    const countPipeline = [...pipeline, { $count: 'total' }];
    const dataPipeline = [
      ...pipeline,
      {
        $project: {
          _id: 1, status: 1, started_at: 1, trial_ends_at: 1,
          current_period_start: 1, current_period_end: 1, expires_at: 1,
          cancelled_at: 1, payment_gateway: 1, payment_method: 1,
          payment_status: 1, amount_paid: 1, currency: 1, auto_renew: 1,
          duration: 1, created_at: 1, approved_by: 1, approved_at: 1,
          transaction_receipt: 1, payment_reference: 1, manual_payment_type: 1,
          user: { _id: '$user._id', name: '$user.name', email: '$user.email' },
          plan: { _id: '$plan._id', name: '$plan.name', slug: '$plan.slug', amount: '$plan.amount', billing_cycle: '$plan.billing_cycle' },
        },
      },
      { $sort: { [sortField]: sortDir } },
      { $skip: skip },
      { $limit: limit },
    ];

    const nowMetrics = new Date();
    const next7DaysMetrics = new Date(nowMetrics.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [countResult, subscriptions, statsResult, revenueResult] = await Promise.all([
      Subscription.aggregate(countPipeline),
      Subscription.aggregate(dataPipeline),
      Subscription.aggregate([
        { $match: { deleted_at: null } },
        {
          $group: {
            _id: null,
            totalSubscriptions: { $sum: 1 },
            currentSubscriptions: {
              $sum: { $cond: [{ $in: ['$status', ['active', 'trial']] }, 1, 0] },
            },
            subscriptionsExpired: {
              $sum: { $cond: [{ $in: ['$status', ['expired', 'cancelled']] }, 1, 0] },
            },
            expiringSoon: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $in: ['$status', ['active', 'trial']] },
                      { $gte: ['$current_period_end', nowMetrics] },
                      { $lte: ['$current_period_end', next7DaysMetrics] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      PaymentHistory.aggregate([
        { $match: { deleted_at: null, payment_status: 'success' } },
        { $group: { _id: null, totalRevenue: { $sum: '$amount' } } },
      ]),
    ]);

    const total = countResult[0]?.total || 0;
    const statsData = statsResult[0] || {
      totalSubscriptions: 0,
      currentSubscriptions: 0,
      subscriptionsExpired: 0,
      expiringSoon: 0,
    };
    const totalRevenue = revenueResult[0]?.totalRevenue || 0;

    return res.json({
      success: true,
      data: {
        subscriptions,
        stats: {
          total_subscriptions: statsData.totalSubscriptions,
          total_revenue: totalRevenue,
          current_subscriptions: statsData.currentSubscriptions,
          subscriptions_expired: statsData.subscriptionsExpired,
          expiring_soon: statsData.expiringSoon,
        },
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit,
        },
      },
    });
  } catch (error) {
    console.error('Get all subscriptions error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch subscriptions', error: error.message });
  }
};

exports.getSubscriptionPayments = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status, user_id, payment_gateway, start_date, end_date, search, sortBy = 'paid_at', sortOrder = 'desc' } = req.query;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const filter = { deleted_at: null };
    if (status) filter.payment_status = status;
    if (user_id && mongoose.Types.ObjectId.isValid(user_id)) filter.user_id = new mongoose.Types.ObjectId(user_id);
    if (payment_gateway) filter.payment_gateway = payment_gateway;
    if (start_date || end_date) {
      const dateFilter = {};
      if (start_date) dateFilter.$gte = new Date(start_date);
      if (end_date) dateFilter.$lte = new Date(end_date);
      filter.paid_at = dateFilter;
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');

      const users = await User.find({
        $or: [{ name: searchRegex }, { email: searchRegex }],
      }).select('_id');
      const userIds = users.map((u) => u._id);

      const plans = await Plan.find({ name: searchRegex }).select('_id');
      const planIds = plans.map((p) => p._id);

      filter.$or = [
        { invoice_number: searchRegex },
        { transaction_id: searchRegex },
      ];

      if (userIds.length > 0) filter.$or.push({ user_id: { $in: userIds } });
      if (planIds.length > 0) filter.$or.push({ plan_id: { $in: planIds } });
    }

    const [payments, total, stats] = await Promise.all([
      PaymentHistory.find(filter)
        .populate('user_id', 'name email')
        .populate('plan_id', 'name slug amount billing_cycle')
        .populate('subscription_id', 'status payment_gateway')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(),
      PaymentHistory.countDocuments(filter),
      PaymentHistory.aggregate([
        { $match: filter },
        { $group: { _id: '$payment_status', count: { $sum: 1 }, total_amount: { $sum: '$amount' } } },
      ]),
    ]);

    return res.json({
      success: true,
      data: payments,
      stats,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Get subscription payments error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch payments', error: error.message });
  }
};

exports.getPendingManualSubscriptions = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const filter = { deleted_at: null, payment_gateway: 'manual', status: 'pending' };
    const [subscriptions, total] = await Promise.all([
      Subscription.find(filter)
        .populate('user_id', 'name email phone')
        .populate('plan_id', 'name slug amount billing_cycle')
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(),
      Subscription.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: { subscriptions, pagination: { currentPage: page, totalPages: Math.ceil(total / limit), totalItems: total, itemsPerPage: limit } },
    });
  } catch (error) {
    console.error('Get pending manual subscriptions error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch pending subscriptions', error: error.message });
  }
};

exports.getSubscriptionStats = async (req, res) => {
  try {
    const [statusStats, gatewayStats, recentPayments] = await Promise.all([
      Subscription.aggregate([
        { $match: { deleted_at: null } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Subscription.aggregate([
        { $match: { deleted_at: null, status: { $in: ['active', 'trial'] } } },
        { $group: { _id: '$payment_gateway', count: { $sum: 1 } } },
      ]),
      PaymentHistory.aggregate([
        { $match: { deleted_at: null, payment_status: 'success' } },
        { $group: { _id: null, total_revenue: { $sum: '$amount' }, total_payments: { $sum: 1 } } },
      ]),
    ]);

    return res.json({
      success: true,
      data: {
        by_status: statusStats,
        by_gateway: gatewayStats,
        revenue: recentPayments[0] || { total_revenue: 0, total_payments: 0 },
      },
    });
  } catch (error) {
    console.error('Get subscription stats error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch stats', error: error.message });
  }
};

exports.approveManualSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const adminUserId = req.user._id;

    const subscription = await Subscription.findOne({
      _id: id,
      status: 'pending',
      payment_gateway: 'manual',
      deleted_at: null,
    }).populate('plan_id');

    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Pending manual subscription not found' });
    }

    const plan = subscription.plan_id;
    const now = new Date();
    const periodEnd = calculatePeriodEnd(now, plan.billing_cycle || 'monthly');

    subscription.status = 'active';
    subscription.payment_status = 'paid';
    subscription.current_period_start = now;
    subscription.current_period_end = periodEnd;
    subscription.expires_at = periodEnd;
    subscription.approved_by = adminUserId;
    subscription.approved_at = now;
    subscription.auto_renew = false;
    subscription.amount_paid = plan.price || 0;
    subscription.features = plan.features || null;
    await subscription.save();

    await PaymentHistory.create({
      user_id: subscription.user_id,
      subscription_id: subscription._id,
      plan_id: plan._id,
      amount: plan.price || 0,
      currency: subscription.currency || plan.currency || 'USD',
      payment_method: subscription.manual_payment_type || 'manual',
      payment_status: 'success',
      payment_gateway: 'manual',
      invoice_number: generateInvoiceNumber(),
      paid_at: now,
    });

    if (plan?.plan_type === 'top_up') {
      await activateTopUp(subscription.user_id, plan?._id);
    } else {
      await activateUserSubscription(subscription.user_id, plan?._id);
    }

    try {
      await sendNotification(
        req.app,
        subscription.user_id,
        'subscription_approved',
        'Subscription Approved',
        `Your manual subscription request for plan ${plan.name} has been approved.`,
        { subscriptionId: subscription._id }
      );
    } catch (notifErr) {
      console.warn('User notification failed:', notifErr.message);
    }

    return res.json({ success: true, data: subscription, message: 'Manual subscription approved and activated' });
  } catch (error) {
    console.error('Approve manual subscription error:', error);
    return res.status(500).json({ success: false, message: 'Failed to approve subscription', error: error.message });
  }
};

exports.rejectManualSubscription = async (req, res) => {
  try {
    const { id } = req.params;

    const subscription = await Subscription.findOne({
      _id: id,
      status: 'pending',
      payment_gateway: 'manual',
      deleted_at: null,
    }).populate('plan_id');

    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Pending manual subscription not found' });
    }

    const plan = subscription.plan_id;

    subscription.status = 'rejected';
    subscription.payment_status = 'failed';
    subscription.cancelled_at = new Date();
    await subscription.save();

    await PaymentHistory.create({
      user_id: subscription.user_id,
      subscription_id: subscription._id,
      plan_id: plan ? plan._id : null,
      amount: plan ? (plan.price || plan.amount || 0) : 0,
      currency: subscription.currency || (plan ? plan.currency : 'USD') || 'USD',
      payment_method: subscription.manual_payment_type || 'manual',
      payment_status: 'failed',
      payment_gateway: 'manual',
      invoice_number: generateInvoiceNumber(),
      paid_at: new Date(),
    });

    try {
      await sendNotification(
        req.app,
        subscription.user_id,
        'subscription_rejected',
        'Subscription Rejected',
        `Your manual subscription request for plan ${plan ? plan.name : 'Unknown Plan'} has been rejected.`,
        { subscriptionId: subscription._id }
      );
    } catch (notifErr) {
      console.warn('User notification failed:', notifErr.message);
    }

    return res.json({ success: true, data: subscription, message: 'Manual subscription rejected' });
  } catch (error) {
    console.error('Reject manual subscription error:', error);
    return res.status(500).json({ success: false, message: 'Failed to reject subscription', error: error.message });
  }
};

exports.assignPlanToUser = async (req, res) => {
  try {
    const { user_id, plan_id, amount, duration: reqDuration = 1 } = req.body;
    const adminId = req.user._id;

    const duration = Math.max(1, Math.min(24, parseInt(reqDuration) || 1));

    if (!user_id || !mongoose.Types.ObjectId.isValid(user_id)) {
      return res.status(400).json({ success: false, message: 'Valid user ID is required' });
    }
    if (!plan_id || !mongoose.Types.ObjectId.isValid(plan_id)) {
      return res.status(400).json({ success: false, message: 'Valid plan ID is required' });
    }

    const [user, plan] = await Promise.all([
      User.findById(user_id),
      Plan.findOne({ _id: plan_id, status: 'active', deleted_at: null }),
    ]);

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found or inactive' });

    const existingSubs = await Subscription.find({
      user_id,
      status: { $in: ['active', 'trial', 'pending'] },
      deleted_at: null,
    });

    if (plan.plan_type !== 'top_up') {
      for (const sub of existingSubs) {
        try {
          if (sub.stripe_subscription_id) await StripeService.cancelSubscription(sub.stripe_subscription_id, false);
          if (sub.razorpay_subscription_id) await RazorpayService.cancelSubscription(sub.razorpay_subscription_id, false);
          if (sub.paypal_subscription_id) await PayPalService.cancelSubscription(sub.paypal_subscription_id, 'Admin reassigned plan');
        } catch (err) {
          console.warn('Gateway cancel during reassignment:', err.message);
        }
        sub.status = 'cancelled';
        sub.cancelled_at = new Date();
        sub.auto_renew = false;
        await sub.save();
      }
    }

    const now = new Date();
    const billingCycle = plan.billing_cycle || 'monthly';
    const finalDuration = billingCycle === 'lifetime' ? 1 : duration;
    const periodEnd = calculatePeriodEnd(now, billingCycle, finalDuration);
    const amountPaid = amount !== undefined ? Number(amount) : (plan.price * finalDuration);

    const subscription = await Subscription.create({
      user_id,
      plan_id: plan._id,
      status: 'active',
      started_at: now,
      current_period_start: now,
      current_period_end: periodEnd,
      expires_at: periodEnd,
      duration: finalDuration,
      payment_gateway: 'admin generated',
      payment_method: 'manual',
      payment_status: 'paid',
      approved_by: adminId,
      approved_at: now,
      created_by: adminId,
      currency: (plan.currency || 'USD').toString().toUpperCase(),
      amount_paid: amountPaid,
      features: plan.features || null,
      auto_renew: false,
      notes: 'Admin assigned plan',
    });

    await PaymentHistory.create({
      user_id,
      subscription_id: subscription._id,
      plan_id: plan._id,
      amount: amountPaid,
      currency: subscription.currency,
      payment_method: 'manual',
      payment_status: 'success',
      transaction_id: `ADMIN-${Date.now()}`,
      payment_gateway: 'admin generated',
      payment_response: { assigned_by: adminId },
      invoice_number: generateInvoiceNumber(),
      paid_at: now,
      notes: 'Admin assigned plan',
    });

    if (plan.plan_type === 'top_up') {
      await activateTopUp(user_id, plan_id);
    } else {
      await activateUserSubscription(user_id, plan_id);
    }

    return res.status(201).json({
      success: true,
      message: `Plan assigned to ${user.email} for ${finalDuration} cycle(s)`,
      data: subscription,
    });
  } catch (error) {
    console.error('Assign plan to user error:', error);
    return res.status(500).json({ success: false, message: 'Failed to assign plan', error: error.message });
  }
};

exports.generateAdminSubscription = exports.assignPlanToUser;


exports.renewSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const subscription = await Subscription.findOne({ _id: id, user_id: userId, deleted_at: null }).populate('plan_id');
    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Subscription not found' });
    }

    if (!['expired', 'cancelled'].includes(subscription.status)) {
      return res.status(400).json({ success: false, message: 'Only expired or cancelled subscriptions can be renewed' });
    }

    const plan = subscription.plan_id;
    if (plan?.stripe_payment_link_url) {
      const separator = plan.stripe_payment_link_url.includes('?') ? '&' : '?';
      const params = new URLSearchParams();
      params.set('client_reference_id', userId.toString());
      if (req.user?.email) params.set('prefilled_email', req.user.email);

      const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
      params.set('success_url', `${frontendUrl}/subscription/success`);
      params.set('cancel_url', `${frontendUrl}/subscription/cancel`);

      return res.json({
        success: true,
        message: 'Please complete payment to renew',
        data: {
          payment_url: `${plan.stripe_payment_link_url}${separator}${params.toString()}`,
          success_url: `${frontendUrl}/subscription/success`,
          cancel_url: `${frontendUrl}/subscription/cancel`,
        },
      });
    }

    return res.status(400).json({
      success: false,
      message: 'Automatic renewal not available. Please create a new subscription.',
    });
  } catch (error) {
    console.error('Renew subscription error:', error);
    return res.status(500).json({ success: false, message: 'Failed to renew subscription', error: error.message });
  }
};
