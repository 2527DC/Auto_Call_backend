'use strict';

const { db } = require('../models');
const AIModel = db.AIModel;

exports.createAIModel = async (req, res) => {
  try {
    const { name, display_name, provider, model_id, api_endpoint, api_version, description, is_default, status } = req.body;

    const existingModel = await AIModel.findOne({ name });
    if (existingModel) {
      return res.status(400).json({ success: false, message: 'AI Model with this name already exists' });
    }

    const aiModel = await AIModel.create({
      name,
      display_name,
      provider,
      model_id,
      api_endpoint,
      api_version,
      description,
      is_default,
      status,
      created_by: req.user.id
    });

    if (is_default) {
      await AIModel.updateMany({ _id: { $ne: aiModel._id } }, { is_default: false });
    }

    res.status(201).json({ success: true, message: 'AI Model created successfully', data: aiModel });
  } catch (error) {
    console.error('Create AI Model Error:', error);
    res.status(500).json({ success: false, message: 'Failed to create AI Model' });
  }
};

exports.getAIModels = async (req, res) => {
  try {
    const { status, provider } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (provider) filter.provider = provider;

    const models = await AIModel.find(filter).sort({ created_at: -1 });
    res.json({ success: true, data: models });
  } catch (error) {
    console.error('Get AI Models Error:', error);
    res.status(500).json({ success: false, message: 'Failed to get AI Models' });
  }
};

exports.getAIModel = async (req, res) => {
  try {
    const aiModel = await AIModel.findById(req.params.id);
    if (!aiModel) {
      return res.status(404).json({ success: false, message: 'AI Model not found' });
    }
    res.json({ success: true, data: aiModel });
  } catch (error) {
    console.error('Get AI Model Error:', error);
    res.status(500).json({ success: false, message: 'Failed to get AI Model' });
  }
};

exports.updateAIModel = async (req, res) => {
  try {
    const { is_default } = req.body;
    const aiModel = await AIModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    
    if (!aiModel) {
      return res.status(404).json({ success: false, message: 'AI Model not found' });
    }

    if (is_default) {
      await AIModel.updateMany({ _id: { $ne: aiModel._id } }, { is_default: false });
    }

    res.json({ success: true, message: 'AI Model updated successfully', data: aiModel });
  } catch (error) {
    console.error('Update AI Model Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update AI Model' });
  }
};

exports.deleteAIModel = async (req, res) => {
  try {
    const aiModel = await AIModel.findByIdAndDelete(req.params.id);
    if (!aiModel) {
      return res.status(404).json({ success: false, message: 'AI Model not found' });
    }
    res.json({ success: true, message: 'AI Model deleted successfully' });
  } catch (error) {
    console.error('Delete AI Model Error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete AI Model' });
  }
};
