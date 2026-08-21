const cron = require('node-cron');
const { db } = require('../models');
const User = db.User;

const checkTopUpExpiry = async () => {
  console.log(`[CRON] Checking for expired top-up credits at ${new Date().toISOString()}`);
  try {
    const now = new Date();

    const usersWithExpiredTopUp = await User.find({ 
      top_up_expires_at: { $lt: now }, 
      top_up_credits: { $gt: 0 } 
    });

    if (!usersWithExpiredTopUp || usersWithExpiredTopUp.length === 0) {
      return;
    }

    for (const user of usersWithExpiredTopUp) {
      console.log(`[CRON] Expiring ${user.top_up_credits} credits for user ${user._id} (${user.email})`);

      const creditsToRemove = user.top_up_credits;

      user.total_credits = Math.max(0, user.total_credits - creditsToRemove);
      user.top_up_credits = 0;
      user.top_up_expires_at = null;

      await user.save();
    }

    console.log(`[CRON] Top-up expiry check completed. Processed ${usersWithExpiredTopUp.length} users.`);
  } catch (err) {
    console.error('[CRON] Error in top-up expiry check:', err.message);
  }
};

const initTopUpExpiryCron = () => {
  cron.schedule('0 * * * *', checkTopUpExpiry, { scheduled: true, timezone: 'UTC' });

  console.log('[CRON] Top-up expiry scheduler initialized.');
};

module.exports = { initTopUpExpiryCron, checkTopUpExpiry };
