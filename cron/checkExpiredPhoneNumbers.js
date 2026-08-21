'use strict';

const cron = require('node-cron');
const { db } = require('../models');
const PhoneNumber = db.PhoneNumber;
const Campaign = db.Campaign;

const checkExpiredPhoneNumbers = async () => {
  try {
    const now = new Date();

    const expiredNumbers = await PhoneNumber.find({ user_id: { $ne: null }, expires_at: { $lte: now } });

    if (expiredNumbers.length === 0) {
      return;
    }

    const expiredNumberIds = expiredNumbers.map(n => n._id);

    const revokeResult = await PhoneNumber.updateMany(
      { _id: { $in: expiredNumberIds } },
      { $set: { user_id: null, is_system_pool: true, expires_at: null, agent_id: null } }
    );

    const affectedCampaigns = await Campaign.updateMany(
      {
        phoneNumberId: { $in: expiredNumberIds },
        campaignStatus: { $in: ['Draft', 'Active', 'Paused'] }
      },
      {
        $set: {
          campaignStatus: 'Failed',
          fail_reason: 'Phone number validity expired'
        }
      }
    );

    console.log(`[CRON] Reclaimed ${revokeResult.modifiedCount} expired phone numbers and failed ${affectedCampaigns.modifiedCount} campaigns at ${now.toISOString()}`);

  } catch (error) {
    console.error('[CRON] Error checking expired phone numbers:', error);
  }
};

cron.schedule('0 * * * *', checkExpiredPhoneNumbers, {
  scheduled: true,
  timezone: 'UTC',
});

console.log('[CRON] Phone number expiry checker scheduled (hourly)');

module.exports = checkExpiredPhoneNumbers;
