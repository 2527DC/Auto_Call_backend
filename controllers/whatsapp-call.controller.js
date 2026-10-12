const whatsappService = require('../services/whatsappService');

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

  // The same handler as /api/whatsapp/webhook, so this URL also receives
  // messages and delivery statuses when it is the one set in the Meta app.
  res.status(200).end();
  try {
    const trusted = await whatsappService.verifySignature(req);
    await whatsappService.handleWebhook(req.body, { trusted });
  } catch (error) {
    console.error('WhatsApp Call Webhook Error:', error.message);
  }
};
