'use strict';

const { db } = require('../models');
const Flow = db.Flow;
const automationEngine = require('../utils/automationEngine');
const { checkFeatureLimit } = require('../utils/limitHelper');

exports.getFlows = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, status, page = 1, limit = 10 } = req.query;

    const query = {
      $or: [
        { user_id: userId },
        { system_flow: true }
      ],
      deleted_at: null
    };
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    if (status) {
      query.status = status;
    }

    const total = await Flow.countDocuments(query);
    const flows = await Flow.find(query)
      .sort({ created_at: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const flowsWithFlag = flows.map(f => {
      const flowObj = f.toObject ? f.toObject({ virtuals: true }) : f;
      return {
        ...flowObj,
        description: f.description || '',
        system_flow: f.system_flow === true || ['Default Appointment Booking', 'Event Registration Flow', 'Customer Feedback Survey'].includes(f.name)
      };
    });

    res.json({
      success: true,
      data: flowsWithFlag,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error('Get Flows Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.getFlowById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const flow = await Flow.findOne({
      _id: id,
      $or: [
        { user_id: userId },
        { system_flow: true }
      ],
      deleted_at: null
    });
    if (!flow) {
      return res.status(404).json({ success: false, message: 'Flow not found' });
    }

    const flowObj = flow.toObject ? flow.toObject({ virtuals: true }) : flow;
    const flowWithFlag = {
      ...flowObj,
      description: flow.description || '',
      system_flow: flow.system_flow === true
    };

    res.json({ success: true, data: flowWithFlag });
  } catch (error) {
    console.error('Get Flow By ID Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.createFlow = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const currentFlowsCount = await Flow.countDocuments({ user_id: userId, deleted_at: null, system_flow: { $ne: true } });
    await checkFeatureLimit(userId, 'Flow', 'flow_limit', currentFlowsCount);

    const flowData = {
      ...req.body,
      user_id: userId
    };

    const flow = await Flow.create(flowData);
    res.status(201).json({ success: true, message: 'Flow created successfully', data: flow });
  } catch (error) {
    console.error('Create Flow Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to create flow' });
  }
};

exports.updateFlow = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updateData = { ...req.body };

    const flow = await Flow.findOneAndUpdate(
      { _id: id, user_id: userId, deleted_at: null },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!flow) {
      return res.status(404).json({ success: false, message: 'Flow not found' });
    }

    res.json({ success: true, message: 'Flow updated successfully', data: flow });
  } catch (error) {
    console.error('Update Flow Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update flow' });
  }
};

exports.deleteFlow = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const flow = await Flow.findOneAndUpdate(
      { _id: id, user_id: userId, deleted_at: null },
      { $set: { deleted_at: new Date() } },
      { new: true }
    );

    if (!flow) {
      return res.status(404).json({ success: false, message: 'Flow not found' });
    }

    res.json({ success: true, message: 'Flow deleted successfully' });
  } catch (error) {
    console.error('Delete Flow Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.bulkDeleteFlows = async (req, res) => {
  try {
    const { ids } = req.body;
    const userId = req.user.id;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'IDs array is required' });
    }

    await Flow.updateMany(
      { _id: { $in: ids }, user_id: userId, deleted_at: null },
      { $set: { deleted_at: new Date() } }
    );

    res.json({ success: true, message: `${ids.length} flows deleted successfully` });
  } catch (error) {
    console.error('Bulk Delete Flows Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.testFlow = async (req, res) => {
  try {
    const { id } = req.body;
    const userId = req.user.id;
    const inputData = req.body.input || {};

    const flow = await Flow.findOne({ _id: id, user_id: userId, deleted_at: null });
    if (!flow) {
      return res.status(404).json({ success: false, message: 'Flow not found' });
    }

    const result = await automationEngine.executeFlowSync(flow, inputData);

    res.json({
      success: true,
      message: 'Flow test completed',
      data: result
    });
  } catch (error) {
    console.error('Test Flow Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Flow test failed' });
  }
};

exports.uploadAudio = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Audio file is required' });
    }

    const filePath = req.file.path.replace(/\\/g, '/');

    return res.status(200).json({
      success: true,
      message: 'Audio uploaded successfully',
      filePath: filePath
    });
  } catch (error) {
    console.error('Upload Audio Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};