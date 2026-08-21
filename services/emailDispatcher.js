const { db } = require('../models');
const Setting = db.Setting;
const SystemEmailTemplate = db.SystemEmailTemplate;
const emailEventsConfig = require('../config/email-events.json');
const { sendMail } = require('../utils/mail');

class EmailDispatcher {
  static async dispatch(to, slug, data = {}) {
    try {
      const dbTemplate = await SystemEmailTemplate.findOne({ slug });
      const eventConfig = emailEventsConfig[slug];

      if (!eventConfig) {
        return { success: false, message: 'Unknown event slug' };
      }
      
      if (dbTemplate && !dbTemplate.status) {
        return { success: false, message: 'Template inactive' };
      }

      const settings = await Setting.findOne().lean();

      const templateData = {
        app_name: settings?.app_name || 'My Application',
        ...data
      };

      let subject = dbTemplate?.subject || eventConfig.default_subject;
      let content = dbTemplate?.content || eventConfig.default_content;

      if (!subject || !content) {
        return { success: false, message: 'Missing subject or content for template' };
      }

      for (const [key, value] of Object.entries(templateData)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        subject = subject.replace(regex, value || '');
        content = content.replace(regex, value || '');
      }

      console.log(`[EmailDispatcher] Sending '${slug}' to ${to}`);
      const result = await sendMail(to, subject, content);
      return result;

    } catch (error) {
      console.error(`[EmailDispatcher] Error dispatching email '${slug}':`, error);
      return { success: false, message: error.message };
    }
  }
}

module.exports = EmailDispatcher;
