const axios = require('axios');
const { db } = require('../models');
const { WhatsappWaba, WhatsAppTemplate, WhatsAppLog, WhatsappPhoneNumber } = db;

const API_VERSION = 'v21.0';

class WhatsAppService {
  async sendTemplateMessage({ userId, to, templateId, dynamicData, callId, campaignId }) {
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
   * Handle Webhook events (Status Updates)
   */
  async handleWebhook(payload) {
    const entry = payload.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (value?.statuses) {
      for (const statusObj of value.statuses) {
        const { id, status, timestamp, recipient_id } = statusObj;
        await WhatsAppLog.findOneAndUpdate(
          { message_sid: id },
          { $set: { status: status } }
        );
      }
    }
  }
}

module.exports = new WhatsAppService();
