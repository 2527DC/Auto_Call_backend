'use strict';

const { db } = require('../models');
const SMSAgent = db.SMSAgent;
const AIModel = db.AIModel;
const { checkFeatureLimit } = require('../utils/limitHelper');

exports.getSMSAgents = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, status, page = 1, limit = 10, sort_by = 'created_at', sort_order = 'DESC' } = req.query;

    const query = { user_id: userId };
    
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    if (status && status !== 'All') {
      query.status = status;
    }

    const sortOptions = {};
    const sortField = sort_by;
    const sortDirection = sort_order.toUpperCase() === 'ASC' ? 1 : -1;
    sortOptions[sortField] = sortDirection;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await SMSAgent.countDocuments(query);
    
    const agents = await SMSAgent.find(query)
      .populate('knowledge_base', 'name type')
      .populate('llm_model', 'name display_name model_id provider status')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const agentsWithAnalytics = agents.map((agent) => {
      const agentObj = agent.toObject();
      agentObj.analytics = {
        total_messages: 0,
        success_rate: 0
      };
      return agentObj;
    });

    res.json({
      success: true,
      data: agentsWithAnalytics,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error('Get SMS Agents Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.getSMSAgentById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const agent = await SMSAgent.findOne({ _id: id, user_id: userId })
      .populate('knowledge_base', 'name type')
      .populate('llm_model', 'name display_name model_id provider status');

    if (!agent) {
      return res.status(404).json({ success: false, message: 'SMS Agent not found' });
    }

    res.json({ success: true, data: agent });
  } catch (error) {
    console.error('Get SMS Agent By ID Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.createSMSAgent = async (req, res) => {
  try {
    const userId = req.user.id;

    const currentAgentsCount = await SMSAgent.countDocuments({ user_id: userId });
    await checkFeatureLimit(userId, 'SMSAgent', 'sms_agent_limit', currentAgentsCount);

    const agentData = { ...req.body, user_id: userId, type: 'SMS' };

    if (!agentData.name || agentData.name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    if(agentData.name){
      const agent = await SMSAgent.findOne({ user_id: userId, name: agentData.name });
      if (agent) {
        return res.status(400).json({ success: false, message: 'Agent name already exists' });
      }
    }

    if (agentData.knowledge_base && !Array.isArray(agentData.knowledge_base)) {
      agentData.knowledge_base = [agentData.knowledge_base];
    }

    if (agentData.transfer_to_human) {

      if (agentData.transfer_to_human.transfer_keywords && !Array.isArray(agentData.transfer_to_human.transfer_keywords)) {
        if (typeof agentData.transfer_to_human.transfer_keywords === 'string') {
          agentData.transfer_to_human.transfer_keywords = agentData.transfer_to_human.transfer_keywords
            .split(',').map(k => k.trim()).filter(k => k.length > 0);
        }
      }
    }

    if (agentData.llm_model) {
      const modelExists = await AIModel.findOne({ _id: agentData.llm_model, status: 'active' });
      if (!modelExists) {
        return res.status(400).json({ success: false, message: 'Invalid or inactive AI model selected.' });
      }
    }

    if (agentData.status && !['active', 'inactive'].includes(agentData.status)) {
       return res.status(400).json({ success: false, message: 'Status must be active or inactive' });
    }

    const agent = await SMSAgent.create(agentData);
    const populated = await agent.populate('llm_model', 'name display_name model_id provider status');
    
    res.status(201).json({ success: true, message: 'SMS Agent created successfully', data: populated });
  } catch (error) {
    console.error('Create SMS Agent Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to create SMS agent' });
  }
};

exports.updateSMSAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updateData = { ...req.body };

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: 'At least one field is required to update' });
    }

    if (updateData.name !== undefined && updateData.name.trim() === '') {
      return res.status(400).json({ success: false, message: 'Name cannot be empty' });
    }

    if(updateData.name){
      const agent = await SMSAgent.findOne({ user_id: userId, name: updateData.name, _id: { $ne: id } });
      if (agent) {
        return res.status(400).json({ success: false, message: 'Agent name already exists' });
      }
    }
    
    if (updateData.knowledge_base && !Array.isArray(updateData.knowledge_base)) {
      updateData.knowledge_base = [updateData.knowledge_base];
    }

    if (updateData.transfer_to_human) {

      if (updateData.transfer_to_human.transfer_keywords && !Array.isArray(updateData.transfer_to_human.transfer_keywords)) {
        if (typeof updateData.transfer_to_human.transfer_keywords === 'string') {
          updateData.transfer_to_human.transfer_keywords = updateData.transfer_to_human.transfer_keywords
            .split(',').map(k => k.trim()).filter(k => k.length > 0);
        }
      }
    }

    if (updateData.llm_model) {
      const modelExists = await AIModel.findOne({ _id: updateData.llm_model, status: 'active' });
      if (!modelExists) {
        return res.status(400).json({ success: false, message: 'Invalid or inactive AI model selected.' });
      }
    }

    if (updateData.status && !['active', 'inactive'].includes(updateData.status)) {
       return res.status(400).json({ success: false, message: 'Status must be active or inactive' });
    }

    const agent = await SMSAgent.findOneAndUpdate(
      { _id: id, user_id: userId },
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('llm_model', 'name display_name model_id provider status');

    if (!agent) {
      return res.status(404).json({ success: false, message: 'SMS Agent not found' });
    }

    res.json({ success: true, message: 'SMS Agent updated successfully', data: agent });
  } catch (error) {
    console.error('Update SMS Agent Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update SMS agent' });
  }
};

exports.deleteSMSAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const agent = await SMSAgent.findOneAndDelete({ _id: id, user_id: userId });
    if (!agent) {
      return res.status(404).json({ success: false, message: 'SMS Agent not found' });
    }

    res.json({ success: true, message: 'SMS Agent deleted successfully' });
  } catch (error) {
    console.error('Delete SMS Agent Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.bulkDeleteSMSAgents = async (req, res) => {
  try {
    const { ids } = req.body;
    const userId = req.user.id;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'IDs array is required' });
    }

    const result = await SMSAgent.deleteMany({ _id: { $in: ids }, user_id: userId });

    res.json({ success: true, message: `${result.deletedCount} SMS agents deleted successfully` });
  } catch (error) {
    console.error('Bulk Delete SMS Agents Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};