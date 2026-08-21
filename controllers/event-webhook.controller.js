'use strict';

const { db } = require('../models');
const EventWebhook = db.EventWebhook;

exports.createWebhook = async (req, res) => {
  try {
    const { name, endpoint_url, events, is_active } = req.body;
    
    if (!name || !endpoint_url || !events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ success: false, message: 'Name, endpoint_url, and events array are required.' });
    }

    const newWebhook = await EventWebhook.create({
      user_id: req.user._id || req.user.id,
      name,
      endpoint_url,
      events,
      is_active: is_active !== undefined ? is_active : true
    });

    res.status(201).json({ success: true, message: 'Webhook created successfully.', data: newWebhook });
  } catch (error) {
    console.error('Error creating webhook:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getWebhooks = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const query = { user_id: req.user._id || req.user.id };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { endpoint_url: { $regex: search, $options: 'i' } }
      ];
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const webhooks = await EventWebhook.find(query)
      .sort(sortOptions)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await EventWebhook.countDocuments(query);

    res.status(200).json({ 
      success: true, 
      data: webhooks,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching webhooks:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getWebhookById = async (req, res) => {
  try {
    const webhook = await EventWebhook.findOne({ _id: req.params.id, user_id: req.user._id || req.user.id });
    if (!webhook) {
      return res.status(404).json({ success: false, message: 'Webhook not found' });
    }

    res.status(200).json({ success: true, data: webhook });
  } catch (error) {
    console.error('Error fetching webhook:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateWebhook = async (req, res) => {
  try {
    const { name, endpoint_url, events, is_active } = req.body;
    const webhook = await EventWebhook.findOne({ _id: req.params.id, user_id: req.user._id || req.user.id });

    if (!webhook) {
      return res.status(404).json({ success: false, message: 'Webhook not found' });
    }

    if (name) webhook.name = name;
    if (endpoint_url) webhook.endpoint_url = endpoint_url;
    if (events && Array.isArray(events) && events.length > 0) webhook.events = events;
    if (is_active !== undefined) webhook.is_active = is_active;

    await webhook.save();

    res.status(200).json({ success: true, message: 'Webhook updated successfully', data: webhook });
  } catch (error) {
    console.error('Error updating webhook:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteWebhook = async (req, res) => {
  try {
    const webhook = await EventWebhook.findOneAndDelete({ _id: req.params.id, user_id: req.user._id || req.user.id });
    if (!webhook) {
      return res.status(404).json({ success: false, message: 'Webhook not found' });
    }

    res.status(200).json({ success: true, message: 'Webhook deleted successfully' });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
