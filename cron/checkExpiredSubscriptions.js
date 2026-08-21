'use strict';

const cron = require('node-cron');
const { db } = require('../models');
const Subscription = db.Subscription;

const checkExpiredSubscriptions = async () => {
  try {
    const now = new Date();

    const trialResult = await Subscription.updateMany(
      {
        status: 'trial',
        trial_ends_at: { $lte: now },
        deleted_at: null,
      },
      { $set: { status: 'expired' } }
    );

    const subscriptionResult = await Subscription.updateMany(
      {
        status: 'active',
        expires_at: { $lte: now },
        auto_renew: false,
        deleted_at: null,
      },
      { $set: { status: 'expired' } }
    );

    const totalExpired = trialResult.modifiedCount + subscriptionResult.modifiedCount;
    
    if (totalExpired > 0) {
      console.log(`[CRON] Expired ${trialResult.modifiedCount} trials and ${subscriptionResult.modifiedCount} subscriptions at ${now.toISOString()}`);
    }
  } catch (error) {
    console.error('[CRON] Error checking expired subscriptions:', error);
  }
};

cron.schedule('0 0 * * *', checkExpiredSubscriptions, {
  scheduled: true,
  timezone: 'UTC',
});

console.log('[CRON] Subscription expiry checker scheduled (daily at midnight UTC)');

module.exports = checkExpiredSubscriptions;
