const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs').promises;
const { db } = require('../models');
const Setting = db.Setting;

const renderTemplate = async (templateName, data = {}) => {
  try {
    const templatePath = path.join(__dirname, 'views', 'emails', `${templateName}.ejs`);

    try {
      await fs.access(templatePath);
    } catch (error) {
      throw new Error(`Template not found: ${templatePath}`);
    }

    const html = await ejs.renderFile(templatePath, data);
    return html;
  } catch (error) {
    console.error('Error rendering template:', error);
    throw error;
  }
};

const sendTemplateMail = async (to, subject, templateName, templateData = {}) => {
  try {
    const html = await renderTemplate(templateName, templateData);

    return await sendMail(to, subject, html);
  } catch (error) {
    console.error('Error sending template mail:', error);
    return { success: false, message: error.message };
  }
};

const sendMail = async (to, subject, html) => {
  try {
    const settings = await Setting.findOne();
    if (!settings) throw new Error('SMTP settings not found.');

    if (settings.is_demo_mode) {
      console.log(`[DEMO MODE] Email would be sent to: ${to}`);
      console.log(`Subject: ${subject}`);
      return { success: true };
    }

    const isUsingSSL = settings.mail_encryption === 'ssl';

    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port: settings.smtp_port,
      secure: isUsingSSL,
      auth: {
        user: settings.smtp_user,
        pass: settings.smtp_pass,
      },
    });

    const fromName = settings.mail_from_name || settings.app_name || 'App';
    const fromEmail = settings.mail_from_email || settings.smtp_user || 'noreply@example.com';
    const from = `${fromName} <${fromEmail}>`;

    await transporter.sendMail({ from, to, subject, html });
    return { success: true };
  } catch (err) {
    console.error('Error sending mail:', err);
    return { success: false, message: err?.message || 'Unknown error', };
  }
};

module.exports = { sendMail, sendTemplateMail, renderTemplate };