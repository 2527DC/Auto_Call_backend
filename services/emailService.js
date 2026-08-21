const nodemailer = require('nodemailer');
const { db } = require('../models');
const sgMail = require('@sendgrid/mail');
const formData = require('form-data');
const Mailgun = require('mailgun.js');

class EmailService {
  async sendTemplateEmail({ userId, to, templateId, dynamicData, campaignId }) {
    try {
      const { UserSettings, EmailTemplate, EmailLog } = db;

      const settings = await UserSettings.findOne({ user: userId });
      if (!settings) throw new Error('User settings not found');

      const template = await EmailTemplate.findById(templateId);
      if (!template) throw new Error('Email template not found');

      const provider = settings.email_provider || 'nodemailer';
      const config = settings.email_config || {};
      const fromName = settings.email_from_name || 'Autocall';
      const fromEmail = settings.email_from_email || process.env.MAIL_FROM_ADDRESS;

      let subject = this.resolvePlaceholders(template.subject, dynamicData);
      let body = this.resolvePlaceholders(template.body, dynamicData);

      let result;
      switch (provider) {
        case 'nodemailer':
          result = await this.sendViaNodemailer(config, fromName, fromEmail, to, subject, body);
          break;
        case 'sendgrid':
          result = await this.sendViaSendGrid(config, fromName, fromEmail, to, subject, body);
          break;
        case 'mailgun':
          result = await this.sendViaMailgun(config, fromName, fromEmail, to, subject, body);
          break;
        default:
          throw new Error(`Unsupported email provider: ${provider}`);
      }

      if (result.success) {
        await EmailLog.create({
          user: userId,
          campaign: campaignId,
          to,
          status: 'sent',
          sentAt: new Date()
        });
      }

      return result;
    } catch (error) {
      console.error('Email Service Error:', error.message);
      return { success: false, message: error.message };
    }
  }

  resolvePlaceholders(text, data) {
    if (!text || !data) return text;
    return text.replace(/{{([\w.]+)}}/g, (match, key) => {
      return this.getNestedValue(data, key) || match;
    });
  }


  getNestedValue(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  }

  async sendViaNodemailer(config, fromName, fromEmail, to, subject, html) {
    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: config.smtp_port || 587,
      secure: config.mail_encryption === 'ssl',
      auth: {
        user: config.smtp_user,
        pass: config.smtp_pass
      },
      tls: { rejectUnauthorized: false }
    });

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      html
    });

    return { success: true, messageId: info.messageId };
  }

  async sendViaSendGrid(config, fromName, fromEmail, to, subject, html) {
    sgMail.setApiKey(config.sendgrid_api_key);

    const msg = {
      to,
      from: { email: fromEmail, name: fromName },
      subject,
      html
    };

    const response = await sgMail.send(msg);
    return { success: true, messageId: response[0]?.headers?.['x-message-id'] };
  }

  async sendViaMailgun(config, fromName, fromEmail, to, subject, html) {
    const mailgun = new Mailgun(formData);

    const mg = mailgun.client({
      username: 'api',
      key: config.mailgun_api_key
    });

    const response = await mg.messages.create(config.mailgun_domain, {
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject,
      html
    });

    return { success: true, messageId: response.id };
  }
}

module.exports = new EmailService();