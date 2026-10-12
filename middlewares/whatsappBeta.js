'use strict';

const { db } = require('../models');
const { User } = db;

// The business account a request acts for: team members work in their owner's account.
const accountIdOf = (user) => (user.isTeamMember ? user.user_id : user._id);

// WhatsApp Inbox & Automation is in beta: admins always have it, clients only
// when an admin has switched it on for their account.
const requireWhatsappBeta = async (req, res, next) => {
  try {
    if (req.authType === 'api_key') {
      return res.status(403).json({ success: false, message: 'Not available with an API key' });
    }
    const roleName = req.user?.roleId?.name;
    if (roleName === 'super_admin' || roleName === 'admin') return next();

    const owner = await User.findById(accountIdOf(req.user)).select('beta_features').lean();
    if (!owner?.beta_features?.whatsapp) {
      return res.status(403).json({
        success: false,
        code: 'BETA_NOT_ENABLED',
        message: 'WhatsApp Inbox & Automation is in beta. Ask Voxeno support to switch it on for your account.',
      });
    }
    next();
  } catch (error) {
    console.error('WhatsApp beta check error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = { requireWhatsappBeta, accountIdOf };
