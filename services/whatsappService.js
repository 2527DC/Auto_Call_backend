const axios = require('axios');
const crypto = require('crypto');
const { db } = require('../models');
const creditService = require('./creditService');
const { WhatsappWaba, WhatsAppTemplate, WhatsAppLog, WhatsappPhoneNumber, UserSettings } = db;

const API_VERSION = 'v21.0';

class WhatsAppService {
  async sendTemplateMessage({ userId, to, templateId, dynamicData, callId, campaignId }) {
    if ((await creditService.getMessageCredits('credits_per_whatsapp_message')) > 0 && !(await creditService.hasCredits(userId))) {
      throw new Error('Insufficient credits to send WhatsApp message');
    }
    try {
      const template = await WhatsAppTemplate.findById(templateId).populate('waba_id');
      if (!template) throw new Error('Template not found');

      const waba = template.waba_id;
      const phoneNumber = await WhatsappPhoneNumber.findOne({ waba_id: waba._id });
      if (!phoneNumber) throw new Error('No phone number associated with WABA');

      const components = this.buildMessageComponents(template, dynamicData);

      const url = `https://graph.facebook.com/${API_VERSION}/${phoneNumber.whatsapp_phone_number_id}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        to: to.replace('+', ''),
        type: 'template',
        template: {
          name: template.template_name,
          language: { code: template.language },
          components
        }
      };

      const response = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${waba.access_token}` }
      });

      const messageId = response.data.messages[0].id;

      await WhatsAppLog.create({
        user_id: userId,
        waba_id: waba._id,
        template_id: template._id,
        to_number: to,
        message_sid: messageId,
        status: 'sent',
        call_id: callId,
        campaign_id: campaignId
      });

      await creditService.chargeMessage(userId, 'credits_per_whatsapp_message', 'whatsapp_deduction', `WhatsApp template to ${to}`, campaignId || callId || null, campaignId ? 'campaign' : 'call')
        .catch((e) => console.error('[WhatsApp] Credit charge failed:', e.message));

      return { success: true, messageId };
    } catch (error) {
      console.error('WhatsApp send error:', error.response?.data || error.message);
      throw error;
    }
  }

  buildMessageComponents(template, data) {
    const components = [];

    if (template.body_variables && template.body_variables.length > 0) {
      const parameters = template.body_variables.map((v, index) => {
        const mapping = template.parameter_mapping?.get((index + 1).toString());
        let value = this.resolveValue(mapping, data) || v.example || 'N/A';
        return { type: 'text', text: String(value) };
      });

      components.push({ type: 'body', parameters });
    }

    if (template.header && template.header.format === 'media') {
      components.push({
        type: 'header',
        parameters: [
          {
            type: template.header.media_type,
            [template.header.media_type]: {
              link: template.header.media_url
            }
          }
        ]
      });
    }

    if (template.buttons) {
      template.buttons.forEach((btn, index) => {
        if ((btn.type === 'url' || btn.type === 'website') && btn.url.includes('{{')) {
          const mapping = template.parameter_mapping?.get(`btn_${index}`);
          let value = this.resolveValue(mapping, data) || 'N/A';

          components.push({
            type: 'button',
            sub_type: 'url',
            index: String(index),
            parameters: [{ type: 'text', text: String(value) }]
          });
        }
      });
    }

    return components;
  }

  /**
   * Resolve a dot-notation mapping (e.g. "contact.first_name") against a data object
   */
  resolveValue(mapping, data) {
    if (!mapping || !data) return null;
    return mapping.split('.').reduce((obj, key) => (obj && obj[key] !== 'undefined') ? obj[key] : null, data);
  }

  /**
   * Sync templates from Meta for a user
   */
  async syncTemplatesFromMeta(userId) {
    const wabas = await WhatsappWaba.find({ user_id: userId, deleted_at: null });
    let totalSynced = 0;

    for (const waba of wabas) {
      try {
        const url = `https://graph.facebook.com/${API_VERSION}/${waba.whatsapp_business_account_id}/message_templates`;
        const response = await axios.get(url, {
          headers: { Authorization: `Bearer ${waba.access_token}` }
        });

        const metaTemplates = response.data.data;
        for (const mt of metaTemplates) {
          const bodyComp = mt.components.find(c => c.type === 'BODY');
          const headerComp = mt.components.find(c => c.type === 'HEADER');
          const footerComp = mt.components.find(c => c.type === 'FOOTER');
          const buttonComp = mt.components.find(c => c.type === 'BUTTONS');

          const updateData = {
            status: mt.status.toLowerCase(),
            category: mt.category,
            language: mt.language,
            message_body: bodyComp?.text,
            footer_text: footerComp?.text,
            meta_template_id: mt.id
          };

          if (headerComp) {
            updateData.header = {
              format: headerComp.format.toLowerCase() === 'text' ? 'text' : 'media',
              text: headerComp.text,
              media_type: headerComp.format.toLowerCase() !== 'text' ? headerComp.format.toLowerCase() : undefined
            };
          }

          if (buttonComp) {
            updateData.buttons = buttonComp.buttons.map(btn => ({
              type: btn.type.toLowerCase(),
              text: btn.text,
              url: btn.url,
              phone_number: btn.phone_number
            }));
          }

          await WhatsAppTemplate.findOneAndUpdate(
            { waba_id: waba._id, template_name: mt.name },
            { $set: updateData },
            { upsert: true, new: true }
          );
          totalSynced++;
        }
      } catch (err) {
        console.error(`Failed to sync templates for WABA ${waba.whatsapp_business_account_id}:`, err.message);
      }
    }
    return totalSynced;
  }

  /**
   * Checks Meta's X-Hub-Signature-256 against the app secrets of the numbers in
   * the payload (and META_APP_SECRET). Returns true when no secret is set to check against.
   */
  async verifySignature(req) {
    const phoneIds = new Set();
    for (const entry of req.body?.entry || []) {
      for (const change of entry.changes || []) {
        if (change.value?.metadata?.phone_number_id) phoneIds.add(change.value.metadata.phone_number_id);
      }
    }
    const phones = await WhatsappPhoneNumber.find({ whatsapp_phone_number_id: { $in: [...phoneIds] } }).select('user_id').lean();
    const settings = await UserSettings.find({ user: { $in: phones.map((p) => p.user_id) }, whatsapp_app_secret: { $nin: [null, ''] } })
      .select('whatsapp_app_secret')
      .lean();
    const secrets = [process.env.META_APP_SECRET, ...settings.map((s) => s.whatsapp_app_secret)].filter(Boolean);
    if (!secrets.length) return true;

    const signature = req.get('x-hub-signature-256') || '';
    if (!signature || !req.rawBody) return false;
    return secrets.some((secret) => {
      const expected = `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
      return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    });
  }

  /**
   * Handle webhook events: delivery statuses, customer messages (WhatsApp inbox
   * beta) and calls. Meta sends all of them to the one callback URL of the app.
   * Messages are only handled when the signature checked out.
   */
  async handleWebhook(payload, { trusted = true } = {}) {
    const inbox = require('./whatsapp/inbox');
    const flowEngine = require('./whatsapp/flowEngine');
    const whatsappCallAutomationService = require('./whatsappCallAutomationService');

    for (const entry of payload?.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};

        for (const statusObj of value.statuses || []) {
          await WhatsAppLog.findOneAndUpdate(
            { message_sid: statusObj.id },
            { $set: { status: statusObj.status } }
          );
          await inbox.applyStatus(statusObj).catch((e) => console.error('[WhatsApp] Status update failed:', e.message));
        }

        if (value.messages?.length && !trusted) {
          console.warn(`[WhatsApp] Webhook signature check failed for number ${value.metadata?.phone_number_id}; incoming messages ignored. Check the Meta App Secret in Settings.`);
        } else {
          for (const msg of value.messages || []) {
            try {
              const result = await inbox.ingestInbound(value, msg);
              if (result) flowEngine.handleInbound(result);
            } catch (e) {
              console.error('[WhatsApp] Incoming message failed:', e);
            }
          }
        }

        for (const callObj of value.calls || []) {
          await whatsappCallAutomationService.handleCallWebhook(callObj, value.metadata?.phone_number_id);
        }
      }
    }
  }
}

module.exports = new WhatsAppService();
