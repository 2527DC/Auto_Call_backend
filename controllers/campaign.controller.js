const { db } = require('../models')
const { Campaign, CampaignType, Agent, PhoneNumber, Contact, Call, ContactGroup, SMSCampaign, WhatsappPhoneNumber } = db
const fs = require('fs');
const path = require('path');
const { checkFeatureLimit } = require('../utils/limitHelper');
const notificationHelper = require('../utils/notificationHelper');
const webhookDispatcher = require('../services/webhookDispatcher');

let campaignQueue;
let removeCampaignJob;
if (process.env.REDIS_URL) {
  const queueServices = require('../services/queue');
  campaignQueue = queueServices.campaignQueue;
  removeCampaignJob = queueServices.removeCampaignJob;
}

exports.createCampaign = async (req, res) => {
  try {
    const { name, typeId, description, agentId, phoneNumberId, callSchedule, autoRetrySettings, contactIds, contactGroupIds } = req.body;

    let contactFile = '';
    if (req.file) {
      contactFile = req.file.path;
    }

    if (!name || !typeId || !agentId || !phoneNumberId) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    if (name) {
      const existName = await Campaign.findOne({ name: name })
      if (existName) {
        return res.status(409).json({ success: false, message: 'Campaign name already exists' });
      }
    }

    if (typeId) {
      const existType = await CampaignType.findOne({ _id: typeId, user_id: req.user._id })
      if (!existType) {
        return res.status(404).json({ success: false, message: 'Campaign type not found' });
      }
      if (existType.status === false) {
        return res.status(400).json({ success: false, message: 'Campaign type is not active' });
      }
    }


    if (agentId) {
      const existAgent = await Agent.findOne({ _id: agentId, user_id: req.user._id })
      if (!existAgent) {
        return res.status(404).json({ success: false, message: 'Agent not found' });
      }

      if (existAgent.type !== 'flow') {
        return res.status(400).json({ success: false, message: `Only flow agents are allowed to create campaigns` });
      }

    }

    let phoneModel = 'PhoneNumber';
    if (phoneNumberId) {
      let existPhoneNumber = await PhoneNumber.findById(phoneNumberId);
      if (!existPhoneNumber) {
        existPhoneNumber = await WhatsappPhoneNumber.findById(phoneNumberId);
        if (!existPhoneNumber) {
          return res.status(404).json({ success: false, message: 'Phone number not found' });
        }
        phoneModel = 'WhatsappPhoneNumber';
      } else {
        const isAdmin = req.user.roleId.name === 'super_admin' || req.user.roleId.name === 'admin';
        if (!isAdmin && existPhoneNumber.user_id && existPhoneNumber.user_id.toString() !== req.user._id.toString()) {
          return res.status(404).json({ success: false, message: 'Phone number not found in your account' });
        }
        if (existPhoneNumber.agent_id) {
          return res.status(400).json({
            success: false,
            message: "You can't assign this phone number to a campaign because it already has an assigned incoming agent."
          });
        }
      }

      const existCampaign = await Campaign.findOne({
        phoneNumberId,
        userId: req.user._id,
        campaignStatus: { $nin: ['Completed', 'Failed', 'Cancelled'] }
      });
      if (existCampaign) {
        return res.status(400).json({ success: false, message: `Phone number is already used in an active or drafted campaign: ${existCampaign.name}` });
      }

      const existSMSCampaign = await SMSCampaign.findOne({
        phoneNumberId,
        user_id: req.user._id,
        status: { $nin: ['Completed', 'Failed', 'Cancelled'] }
      });
      if (existSMSCampaign) {
        return res.status(400).json({ success: false, message: `Phone number is already used in an active or drafted SMS campaign: ${existSMSCampaign.name}` });
      }
    }

    let parsedCallSchedule = undefined;
    if (callSchedule) {
      try {
        parsedCallSchedule = typeof callSchedule === 'string' ? JSON.parse(callSchedule) : callSchedule;

        if (!parsedCallSchedule.callStartTime || !parsedCallSchedule.callEndTime || !parsedCallSchedule.dayOfWeek || !Array.isArray(parsedCallSchedule.dayOfWeek)) {
          return res.status(400).json({ success: false, message: 'callStartTime, callEndTime, and dayOfWeek are required if callSchedule is provided' });
        }
      } catch (error) {
        return res.status(400).json({ success: false, message: 'Invalid callSchedule format' });
      }
    }

    let parsedAutoRetrySettings = undefined;
    if (autoRetrySettings) {
      try {
        parsedAutoRetrySettings = typeof autoRetrySettings === 'string' ? JSON.parse(autoRetrySettings) : autoRetrySettings;
      } catch (error) {
        return res.status(400).json({ success: false, message: 'Invalid autoRetrySettings format' });
      }
    }

    let parsedContactIds = [];
    if (contactIds) {
      try {
        parsedContactIds = typeof contactIds === 'string' ? JSON.parse(contactIds) : contactIds;

        if (parsedContactIds && parsedContactIds.length > 0) {
          const validContactsCount = await Contact.countDocuments({
            _id: { $in: parsedContactIds },
            user_id: req.user._id
          });
          if (validContactsCount !== parsedContactIds.length) {
            return res.status(400).json({ success: false, message: 'One or more contact IDs are invalid' });
          }
        }
      } catch (error) {
        return res.status(400).json({ success: false, message: 'Invalid contactIds format' });
      }
    }

    let parsedContactGroupIds = [];
    if (contactGroupIds) {
      try {
        parsedContactGroupIds = typeof contactGroupIds === 'string' ? JSON.parse(contactGroupIds) : contactGroupIds;

        if (parsedContactGroupIds && parsedContactGroupIds.length > 0) {
          const validGroupsCount = await ContactGroup.countDocuments({
            _id: { $in: parsedContactGroupIds },
            user_id: req.user._id
          });
          if (validGroupsCount !== parsedContactGroupIds.length) {
            return res.status(400).json({ success: false, message: 'One or more contact group IDs are invalid' });
          }
        }
      } catch (error) {
        return res.status(400).json({ success: false, message: 'Invalid contactGroupIds format' });
      }
    }

    const campaignData = {
      name,
      typeId,
      description,
      agentId,
      phoneNumberId,
      phoneNumberModel: phoneModel,
      contactFile,
      contactIds: parsedContactIds,
      contactGroupIds: parsedContactGroupIds,
      userId: req.user._id,
      campaignStatus: 'Draft'
    };

    if (parsedCallSchedule) {
      campaignData.callSchedule = parsedCallSchedule;
    }

    if (parsedAutoRetrySettings) {
      campaignData.autoRetrySettings = parsedAutoRetrySettings;
    }

    const campaign = new Campaign(campaignData);

    await campaign.save();



    res.status(201).json({ success: true, message: 'Campaign created successfully.', data: campaign });
  } catch (error) {
    console.log('Error while creating campaign: ', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCampaigns = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const query = { userId: req.user._id };

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    const campaigns = await Campaign.find(query)
      .populate('typeId', 'name')
      .populate('agentId', 'name')
      .populate('phoneNumberId', 'phone_number')
      .populate('contactIds', 'first_name last_name phone_number email')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ created_at: -1 });

    const total = await Campaign.countDocuments(query);

    res.status(200).json({
      success: true,
      data: campaigns,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCampaignById = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id })
      .populate('typeId', 'name')
      .populate('agentId', 'name')
      .populate('phoneNumberId', 'phone_number')
      .populate('contactIds', 'first_name last_name phone_number email');

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    res.status(200).json({ success: true, data: campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateCampaign = async (req, res) => {
  try {
    const { name, typeId, description, agentId, phoneNumberId, callSchedule, autoRetrySettings, campaignStatus, contactIds } = req.body;

    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    if (name) {
      const existName = await Campaign.findOne({ name: name, _id: { $ne: campaign._id } });
      if (existName) {
        return res.status(400).json({ success: false, message: 'Campaign name already exists' });
      }
      campaign.name = name;
    }
    if (typeId) {
      const existType = await CampaignType.findById(typeId);
      if (!existType) {
        return res.status(400).json({ success: false, message: 'Type not found' });
      }
      campaign.typeId = typeId;
    }
    if (description !== undefined) campaign.description = description;
    if (agentId) {
      const existAgent = await Agent.findById(agentId);
      if (!existAgent) {
        return res.status(400).json({ success: false, message: 'Agent not found' });
      }
      if (existAgent.type !== 'flow') {
        return res.status(400).json({ success: false, message: `Only flow agents are allowed to create campaigns` });
      }
      campaign.agentId = agentId;
    }
    let phoneModel = campaign.phoneNumberModel || 'PhoneNumber';
    if (phoneNumberId) {
      let existPhoneNumber = await PhoneNumber.findById(phoneNumberId);
      if (!existPhoneNumber) {
        existPhoneNumber = await WhatsappPhoneNumber.findById(phoneNumberId);
        if (!existPhoneNumber) {
          return res.status(400).json({ success: false, message: 'Phone number not found' });
        }
        phoneModel = 'WhatsappPhoneNumber';
      } else {
        const isAdmin = req.user.roleId.name === 'super_admin' || req.user.roleId.name === 'admin';
        if (!isAdmin && existPhoneNumber.user_id && existPhoneNumber.user_id.toString() !== req.user._id.toString()) {
          return res.status(404).json({ success: false, message: 'Phone number not found in your account' });
        }
        if (existPhoneNumber.agent_id) {
          return res.status(400).json({
            success: false,
            message: "You can't assign this phone number to a campaign because it already has an assigned incoming agent."
          });
        }
      }

      const existCampaign = await Campaign.findOne({
        phoneNumberId,
        userId: req.user._id,
        campaignStatus: { $nin: ['Completed', 'Failed', 'Cancelled'] },
        _id: { $ne: campaign._id }
      });
      if (existCampaign) {
        return res.status(400).json({ success: false, message: `Phone number is already used in another active or drafted campaign: ${existCampaign.name}` });
      }

      const existSMSCampaign = await SMSCampaign.findOne({
        phoneNumberId,
        user_id: req.user._id,
        status: { $nin: ['Completed', 'Failed', 'Cancelled'] }
      });
      if (existSMSCampaign) {
        return res.status(400).json({ success: false, message: `Phone number is already used in an active or drafted SMS campaign: ${existSMSCampaign.name}` });
      }

      campaign.phoneNumberId = phoneNumberId;
      campaign.phoneNumberModel = phoneModel;
    }

    if (callSchedule) {
      try {
        const parsedCallSchedule = typeof callSchedule === 'string' ? JSON.parse(callSchedule) : callSchedule;
        if (!parsedCallSchedule.callStartTime || !parsedCallSchedule.callEndTime || !parsedCallSchedule.dayOfWeek || !Array.isArray(parsedCallSchedule.dayOfWeek)) {
          return res.status(400).json({ success: false, message: 'callStartTime, callEndTime, and dayOfWeek are required if callSchedule is provided' });
        }
        campaign.callSchedule = parsedCallSchedule;
      } catch (error) {
        return res.status(400).json({ success: false, message: 'Invalid callSchedule format' });
      }
    }
    if (autoRetrySettings) {
      try {
        campaign.autoRetrySettings = typeof autoRetrySettings === 'string' ? JSON.parse(autoRetrySettings) : autoRetrySettings;
      } catch (error) {
        return res.status(400).json({ success: false, message: 'Invalid autoRetrySettings format' });
      }
    }

    if (contactIds !== undefined) {
      let parsedContactIds = [];
      try {
        parsedContactIds = typeof contactIds === 'string' ? JSON.parse(contactIds) : contactIds;

        if (parsedContactIds && parsedContactIds.length > 0) {
          const validContactsCount = await Contact.countDocuments({
            _id: { $in: parsedContactIds },
            user_id: req.user._id
          });
          if (validContactsCount !== parsedContactIds.length) {
            return res.status(400).json({ success: false, message: 'One or more contact IDs are invalid' });
          }
        }
        campaign.contactIds = parsedContactIds;
      } catch (error) {
        return res.status(400).json({ success: false, message: 'Invalid contactIds format' });
      }
    }

    if (req.body.contactGroupIds !== undefined) {
      let parsedContactGroupIds = [];
      try {
        parsedContactGroupIds = typeof req.body.contactGroupIds === 'string' ? JSON.parse(req.body.contactGroupIds) : req.body.contactGroupIds;

        if (parsedContactGroupIds && parsedContactGroupIds.length > 0) {
          const validGroupsCount = await db.ContactGroup.countDocuments({
            _id: { $in: parsedContactGroupIds },
            user_id: req.user._id
          });
          if (validGroupsCount !== parsedContactGroupIds.length) {
            return res.status(400).json({ success: false, message: 'One or more contact group IDs are invalid' });
          }
        }
        campaign.contactGroupIds = parsedContactGroupIds;
      } catch (error) {
        return res.status(400).json({ success: false, message: 'Invalid contactGroupIds format' });
      }
    }

    if (req.file) {
      if (campaign.contactFile && fs.existsSync(campaign.contactFile)) {
        fs.unlinkSync(campaign.contactFile);
      }
      campaign.contactFile = req.file.path;
    }


    let statusChangingToActive = false;
    let previousStatus = campaign.campaignStatus;
    if (campaignStatus) {
      if (['Completed', 'Failed', 'Cancelled'].includes(campaign.campaignStatus) && campaignStatus !== campaign.campaignStatus) {
        return res.status(400).json({ success: false, message: 'Cannot update a completed, failed, or cancelled campaign' });
      }

      if (campaignStatus === 'Active') {
        if (campaign.campaignStatus !== 'Draft' && campaign.campaignStatus !== 'Paused') {
          return res.status(400).json({ success: false, message: 'Campaign can only be activated from Draft or Paused state' });
        }

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const activeCampaignsCount = await Campaign.countDocuments({
          userId: req.user._id,
          campaignStatus: { $in: ['Active', 'Completed', 'Failed', 'Paused', 'Cancelled'] },
          updated_at: { $gte: startOfDay },
          _id: { $ne: campaign._id }
        });
        await checkFeatureLimit(req.user._id, 'Active Campaign per Day', 'campaign_limit_per_day', activeCampaignsCount);
        statusChangingToActive = true;
      } else if (campaignStatus === 'Paused') {
        if (campaign.campaignStatus !== 'Active') {
          return res.status(400).json({ success: false, message: 'Campaign can only be paused from Active state' });
        }
      } else if (campaignStatus === 'Cancelled') {
        if (campaign.campaignStatus !== 'Active' && campaign.campaignStatus !== 'Paused') {
          return res.status(400).json({ success: false, message: 'Campaign can only be cancelled from Active or Paused state' });
        }
      } else if (campaignStatus !== campaign.campaignStatus) {
        return res.status(400).json({ success: false, message: 'Invalid status transition' });
      }

      campaign.campaignStatus = campaignStatus;
    }

    await campaign.save();

    if (campaignStatus && campaignStatus !== previousStatus) {
      if (campaignStatus === 'Active' && previousStatus === 'Draft') {
        webhookDispatcher.dispatchEvent(campaign.userId, 'Campaign Initiated', campaign);
      } else if (campaignStatus === 'Active' && previousStatus === 'Paused') {
        webhookDispatcher.dispatchEvent(campaign.userId, 'Campaign Restarted', campaign);
      } else if (campaignStatus === 'Paused') {
        webhookDispatcher.dispatchEvent(campaign.userId, 'Campaign Halted', campaign);
      } else if (campaignStatus === 'Cancelled') {
        webhookDispatcher.dispatchEvent(campaign.userId, 'Campaign Aborted', campaign);
      }
    }

    if (statusChangingToActive && campaignQueue) {
      let delayMs = 0;
      if (campaign.callSchedule && campaign.callSchedule.callStartTime) {
        const [hours, minutes] = campaign.callSchedule.callStartTime.split(':').map(Number);
        if (!isNaN(hours) && !isNaN(minutes)) {
          const now = new Date();
          const scheduleDate = new Date(now);
          scheduleDate.setHours(hours, minutes, 0, 0);

          if (scheduleDate <= now) {
            scheduleDate.setDate(scheduleDate.getDate() + 1);
          }
          delayMs = Math.max(0, scheduleDate.getTime() - Date.now());
        }
      }

      await campaignQueue.add(
        'process-campaign',
        { type: 'process-campaign', campaignId: campaign._id.toString() },
        { delay: delayMs }
      );
    }

    let responseMessage = 'Campaign updated successfully';
    if (campaignStatus === 'Cancelled') {
      responseMessage = 'Campaign Cancelled successfully';
      try {
        await notificationHelper.sendNotification(
          req.app,
          req.user._id,
          'CAMPAIGN_STATUS',
          'Campaign Cancelled',
          `Your campaign "${campaign.name}" has been cancelled.`
        );
      } catch (error) {
        console.error('Notification error:', error);
      }
    }
    res.status(200).json({ success: true, message: responseMessage, data: campaign });
  } catch (error) {
    console.log('Error while updating campaign: ', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    if (removeCampaignJob) {
      await removeCampaignJob(campaign._id.toString());
    }

    if (campaign.contactFile && fs.existsSync(campaign.contactFile)) {
      fs.unlinkSync(campaign.contactFile);
    }

    await Campaign.findByIdAndDelete(campaign._id);



    res.status(200).json({ success: true, message: 'Campaign deleted successfully' });
  } catch (error) {
    console.log('Error while deleting campaign: ', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCampaignHistory = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user._id;

    const campaign = await Campaign.findOne({ _id: campaignId, userId })
      .populate({
        path: 'agentId',
        select: 'name voice_tone personality telephony_provider voice_id language llm_model system_prompt first_message status',
        populate: { path: 'llm_model', select: 'name display_name model_id provider status' }
      })
      .populate('phoneNumberId', 'phone_number');

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const calls = await Call.find({ campaign_id: campaignId, user_id: userId })
      .sort({ created_at: -1 })
      .lean();

    const totalLeads = calls.length;
    const completedCalls = calls.filter(c => c.status === 'completed');
    const completedCount = completedCalls.length;

    let totalDuration = 0;
    completedCalls.forEach(c => {
      totalDuration += (c.duration || 0);
    });

    const avgDuration = completedCount > 0 ? Math.round(totalDuration / completedCount) : 0;
    const successRate = totalLeads > 0 ? Math.round((completedCount / totalLeads) * 100) : 0;

    res.status(200).json({
      success: true,
      data: {
        campaign: {
          _id: campaign._id,
          name: campaign.name,
          campaignStatus: campaign.campaignStatus,
          created_at: campaign.created_at
        },
        agent: campaign.agentId,
        metrics: {
          totalLeads,
          completedCount,
          avgDuration,
          successRate
        },
        calls: calls.map(c => ({
          _id: c._id,
          lead_name: c.lead_name,
          to_number: c.to_number,
          status: c.status,
          duration: c.duration,
          started_at: c.started_at,
          ended_at: c.ended_at,
          fail_reason: c.fail_reason,
          recording_url: c.recording_url,
          transcript: c.transcript
        }))
      }
    });

  } catch (error) {
    console.log('Error getting campaign history: ', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

