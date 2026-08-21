'use strict';

const axios = require('axios');
const { db } = require('../models');
const EventWebhook = db.EventWebhook;

const dispatchEvent = async (userId, eventName, payload) => {
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

    const payloadToSend = {
      event: eventName,
      timestamp: new Date().toISOString(),
      data: payload
    };

    Promise.allSettled(
      webhooks.map(async (webhook) => {
        try {
          await axios.post(webhook.endpoint_url, payloadToSend, {
            timeout: 5000,
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Autocall-Webhook/1.0'
            }
          });
        } catch (error) {
          console.error(`[WebhookDispatcher] Failed to send event "${eventName}" to ${webhook.endpoint_url}:`, error.message);
        }
      })
    );
  } catch (err) {
    console.error(`[WebhookDispatcher] Error dispatching event "${eventName}":`, err.message);
  }
};

module.exports = { dispatchEvent };