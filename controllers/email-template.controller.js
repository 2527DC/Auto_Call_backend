'use strict';

const { db } = require('../models');
const EmailTemplate = db.EmailTemplate;

exports.getEmailTemplates = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, type, page = 1, limit = 10 } = req.query;

    const query = {
      user_id: userId,
      deleted_at: null
    };

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    if (type) {
      query.type = type;
    }

    const total = await EmailTemplate.countDocuments(query);
    const templates = await EmailTemplate.find(query)
      .sort({ created_at: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: templates,
      total,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('Get Email Templates Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.getEmailTemplateById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const template = await EmailTemplate.findOne({
      _id: id,
      user_id: userId,
      deleted_at: null
    });

    if (!template) {
      return res.status(404).json({ success: false, message: 'Email template not found' });
    }

    res.json({ success: true, data: template });
  } catch (error) {
    console.error('Get Email Template By ID Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.createEmailTemplate = async (req, res) => {
  try {
    const userId = req.user.id;
    const templateData = {
      ...req.body,
      user_id: userId
    };

    const template = await EmailTemplate.create(templateData);
    res.status(201).json({ success: true, message: 'Email template created successfully', data: template });
  } catch (error) {
    console.error('Create Email Template Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to create email template' });
  }
};

exports.updateEmailTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updateData = { ...req.body };

    const template = await EmailTemplate.findOneAndUpdate(
      { _id: id, user_id: userId, deleted_at: null },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!template) {
      return res.status(404).json({ success: false, message: 'Email template not found' });
    }

    res.json({ success: true, message: 'Email template updated successfully', data: template });
  } catch (error) {
    console.error('Update Email Template Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update email template' });
  }
};

exports.bulkDeleteEmailTemplates = async (req, res) => {
  try {
    const { ids } = req.body;
    const userId = req.user.id;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'IDs array is required' });
    }

    await EmailTemplate.updateMany(
      { _id: { $in: ids }, user_id: userId, deleted_at: null },
      { $set: { deleted_at: new Date() } }
    );

    res.json({ success: true, message: `${ids.length} email templates deleted successfully` });
  } catch (error) {
    console.error('Bulk Delete Email Templates Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
