const whatsappCallAutomationService = require('../services/whatsappCallAutomationService');

exports.webhook = async (req, res) => {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === (process.env.WHATSAPP_VERIFY_TOKEN)) {
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  try {
    const payload = req.body;
    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (value?.calls) {
      const phoneNumberId = value.metadata?.phone_number_id;
      for (const callObj of value.calls) {
        await whatsappCallAutomationService.handleCallWebhook(callObj, phoneNumberId);
      }
    }

    res.status(200).end();
  } catch (error) {
    console.error('WhatsApp Call Webhook Error:', error.message);
    res.status(500).end();
  }
};
