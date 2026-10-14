'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { db } = require('../models');
const EventWebhook = db.EventWebhook;

// A failed delivery (network error, timeout or a 5xx answer) is tried again
// after these waits; a 4xx answer means the receiver refused it, so no retry.
const RETRY_WAITS_MS = [5000, 30000];

// Signature the receiver can check: HMAC-SHA256 of "<timestamp>.<body>" with
// the webhook's secret, sent as X-Voxeno-Signature: t=<timestamp>,v1=<hex>.
const sign = (secret, timestamp, body) =>
  `t=${timestamp},v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

async function deliver(webhook, eventName, eventId, body, attempt = 0) {
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    await axios.post(webhook.endpoint_url, body, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Voxeno-Webhook/1.0',
        // The same id on every attempt, so the receiver can ignore repeats.
        'X-Voxeno-Event-Id': eventId,
        'X-Voxeno-Event': eventName,
        ...(webhook.secret ? { 'X-Voxeno-Signature': sign(webhook.secret, timestamp, body) } : {})
      },
      // The body is sent exactly as signed.
      transformRequest: [(data) => data]
    });
  } catch (error) {
    const status = error.response?.status;
    const retry = attempt < RETRY_WAITS_MS.length && !(status >= 400 && status < 500);
    console.error(`[WebhookDispatcher] Failed to send event "${eventName}" to ${webhook.endpoint_url} (attempt ${attempt + 1}${retry ? ', will retry' : ''}):`, error.message);
    if (retry) {
      setTimeout(() => deliver(webhook, eventName, eventId, body, attempt + 1), RETRY_WAITS_MS[attempt]).unref?.();
    }
  }
}

// options.transcript: added to the payload only for webhooks that opted in to transcripts.
const dispatchEvent = async (userId, eventName, payload, options = {}) => {
  try {
    if (!EventWebhook) {
      console.warn('[WebhookDispatcher] EventWebhook model is not loaded.');
      return;
    }

    const webhooks = await EventWebhook.find({
      user_id: userId,
      events: eventName,
      is_active: true
    });

    if (!webhooks || webhooks.length === 0) {
      return;
    }

    const eventId = `evt_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();

    await Promise.allSettled(
      webhooks.map(async (webhook) => {
        // Webhooks saved before signing existed get a secret on first use.
        if (!webhook.secret) {
          webhook.secret = EventWebhook.newSecret();
          await webhook.save().catch(() => {});
        }
        const data = options.transcript && webhook.include_transcript ? { ...payload, transcript: options.transcript } : payload;
        const body = JSON.stringify({ id: eventId, event: eventName, timestamp, data });
        await deliver(webhook, eventName, eventId, body);
      })
    );
  } catch (err) {
    console.error(`[WebhookDispatcher] Error dispatching event "${eventName}":`, err.message);
  }
};

module.exports = { dispatchEvent, sign };
