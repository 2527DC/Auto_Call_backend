const { db } = require('../models');
const { SMSCampaign, CampaignType, PhoneNumber, Contact, ContactGroup, SMSTemplate, SMSLog, SMSAgent, Campaign } = db;
const fs = require('fs');
const path = require('path');
const { checkFeatureLimit } = require('../utils/limitHelper');
const { getUserLimits } = require('../utils/limitHelper');
const notificationHelper = require('../utils/notificationHelper');
const webhookDispatcher = require('../services/webhookDispatcher');


let campaignQueue;
let removeCampaignJob;
if (process.env.REDIS_URL) {
  const queueServices = require('../services/queue');
  campaignQueue = queueServices.campaignQueue;
  removeCampaignJob = queueServices.removeCampaignJob;
}

exports.create = async (req, res) => {
  try {
    const { name, typeId, phoneNumberId, smsAgentId, content, SMSSchedule, contactIds, contactGroupIds } = req.body;

    let contact_file = '';
    if (req.file) {
      contact_file = req.file.path;
    }

    if (!name || !typeId || !phoneNumberId || !smsAgentId || !content) {
      return res.status(400).json({ success: false, message: 'Required fields are missing' });
    }

    const existName = await SMSCampaign.findOne({ name, user_id: req.user._id });
    if (existName) {
      return res.status(409).json({ success: false, message: 'SMS Campaign name already exists' });
    }

    const existType = await CampaignType.findOne({ _id: typeId, user_id: req.user._id });
    if (!existType) {
      return res.status(404).json({ success: false, message: 'Campaign type not found' });
    }


    if (phoneNumberId) {
      const existPhoneNumber = await PhoneNumber.findById(phoneNumberId);
      if (!existPhoneNumber) {
        return res.status(404).json({ success: false, message: 'Phone number not found' });
      }
      const isAdmin = req.user.roleId.name === 'super_admin' || req.user.roleId.name === 'admin';
      if (!isAdmin && existPhoneNumber.user_id && existPhoneNumber.user_id.toString() !== req.user._id.toString()) {
        return res.status(404).json({ success: false, message: 'Phone number not found in your account' });
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

    if (smsAgentId) {
      const existSMSAgent = await SMSAgent.findOne({ _id: smsAgentId, user_id: req.user._id, status: 'active' });
      if (!existSMSAgent) {
        return res.status(404).json({ success: false, message: 'Active SMS Agent not found' });
      }
    }

    let parsedSMSSchedule = undefined;
    if (SMSSchedule) {
      try {
        parsedSMSSchedule = typeof SMSSchedule === 'string' ? JSON.parse(SMSSchedule) : SMSSchedule;
        if (!parsedSMSSchedule.callStartTime || !parsedSMSSchedule.callEndTime || !parsedSMSSchedule.dayOfWeek || !Array.isArray(parsedSMSSchedule.dayOfWeek)) {
          return res.status(400).json({ success: false, message: 'Invalid schedule format' });
        }
      } catch (error) {
        return res.status(400).json({ success: false, message: 'Invalid SMSSchedule format' });
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
      phoneNumberId,
      smsAgentId: smsAgentId || null,
      content,
      user_id: req.user._id,
      status: 'Draft',
      contactIds: parsedContactIds,
      contactGroupIds: parsedContactGroupIds,
      SMSSchedule: parsedSMSSchedule,
      contact_file
    };

    if (parsedSMSSchedule) campaignData.SMSSchedule = parsedSMSSchedule;

    const campaign = new SMSCampaign(campaignData);
    await campaign.save();



    res.status(201).json({ success: true, message: 'SMS Campaign created successfully.', data: campaign });
  } catch (error) {
    console.log('Error while creating sms campaign: ', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const query = { user_id: req.user._id || req.user.id };

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    const campaigns = await SMSCampaign.find(query)
      .populate('typeId', 'name')
      .populate('phoneNumberId', 'phone_number')
      .populate('smsAgentId', 'name type language')
      .populate('contactIds', 'first_name last_name phone_number email')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ created_at: -1 });

    const total = await SMSCampaign.countDocuments(query);

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

exports.getById = async (req, res) => {
  try {
    const campaign = await SMSCampaign.findOne({ _id: req.params.id, user_id: req.user._id })
      .populate('typeId', 'name')
      .populate('phoneNumberId', 'phone_number')
      .populate('smsAgentId', 'name type language')
      .populate('contactIds', 'first_name last_name phone_number email');

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'SMS Campaign not found' });
    }

    res.status(200).json({ success: true, data: campaign });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { name, typeId, phoneNumberId, smsAgentId, content, SMSSchedule, status, contactIds, contactGroupIds } = req.body;

    const campaign = await SMSCampaign.findOne({ _id: req.params.id, user_id: req.user._id });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'SMS Campaign not found' });
    }

    if (name) {
      const existName = await SMSCampaign.findOne({ name, user_id: req.user._id, _id: { $ne: campaign._id } });
      if (existName) {
        return res.status(400).json({ success: false, message: 'SMS Campaign name already exists' });
      }
      campaign.name = name;
    }

    if (typeId) {
      const existType = await CampaignType.findById(typeId);
      if (!existType) return res.status(400).json({ success: false, message: 'Type not found' });
      campaign.typeId = typeId;
    }

    if (phoneNumberId) {
      const existPhoneNumber = await PhoneNumber.findById(phoneNumberId);
      if (!existPhoneNumber) return res.status(400).json({ success: false, message: 'Phone number not found' });
      const isAdmin = req.user.roleId.name === 'super_admin' || req.user.roleId.name === 'admin';
      if (!isAdmin && existPhoneNumber.user_id && existPhoneNumber.user_id.toString() !== req.user._id.toString()) {
        return res.status(404).json({ success: false, message: 'Phone number not found in your account' });
      }

      const existCampaign = await Campaign.findOne({
        phoneNumberId,
        userId: req.user._id,
        campaignStatus: { $nin: ['Completed', 'Failed', 'Cancelled'] }
      });
      if (existCampaign) {
        return res.status(400).json({ success: false, message: `Phone number is already used in another active or drafted campaign: ${existCampaign.name}` });
      }

      const existSMSCampaign = await SMSCampaign.findOne({
        phoneNumberId,
        user_id: req.user._id,
        status: { $nin: ['Completed', 'Failed', 'Cancelled'] },
        _id: { $ne: campaign._id }
      });
      if (existSMSCampaign) {
        return res.status(400).json({ success: false, message: `Phone number is already used in another active or drafted SMS campaign: ${existSMSCampaign.name}` });
      }

      campaign.phoneNumberId = phoneNumberId;
    }

    if (smsAgentId !== undefined) {
      if (smsAgentId) {
        const existSMSAgent = await SMSAgent.findOne({ _id: smsAgentId, user_id: req.user._id, status: 'active' });
        if (!existSMSAgent) return res.status(400).json({ success: false, message: 'Active SMS Agent not found' });
      }
      campaign.smsAgentId = smsAgentId;
    }

    if (content) {
      campaign.content = content;
    }

    if (SMSSchedule) {
      try {
        const parsedSMSSchedule = typeof SMSSchedule === 'string' ? JSON.parse(SMSSchedule) : SMSSchedule;
        if (!parsedSMSSchedule.callStartTime || !parsedSMSSchedule.callEndTime || !parsedSMSSchedule.dayOfWeek || !Array.isArray(parsedSMSSchedule.dayOfWeek)) {
          return res.status(400).json({ success: false, message: 'Invalid schedule format' });
        }
        campaign.SMSSchedule = parsedSMSSchedule;
      } catch (error) {
        return res.status(400).json({ success: false, message: 'Invalid SMSSchedule format' });
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

    if (contactGroupIds !== undefined) {
      let parsedContactGroupIds = [];
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
        campaign.contactGroupIds = parsedContactGroupIds;
      } catch (error) {
        return res.status(400).json({ success: false, message: 'Invalid contactGroupIds format' });
      }
    }

    if (req.file) {
      if (campaign.contact_file && fs.existsSync(campaign.contact_file)) {
        fs.unlinkSync(campaign.contact_file);
      }
      campaign.contact_file = req.file.path;
    }

    let warningMessage = '';
    let statusChangingToActive = false;
    let previousStatus = campaign.status;
    if (status) {
      if (['Completed', 'Failed', 'Cancelled'].includes(campaign.status) && status !== campaign.status) {
        return res.status(400).json({ success: false, message: 'Cannot update a completed, failed, or cancelled campaign' });
      }

      if (status === 'Active') {
        if (campaign.status !== 'Draft' && campaign.status !== 'Paused') {
          return res.status(400).json({ success: false, message: 'Campaign can only be activated from Draft or Paused state' });
        }

        const UserSettings = db.UserSettings;
        const settings = await UserSettings.findOne({ user: req.user._id });
        if (!settings || !settings.twilio_account_sid || !settings.twilio_auth_token) {
          return res.status(400).json({ success: false, message: 'Twilio credentials not found in your settings. Please configure them before activating a campaign.' });
        }

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const activeCampaignsCount = await SMSCampaign.countDocuments({
          user_id: req.user._id,
          status: { $in: ['Active', 'Completed', 'Failed', 'Paused', 'Cancelled'] },
          updated_at: { $gte: startOfDay },
          _id: { $ne: campaign._id }
        });
        await checkFeatureLimit(req.user._id, 'Active SMS Campaign per Day', 'sms_campaign_limit_per_day', activeCampaignsCount);

        const limits = await getUserLimits(req.user._id);
        const smsLimit = limits.campaign_sms_limit;

        if (smsLimit !== -1 && smsLimit !== null && smsLimit !== undefined) {
          let totalContacts = 0;
          if (campaign.contactIds && campaign.contactIds.length > 0) totalContacts += campaign.contactIds.length;
          if (campaign.contactGroupIds && campaign.contactGroupIds.length > 0) {
            const groupContactsCount = await Contact.countDocuments({
              group_ids: { $in: campaign.contactGroupIds },
              user_id: req.user._id
            });
            totalContacts += groupContactsCount;
          }
          if (campaign.contact_file && fs.existsSync(campaign.contact_file)) {
            const fileContent = fs.readFileSync(campaign.contact_file, 'utf-8');
            const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
            totalContacts += Math.max(0, lines.length - 1);
          }

          const currentUsage = await SMSLog.countDocuments({ user_id: req.user._id, status: 'sent' });

          await checkFeatureLimit(req.user._id, 'SMS Campaign', 'campaign_sms_limit', currentUsage, 1);

          const remaining = Math.max(0, smsLimit - currentUsage);

          if (totalContacts > remaining) {
            warningMessage = `Campaign activated. Note: You have only ${remaining} SMS limit remaining, so only ${remaining} messages will be sent out of ${totalContacts} contacts.`;
          }
        }

        statusChangingToActive = true;
      } else if (status === 'Paused') {
        if (campaign.status !== 'Active') {
          return res.status(400).json({ success: false, message: 'Campaign can only be paused from Active state' });
        }
      } else if (status === 'Cancelled') {
        if (campaign.status !== 'Active' && campaign.status !== 'Paused') {
          return res.status(400).json({ success: false, message: 'Campaign can only be cancelled from Active or Paused state' });
        }
      } else if (status !== campaign.status) {
        return res.status(400).json({ success: false, message: 'Invalid status transition' });
      }

      campaign.status = status;
    }

    await campaign.save();

    if (status && status !== previousStatus) {
      if (status === 'Active' && previousStatus === 'Draft') {
        webhookDispatcher.dispatchEvent(campaign.user_id, 'Campaign Initiated', campaign);
      } else if (status === 'Active' && previousStatus === 'Paused') {
        webhookDispatcher.dispatchEvent(campaign.user_id, 'Campaign Restarted', campaign);
      } else if (status === 'Paused') {
        webhookDispatcher.dispatchEvent(campaign.user_id, 'Campaign Halted', campaign);
      } else if (status === 'Cancelled') {
        webhookDispatcher.dispatchEvent(campaign.user_id, 'Campaign Aborted', campaign);
      }
    }

    if (statusChangingToActive && campaignQueue) {
      let delayMs = 0;
      if (campaign.SMSSchedule && campaign.SMSSchedule.callStartTime) {
        const [hours, minutes] = campaign.SMSSchedule.callStartTime.split(':').map(Number);
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
        'process-sms-campaign',
        { type: 'process-sms-campaign', campaignId: campaign._id.toString() },
        { delay: delayMs }
      );
    }
    let responseMessage = warningMessage || 'SMS Campaign updated successfully';
    if (status === 'Cancelled' && !warningMessage) {
      responseMessage = 'Campaign Cancelled successfully';
      try {
        await notificationHelper.sendNotification(
          req.app,
          req.user._id,
          'CAMPAIGN_STATUS',
          'SMS Campaign Cancelled',
          `Your SMS campaign "${campaign.name}" has been cancelled.`
        );
      } catch (notifErr) {
        console.error('Notification error:', notifErr);
      }
    }
    res.status(200).json({ success: true, message: responseMessage, data: campaign });
  } catch (error) {
    console.log('Error while updating sms campaign: ', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const campaign = await SMSCampaign.findOne({ _id: req.params.id, user_id: req.user._id });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'SMS Campaign not found' });
    }

    if (removeCampaignJob) {
      await removeCampaignJob(campaign._id.toString());
    }

    if (campaign.contact_file && fs.existsSync(campaign.contact_file)) {
      fs.unlinkSync(campaign.contact_file);
    }

    await SMSCampaign.findByIdAndDelete(campaign._id);

    res.status(200).json({ success: true, message: 'SMS Campaign deleted successfully' });
  } catch (error) {
    console.log('Error while deleting sms campaign: ', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.user._id;

    const campaign = await SMSCampaign.findOne({ _id: campaignId, user_id: userId })
      .populate('phoneNumberId', 'phone_number');

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'SMS Campaign not found' });
    }

    const { page = 1, limit = 10, search = '', status = '' } = req.query;

    const query = { campaign_id: campaignId, user_id: userId };

    if (search) {
      query.$or = [
        { lead_name: { $regex: search, $options: 'i' } },
        { to_number: { $regex: search, $options: 'i' } },
        { message_body: { $regex: search, $options: 'i' } }
      ];
    }

    if (status && status !== 'all' && status !== '') {
      query.status = status;
    }

    const totalLogs = await SMSLog.countDocuments(query);
    const logs = await SMSLog.find(query)
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    const totalLeads = await SMSLog.countDocuments({ campaign_id: campaignId, user_id: userId });
    const completedCount = await SMSLog.countDocuments({ campaign_id: campaignId, user_id: userId, status: { $in: ['delivered', 'sent'] } });
    const successRate = totalLeads > 0 ? Math.round((completedCount / totalLeads) * 100) : 0;

    res.status(200).json({
      success: true,
      data: {
        campaign: {
          _id: campaign._id,
          name: campaign.name,
          status: campaign.status,
          content: campaign.content,
          created_at: campaign.created_at
        },
        metrics: {
          totalLeads,
          completedCount,
          successRate
        },
        pagination: {
          total: totalLogs,
          page: parseInt(page),
          pages: Math.ceil(totalLogs / limit)
        },
        logs: logs.map(c => ({
          _id: c._id,
          lead_name: c.lead_name,
          to_number: c.to_number,
          status: c.status,
          direction: c.direction,
          started_at: c.started_at,
          twilio_message_sid: c.twilio_message_sid
        }))
      }
    });

  } catch (error) {
    console.log('Error getting SMS campaign history: ', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
