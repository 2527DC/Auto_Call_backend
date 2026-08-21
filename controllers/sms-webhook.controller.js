const smsAutomationService = require('../services/smsAutomationService');

exports.twilioWebhook = async (req, res) => {
  try {
    const fromNumber = req.body.From;
    const toNumber = req.body.To;
    const messageBody = req.body.Body;
    const messageSid = req.body.MessageSid;

    if (!fromNumber || !toNumber || !messageBody) {
      console.warn('[SMS Webhook] Invalid payload received from Twilio');
      return res.status(400).send('Invalid payload');
    }

    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');

    smsAutomationService.handleIncomingMessage(fromNumber, toNumber, messageBody)
      .catch(err => console.error('[SMS Webhook Async] Error processing message:', err));

  } catch (error) {
    console.error('[SMS Webhook] Error:', error);
    res.status(500).send('Internal Server Error');
  }
};

exports.plivoWebhook = async (req, res) => {
  try {
    const fromNumber = req.body.From;
    const toNumber = req.body.To;
    const messageBody = req.body.Text;
    const messageUuid = req.body.MessageUUID;

    if (!fromNumber || !toNumber || !messageBody) {
      console.warn('[SMS Webhook] Invalid payload received from Plivo');
      return res.status(400).send('Invalid payload');
    }

    res.set('Content-Type', 'text/xml');
    res.send('<Response></Response>');

    smsAutomationService.handleIncomingMessage(fromNumber, toNumber, messageBody)
      .catch(err => console.error('[SMS Webhook Async] Error processing Plivo message:', err));

  } catch (error) {
    console.error('[SMS Webhook] Plivo Error:', error);
    res.status(500).send('Internal Server Error');
  }
};
