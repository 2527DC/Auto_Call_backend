const CookieConsentLog = require('../models/cookie.model');

exports.saveConsent = async (req, res) => {
  try {
    const { consent_id, consent_type, preferences } = req.body;

    if (!consent_id || !consent_type) {
      return res.status(400).json({ status: false, message: 'consent_id and consent_type are required' });
    }

    const ip_address = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || req.ip;
    const user_agent = req.headers['user-agent'];

    const finalPreferences = {
      essential: true,
      call_history: true,
      ai_personalization: preferences?.ai_personalization || false,
      analytics: preferences?.analytics || false
    };

    const newLog = new CookieConsentLog({
      consent_id,
      consent_type,
      preferences: finalPreferences,
      ip_address,
      user_agent
    });

    await newLog.save();

    res.status(200).json({ status: true, message: 'Cookie consent saved successfully' });
  } catch (error) {
    console.error('Error saving cookie consent:', error);
    res.status(500).json({ status: false, message: 'Internal server error' });
  }
};
