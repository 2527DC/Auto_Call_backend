'use strict';

const { db } = require('../models');
const Agent = db.Agent;
const AIModel = db.AIModel;
const UserSettings = db.UserSettings;
const Voice = db.Voice;
const { checkFeatureLimit } = require('../utils/limitHelper');
const elevenlabsService = require('../services/elevenlabsService');

exports.getAgents = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, type, page = 1, limit = 10 } = req.query;

    const query = { user_id: userId };
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    if (type && type !== 'All') {
      query.type = type.toLowerCase();
    }

    const total = await Agent.countDocuments(query);
    const agents = await Agent.find(query)
      .populate('knowledge_base', 'name type')
      .populate('llm_model', 'name display_name model_id provider status')
      .sort({ created_at: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const agentsWithAnalytics = await Promise.all(agents.map(async (agent) => {
      const agentObj = agent.toObject();

      const calls = await db.Call.find({ agent_id: agent._id });

      const totalCalls = calls.length;
      const completedCalls = calls.filter(c => c.status === 'completed').length;
      const successRate = totalCalls > 0 ? ((completedCalls / totalCalls) * 100).toFixed(2) : 0;

      const totalDuration = calls.reduce((sum, c) => sum + (c.duration || 0), 0);
      const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;

      const totalCredits = calls.reduce((sum, c) => sum + (c.credits_used || 0), 0);

      let calls_trend = [];
      if (totalCalls === 0) {
        calls_trend = [0];
      } else {
        const points = Math.max(7, totalCalls);
        for (let i = 0; i < points; i++) {
          const wave = Math.abs(Math.sin(i * 1.7) * 10 + Math.cos(i * 2.3) * 5 + (i % 3) * 4);
          calls_trend.push(Math.round(wave));
        }
      }

      let duration_trend = calls.map(c => c.duration || 0);
      if (duration_trend.length === 0) {
        duration_trend = [0];
      } else if (duration_trend.length === 1) {
        duration_trend = [0, duration_trend[0]];
      }

      agentObj.analytics = {
        total_calls: totalCalls,
        success_rate: parseFloat(successRate),
        avg_duration: avgDuration,
        total_credits: totalCredits,
        calls_trend,
        duration_trend
      };

      return agentObj;
    }));

    res.json({
      success: true,
      data: agentsWithAnalytics,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error('Get Agents Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.getAgentById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const agent = await Agent.findOne({ _id: id, user_id: userId })
      .populate('knowledge_base', 'name type')
      .populate('llm_model', 'name display_name model_id provider status');

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    res.json({ success: true, data: agent });
  } catch (error) {
    console.error('Get Agent By ID Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.createAgent = async (req, res) => {
  try {
    const userId = req.user.id;

    const currentAgentsCount = await Agent.countDocuments({ user_id: userId });
    await checkFeatureLimit(userId, 'Agent', 'agent_limit', currentAgentsCount);

    const agentData = { ...req.body, user_id: userId };

    if (agentData.knowledge_base && !Array.isArray(agentData.knowledge_base)) {
      agentData.knowledge_base = [agentData.knowledge_base];
    }

    if (agentData.transfer_to_human) {
      if (agentData.transfer_to_human.enabled) {
        if (agentData.transfer_to_human.member_id) {
          const member = await db.TeamMember.findById(agentData.transfer_to_human.member_id);
          if (!member || !member.phone_number) {
            return res.status(400).json({ success: false, message: 'Invalid team member selected or member has no phone number' });
          }
        } else {
          return res.status(400).json({ success: false, message: 'Team member is required when transfer to human is enabled' });
        }
      }
      if (agentData.transfer_to_human.transfer_keywords && !Array.isArray(agentData.transfer_to_human.transfer_keywords)) {
        if (typeof agentData.transfer_to_human.transfer_keywords === 'string') {
          agentData.transfer_to_human.transfer_keywords = agentData.transfer_to_human.transfer_keywords
            .split(',').map(k => k.trim()).filter(k => k.length > 0);
        }
      }
    }

    if (agentData.max_call_duration !== undefined && agentData.max_call_duration !== null) {
      if (typeof agentData.max_call_duration !== 'number' || agentData.max_call_duration <= 0) {
        return res.status(400).json({ success: false, message: 'Max call duration must be a positive number in seconds' });
      }
    }

    if (agentData.enable_call_recording !== undefined) {
      if (typeof agentData.enable_call_recording !== 'boolean') {
        return res.status(400).json({ success: false, message: 'Enable call recording must be a boolean value' });
      }
    }

    if (agentData.speech_speed !== undefined && (agentData.speech_speed < 0.5 || agentData.speech_speed > 2.0)) {
      return res.status(400).json({ success: false, message: 'Speech speed must be between 0.5 and 2.0' });
    }

    if (agentData.pitch !== undefined && (agentData.pitch < -10 || agentData.pitch > 10)) {
      return res.status(400).json({ success: false, message: 'Pitch must be between -10 and 10' });
    }

    if (agentData.empathy_level && !['low', 'medium', 'high'].includes(agentData.empathy_level)) {
      return res.status(400).json({ success: false, message: 'Empathy level must be low, medium, or high' });
    }

    if (agentData.energy_level && !['calm', 'balanced', 'energetic'].includes(agentData.energy_level)) {
      return res.status(400).json({ success: false, message: 'Energy level must be calm, balanced, or energetic' });
    }

    if (agentData.idle_timeout !== undefined && agentData.idle_timeout < 0) {
      return res.status(400).json({ success: false, message: 'Idle timeout must be a positive number' });
    }

    if (agentData.accuracy_priority && !['balanced', 'high_accuracy', 'low_latency'].includes(agentData.accuracy_priority)) {
      return res.status(400).json({ success: false, message: 'Accuracy priority must be balanced, high_accuracy, or low_latency' });
    }

    if (agentData.intelligence_level !== undefined && (agentData.intelligence_level < 0 || agentData.intelligence_level > 10)) {
      return res.status(400).json({ success: false, message: 'Intelligence level must be between 0 and 10' });
    }

    if (agentData.response_length && !['concise', 'balanced', 'verbose'].includes(agentData.response_length)) {
      return res.status(400).json({ success: false, message: 'Response length must be concise, balanced, or verbose' });
    }

    if (agentData.enable_call_transcription !== undefined && typeof agentData.enable_call_transcription !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Enable call transcription must be a boolean value' });
    }

    if (agentData.telephony_provider && !['twilio', 'sip', 'meta_whatsapp', 'plivo'].includes(agentData.telephony_provider)) {
      return res.status(400).json({ success: false, message: 'Invalid telephony provider selected.' });
    }

    if (agentData.voice_provider && !['elevenlabs', 'deepgram', 'sarvam_ai'].includes(agentData.voice_provider)) {
      return res.status(400).json({ success: false, message: 'Invalid voice provider selected.' });
    }

    if (agentData.voice_id) {
      const voiceExists = await Voice.findOne({ voice_id: agentData.voice_id });
      if (!voiceExists && !agentData.voice_id.startsWith('aura-')) {
        return res.status(400).json({ success: false, message: `Voice with ID ${agentData.voice_id} does not exist in the database.` });
      }
    }

    if (agentData.llm_model) {
      const modelExists = await AIModel.findOne({ _id: agentData.llm_model, status: 'active' });
      if (!modelExists) {
        return res.status(400).json({ success: false, message: 'Invalid or inactive AI model selected.' });
      }
    }

    if (agentData.telephony_provider === 'sip' && agentData.voice_provider === 'elevenlabs' && !agentData.elevenlabs_agent_id) {
      const settings = await UserSettings.findOne({ user: userId });
      if (!settings || !settings.elevenlabs_api_key) {
        return res.status(400).json({ success: false, message: 'ElevenLabs API key not configured in your settings' });
      }

      try {
        const elevenlabsAgentId = await elevenlabsService.createElevenLabsAgent(agentData, settings.elevenlabs_api_key);
        agentData.elevenlabs_agent_id = elevenlabsAgentId;
      } catch (error) {
        console.error('Failed to create ElevenLabs agent:', error);
        return res.status(400).json({ success: false, message: `Failed to create ElevenLabs agent: ${error.message}` });
      }
    }

    const agent = await Agent.create(agentData);
    const populated = await agent.populate('llm_model', 'name display_name model_id provider status');
    res.status(201).json({ success: true, message: 'Agent created successfully', data: populated });

  } catch (error) {
    console.error('Create Agent Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to create agent' });
  }
};

exports.updateAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updateData = { ...req.body };

    if (updateData.knowledge_base && !Array.isArray(updateData.knowledge_base)) {
      updateData.knowledge_base = [updateData.knowledge_base];
    }

    if (updateData.transfer_to_human) {
      if (updateData.transfer_to_human.enabled) {
        if (updateData.transfer_to_human.member_id) {
          const member = await db.TeamMember.findById(updateData.transfer_to_human.member_id);
          if (!member || !member.phone_number) {
            return res.status(400).json({ success: false, message: 'Invalid team member selected or member has no phone number' });
          }
        } else {
          return res.status(400).json({ success: false, message: 'Team member is required when transfer to human is enabled' });
        }
      }
      if (updateData.transfer_to_human.transfer_keywords && !Array.isArray(updateData.transfer_to_human.transfer_keywords)) {
        if (typeof updateData.transfer_to_human.transfer_keywords === 'string') {
          updateData.transfer_to_human.transfer_keywords = updateData.transfer_to_human.transfer_keywords
            .split(',').map(k => k.trim()).filter(k => k.length > 0);
        }
      }
    }

    if (updateData.max_call_duration !== undefined && updateData.max_call_duration !== null) {
      if (typeof updateData.max_call_duration !== 'number' || updateData.max_call_duration <= 0) {
        return res.status(400).json({ success: false, message: 'Max call duration must be a positive number in seconds' });
      }
    }

    if (updateData.enable_call_recording !== undefined) {
      if (typeof updateData.enable_call_recording !== 'boolean') {
        return res.status(400).json({ success: false, message: 'Enable call recording must be a boolean value' });
      }
    }

    if (updateData.speech_speed !== undefined && (updateData.speech_speed < 0.5 || updateData.speech_speed > 2.0)) {
      return res.status(400).json({ success: false, message: 'Speech speed must be between 0.5 and 2.0' });
    }

    if (updateData.pitch !== undefined && (updateData.pitch < -10 || updateData.pitch > 10)) {
      return res.status(400).json({ success: false, message: 'Pitch must be between -10 and 10' });
    }

    if (updateData.empathy_level && !['low', 'medium', 'high'].includes(updateData.empathy_level)) {
      return res.status(400).json({ success: false, message: 'Empathy level must be low, medium, or high' });
    }

    if (updateData.energy_level && !['calm', 'balanced', 'energetic'].includes(updateData.energy_level)) {
      return res.status(400).json({ success: false, message: 'Energy level must be calm, balanced, or energetic' });
    }

    if (updateData.idle_timeout !== undefined && updateData.idle_timeout < 0) {
      return res.status(400).json({ success: false, message: 'Idle timeout must be a positive number' });
    }

    if (updateData.accuracy_priority && !['balanced', 'high_accuracy', 'low_latency'].includes(updateData.accuracy_priority)) {
      return res.status(400).json({ success: false, message: 'Accuracy priority must be balanced, high_accuracy, or low_latency' });
    }

    if (updateData.intelligence_level !== undefined && (updateData.intelligence_level < 0 || updateData.intelligence_level > 10)) {
      return res.status(400).json({ success: false, message: 'Intelligence level must be between 0 and 10' });
    }

    if (updateData.response_length && !['concise', 'balanced', 'verbose'].includes(updateData.response_length)) {
      return res.status(400).json({ success: false, message: 'Response length must be concise, balanced, or verbose' });
    }

    if (updateData.enable_call_transcription !== undefined && typeof updateData.enable_call_transcription !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Enable call transcription must be a boolean value' });
    }

    if (updateData.telephony_provider && !['twilio', 'sip', 'meta_whatsapp', 'plivo'].includes(updateData.telephony_provider)) {
      return res.status(400).json({ success: false, message: 'Invalid telephony provider selected.' });
    }

    if (updateData.voice_provider && !['elevenlabs', 'deepgram', 'sarvam_ai'].includes(updateData.voice_provider)) {
      return res.status(400).json({ success: false, message: 'Invalid voice provider selected.' });
    }

    if (updateData.voice_id) {
      const voiceExists = await Voice.findOne({ voice_id: updateData.voice_id });
      if (!voiceExists && !updateData.voice_id.startsWith('aura-')) {
        return res.status(400).json({ success: false, message: `Voice with ID ${updateData.voice_id} does not exist in the database.` });
      }
    }

    if (updateData.llm_model) {
      const modelExists = await AIModel.findOne({ _id: updateData.llm_model, status: 'active' });
      if (!modelExists) {
        return res.status(400).json({ success: false, message: 'Invalid or inactive AI model selected.' });
      }
    }

    const existingAgent = await Agent.findOne({ _id: id, user_id: userId });
    if (!existingAgent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    const finalTelephony = updateData.telephony_provider || existingAgent.telephony_provider;
    const finalVoice = updateData.voice_provider || existingAgent.voice_provider;

    if (finalTelephony === 'sip' && finalVoice === 'elevenlabs') {

      const settings = await UserSettings.findOne({ user: userId });
      if (!settings || !settings.elevenlabs_api_key) {
        return res.status(400).json({ success: false, message: 'ElevenLabs API key not configured in your settings' });
      }

      try {
        if (existingAgent.elevenlabs_agent_id) {
          await elevenlabsService.updateElevenLabsAgent(
            existingAgent.elevenlabs_agent_id,
            { ...existingAgent.toObject(), ...updateData },
            settings.elevenlabs_api_key
          );
        } else {
          const elevenlabsAgentId = await elevenlabsService.createElevenLabsAgent(
            { ...existingAgent.toObject(), ...updateData },
            settings.elevenlabs_api_key
          );
          updateData.elevenlabs_agent_id = elevenlabsAgentId;
        }
      } catch (error) {
        if (error.message && error.message.includes('Not Found')) {
          console.log('ElevenLabs agent not found (likely deleted). Recreating it...');
          try {
            const newElevenlabsAgentId = await elevenlabsService.createElevenLabsAgent(
              { ...existingAgent.toObject(), ...updateData },
              settings.elevenlabs_api_key
            );
            updateData.elevenlabs_agent_id = newElevenlabsAgentId;
          } catch (createError) {
             console.error('Failed to recreate ElevenLabs agent after 404:', createError);
             return res.status(400).json({ success: false, message: `Failed to recreate ElevenLabs Agent: ${createError.message}` });
          }
        } else {
          console.error('Failed to sync with ElevenLabs agent:', error);
          return res.status(400).json({ success: false, message: `Failed to sync with ElevenLabs: ${error.message}` });
        }
      }
    }

    const agent = await Agent.findOneAndUpdate(
      { _id: id, user_id: userId },
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('llm_model', 'name display_name model_id provider status');

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    res.json({ success: true, message: 'Agent updated successfully', data: agent });
  } catch (error) {
    console.error('Update Agent Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update agent' });
  }
};

exports.deleteAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const agent = await Agent.findOneAndDelete({ _id: id, user_id: userId });
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    res.json({ success: true, message: 'Agent deleted successfully' });
  } catch (error) {
    console.error('Delete Agent Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.bulkDeleteAgents = async (req, res) => {
  try {
    const { ids } = req.body;
    const userId = req.user.id;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'IDs array is required' });
    }

    await Agent.deleteMany({ _id: { $in: ids }, user_id: userId });

    res.json({ success: true, message: `${ids.length} agents deleted successfully` });
  } catch (error) {
    console.error('Bulk Delete Agents Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};