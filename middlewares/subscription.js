'use strict';

const { db } = require('../models');
const Subscription = db.Subscription;

// Returns { ok: true, subscription } or { ok: false, code, message } for an account owner.
const checkActiveSubscription = async (userId) => {
  const subscription = await Subscription.findOne({
    user_id: userId,
    status: { $in: ['trial', 'active'] },
    deleted_at: null,
  }).sort({ created_at: -1 });

  if (!subscription) {
    return { ok: false, code: 'SUBSCRIPTION_REQUIRED', message: 'Active subscription required to access this feature. Please choose a plan.' };
  }
  if (subscription.expires_at && new Date() > subscription.expires_at) {
    await Subscription.updateOne({ _id: subscription._id }, { $set: { status: 'expired' } });
    return { ok: false, code: 'SUBSCRIPTION_EXPIRED', message: 'Your subscription has expired. Please renew to continue.' };
  }
  if (subscription.status === 'trial' && subscription.trial_ends_at && new Date() > subscription.trial_ends_at) {
    await Subscription.updateOne({ _id: subscription._id }, { $set: { status: 'expired' } });
    return { ok: false, code: 'TRIAL_EXPIRED', message: 'Your trial period has ended. Please subscribe to continue.' };
  }
  return { ok: true, subscription };
};

// Actions that stay available without a plan: subscribing/paying, own settings,
// and exporting or deleting one's own data. Everything else that is not a
// plain "view" needs an active subscription.
const SUBSCRIPTION_FREE_PERMISSIONS = new Set([
  'create.subscriptions',
  'update.subscriptions',
  'update.user_settings',
  'export.contacts',
]);

const permissionNeedsSubscription = (permissionSlug) => {
  const [action] = String(permissionSlug || '').split('.');
  if (action === 'view' || action === 'delete') return false;
  return !SUBSCRIPTION_FREE_PERMISSIONS.has(permissionSlug);
};

exports.checkActiveSubscription = checkActiveSubscription;
exports.permissionNeedsSubscription = permissionNeedsSubscription;

exports.requireActiveSubscription = async (req, res, next) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (user.roleId && user.roleId.name === 'super_admin') {
      return next();
    }

    const subscription = await Subscription.findOne({
      user_id: user._id,
      status: { $in: ['trial', 'active'] },
      deleted_at: null,
    }).populate('plan_id');

    if (!subscription) {
      return res.status(402).json({
        success: false,
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Active subscription required to access this feature',
      });
    }

    if (subscription.expires_at && new Date() > subscription.expires_at) {
      await Subscription.updateOne(
        { _id: subscription._id },
        { $set: { status: 'expired' } }
      );
      return res.status(402).json({
        success: false,
        code: 'SUBSCRIPTION_EXPIRED',
        message: 'Your subscription has expired. Please renew to continue.',
      });
    }

    if (subscription.status === 'trial' && subscription.trial_ends_at &&
      new Date() > subscription.trial_ends_at) {
      await Subscription.updateOne(
        { _id: subscription._id },
        { $set: { status: 'expired' } }
      );
      return res.status(402).json({
        success: false,
        code: 'TRIAL_EXPIRED',
        message: 'Your trial period has ended. Please subscribe to continue.',
      });
    }

    req.subscription = subscription;
    next();
  } catch (error) {
    console.error('Subscription middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking subscription status',
    });
  }
};