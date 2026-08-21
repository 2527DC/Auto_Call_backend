const { db } = require('../models');
const { EmailTemplate } = db;
const emailService = require('../services/emailService');
const whatsappService = require('../services/whatsappService');

exports.getEmailTemplates = async (req, res) => {
  try {
    const templates = await EmailTemplate.find({ user_id: req.user._id, deleted_at: null });
    res.json({ success: true, data: templates });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.createEmailTemplate = async (req, res) => {
  try {
    const template = await EmailTemplate.create({
      ...req.body,
      user_id: req.user._id
    });
    res.json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.elevenLabsToolWebhook = async (req, res) => {
  try {
    const { tool_name, arguments: args, conversation_id } = req.body;

    const userId = req.query.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(400).json({ error: 'User context missing' });
    }

    if (tool_name === 'send_email') {
      const { to, template_name, dynamic_data } = args;

      const template = await EmailTemplate.findOne({
        user_id: userId,
        name: template_name,
        deleted_at: null
      });

      if (!template) {
        return res.status(404).json({ error: 'Email template not found' });
      }

      await emailService.sendTemplateEmail({
        userId,
        to,
        templateId: template._id,
        dynamicData: dynamic_data
      });

      return res.json({ success: true, message: 'Email queued' });
    }

    if (tool_name === 'send_whatsapp') {
      const { to, template_name, dynamic_data } = args;

      const { WhatsAppTemplate } = db;
      const template = await WhatsAppTemplate.findOne({
        user_id: userId,
        template_name: template_name.toLowerCase(),
        deleted_at: null
      });

      if (!template) {
        return res.status(404).json({ error: 'WhatsApp template not found' });
      }

      await whatsappService.sendTemplateMessage({
        userId,
        to,
        templateId: template._id,
        dynamicData: dynamic_data
      });

      return res.json({ success: true, message: 'WhatsApp message queued' });
    }

    res.status(400).json({ error: 'Unknown tool' });
  } catch (error) {
    console.error('ElevenLabs Tool Error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
