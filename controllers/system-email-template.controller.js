const { db } = require('../models');
const SystemEmailTemplate = db.SystemEmailTemplate;
const emailEvents = require('../config/email-events.json');

exports.getAllEvents = async (req, res) => {
  try {
    const dbTemplates = await SystemEmailTemplate.find().lean();

    const templates = Object.keys(emailEvents).map(slug => {
      const eventConfig = emailEvents[slug];
      const dbTemp = dbTemplates.find(t => t.slug === slug);

      return {
        ...eventConfig,
        id: dbTemp ? dbTemp._id : null,
        subject: dbTemp ? dbTemp.subject : (eventConfig.default_subject || ''),
        content: dbTemp ? dbTemp.content : (eventConfig.default_content || ''),
        status: dbTemp ? dbTemp.status : true,
        is_configured: !!dbTemp
      };
    });

    res.status(200).json({
      message: 'Email templates fetched successfully',
      templates
    });
  } catch (error) {
    console.error('Get all email events error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const { slug } = req.params;
    const { subject, content, status } = req.body;

    if (!emailEvents[slug]) {
      return res.status(404).json({ message: 'Invalid email template slug' });
    }

    if (!subject || !content) {
      return res.status(400).json({ message: 'Subject and content are required' });
    }

    const template = await SystemEmailTemplate.findOneAndUpdate(
      { slug },
      { slug, subject, content, status },
      { new: true, upsert: true, runValidators: true }
    );

    res.status(200).json({
      message: 'Email template updated successfully',
      template
    });
  } catch (error) {
    console.error('Update email template error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Subject and content are required' });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
};
