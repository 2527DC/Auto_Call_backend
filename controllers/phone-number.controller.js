'use strict';

const { db } = require('../models');
const PhoneNumber = db.PhoneNumber;
const Setting = db.Setting;
const UserSettings = db.UserSettings;
const Campaign = db.Campaign;
const SMSCampaign = db.SMSCampaign;
const Agent = db.Agent;
const SipTrunk = db.SipTrunk;
const twilioService = require('../services/twilioService');
const elevenlabsService = require('../services/elevenlabsService');
const plivoService = require('../services/plivoService');

exports.loadFromTwilio = async (req, res) => {
  try {
    const settings = await UserSettings.findOne({ user: req.user.id });
    if (!settings || !settings.twilio_account_sid || !settings.twilio_auth_token) {
      return res.status(400).json({ success: false, message: 'Twilio credentials not configured in your settings' });
    }

    const twilioNumbers = await twilioService.getNumbers(settings.twilio_account_sid, settings.twilio_auth_token);
    const userId = req.user.id;
    const isAdmin = req.user.roleId.name === 'super_admin' || req.user.roleId.name === 'admin';

    const allTwilioNumbers = [
      ...twilioNumbers.purchased.map(n => ({ ...n, type: 'purchased' })),
      ...twilioNumbers.verified.map(n => ({ ...n, type: 'verified' }))
    ];

    const syncedNumbers = [];
    for (const num of allTwilioNumbers) {
      let phoneNumber = await PhoneNumber.findOne({ phone_number: num.phone_number });

      if (!phoneNumber) {
        phoneNumber = await PhoneNumber.create({
          phone_number: num.phone_number,
          sid: num.sid,
          type: num.type,
          user_id: isAdmin ? null : userId,
          is_system_pool: isAdmin,
          provider: 'twilio'
        });
      } else {
        phoneNumber.sid = num.sid;
        phoneNumber.user_id = isAdmin ? null : userId;
        phoneNumber.is_system_pool = isAdmin;
        await phoneNumber.save();
      }
      syncedNumbers.push(phoneNumber);
    }

    res.json({ success: true, message: `${syncedNumbers.length} numbers synced from Twilio`, data: syncedNumbers });
  } catch (error) {
    console.error('Load From Twilio Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.loadFromPlivo = async (req, res) => {
  try {
    const settings = await UserSettings.findOne({ user: req.user.id });
    if (!settings || !settings.plivo_auth_id || !settings.plivo_auth_token) {
      return res.status(400).json({ success: false, message: 'Plivo credentials not configured in your settings' });
    }

    const plivoNumbers = await plivoService.getNumbers(settings.plivo_auth_id, settings.plivo_auth_token);
    const userId = req.user.id;
    const isAdmin = req.user.roleId.name === 'super_admin' || req.user.roleId.name === 'admin';

    const allPlivoNumbers = [
      ...plivoNumbers.purchased.map(n => ({ ...n, type: 'purchased' })),
      ...plivoNumbers.verified.map(n => ({ ...n, type: 'verified' }))
    ];

    const syncedNumbers = [];
    for (const num of allPlivoNumbers) {
      let phoneNumber = await PhoneNumber.findOne({ phone_number: num.phone_number });

      if (!phoneNumber) {
        phoneNumber = await PhoneNumber.create({
          phone_number: num.phone_number,
          sid: num.sid,
          type: num.type,
          user_id: isAdmin ? null : userId,
          is_system_pool: isAdmin,
          provider: 'plivo'
        });
      } else {
        phoneNumber.sid = num.sid;
        phoneNumber.user_id = isAdmin ? null : userId;
        phoneNumber.is_system_pool = isAdmin;
        phoneNumber.provider = 'plivo';
        await phoneNumber.save();
      }
      syncedNumbers.push(phoneNumber);
    }

    res.json({ success: true, message: `${syncedNumbers.length} numbers synced from Plivo`, data: syncedNumbers });
  } catch (error) {
    console.error('Load From Plivo Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addNumbers = async (req, res) => {
  try {
    const { numbers } = req.body;
    const userId = req.user.id;
    const isAdmin = req.user.roleId?.name === 'super_admin' || req.user.roleId?.name === 'admin';

    if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
      return res.status(400).json({ success: false, message: 'Numbers array is required' });
    }

    const savedNumbers = [];
    for (const num of numbers) {
      const existing = await PhoneNumber.findOne({ phone_number: num.phone_number });
      if (existing) continue;

      const newNum = await PhoneNumber.create({
        ...num,
        user_id: isAdmin ? null : userId,
        is_system_pool: isAdmin
      });
      savedNumbers.push(newNum);
    }

    res.status(201).json({
      success: true,
      message: `${savedNumbers.length} numbers added successfully`,
      data: savedNumbers
    });
  } catch (error) {
    console.error('Add Numbers Error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.syncPhoneNumberToElevenLabs = async (req, res) => {
  try {
    const { id } = req.params;
    const phoneNumber = await PhoneNumber.findById(id);

    if (!phoneNumber) {
      return res.status(404).json({ success: false, message: 'Phone number not found' });
    }

    if (phoneNumber.is_synced_to_elevenlabs) {
      return res.status(400).json({ success: false, message: 'Phone number already synced to ElevenLabs' });
    }

    const settings = await UserSettings.findOne({ user: req.user.id });
    if (!settings || !settings.twilio_account_sid || !settings.twilio_auth_token) {
      return res.status(400).json({ success: false, message: 'Twilio credentials not configured in your settings' });
    }

    const syncResult = await elevenlabsService.registerPhoneNumber({
      phone_number: phoneNumber.phone_number,
      label: `System Number ${phoneNumber.phone_number}`,
      twilio_account_sid: settings.twilio_account_sid,
      twilio_auth_token: settings.twilio_auth_token
    }, settings.elevenlabs_api_key);

    phoneNumber.is_synced_to_elevenlabs = true;
    phoneNumber.elevenlabs_phone_number_id = syncResult.phone_number_id;
    await phoneNumber.save();

    res.json({ success: true, message: 'Phone number synced to ElevenLabs successfully', data: syncResult });
  } catch (error) {
    console.error('Sync to ElevenLabs Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPhoneNumbers = async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.roleId.name === 'super_admin' || req.user.roleId.name === 'admin';
    const { search, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    let query = {};
    if (!isAdmin) {
      query.user_id = userId;
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      const searchFilter = {
        $or: [
          { phone_number: searchRegex },
          { label: searchRegex },
          { sid: searchRegex }
        ]
      };

      if (query.$or) {
        query = { $and: [{ $or: query.$or }, searchFilter] };
      } else {
        query = searchFilter;
      }
    }

    const numbers = await PhoneNumber.find(query)
      .populate('agent_id', 'name telephony_provider flow_id')
      .populate('sip_trunk_id', 'name engine provider sip_host')
      .sort(sortOptions)
      .lean();

    const campaigns = await Campaign.find({ 
      phoneNumberId: { $in: numbers.map(n => n._id) },
      campaignStatus: { $nin: ['Completed', 'Failed', 'Cancelled'] } 
    }, 'phoneNumberId').lean();

    const smsCampaigns = await SMSCampaign.find({ 
      phoneNumberId: { $in: numbers.map(n => n._id) },
      status: { $nin: ['Completed', 'Failed', 'Cancelled'] } 
    }, 'phoneNumberId').lean();

    const usedNumberIds = new Set([
      ...campaigns.map(c => c.phoneNumberId.toString()),
      ...smsCampaigns.map(c => c.phoneNumberId.toString())
    ]);

    const numbersWithUsedFlag = numbers.map(n => ({
      ...n,
      is_used: usedNumberIds.has(n._id.toString())
    }));

    res.json({ success: true, data: numbersWithUsedFlag });
  } catch (error) {
    console.error('Get Phone Numbers Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.deletePhoneNumber = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const isAdmin = req.user.roleId?.name === 'super_admin' || req.user.roleId?.name === 'admin';

    const query = { _id: id };
    if (!isAdmin) {
      query.user_id = userId;
    }

    const phoneNumber = await PhoneNumber.findOne(query);
    if (!phoneNumber) {
      return res.status(404).json({ success: false, message: 'Phone number not found' });
    }

    if (phoneNumber.elevenlabs_phone_number_id) {
      const settings = await UserSettings.findOne({ user: req.user.id });
      const activeApiKey = settings?.elevenlabs_api_key;
      if (activeApiKey) {
        try {
          await elevenlabsService.deleteElevenLabsPhoneNumber(phoneNumber.elevenlabs_phone_number_id, activeApiKey);
        } catch (elErr) {
          console.error('Failed to delete number from ElevenLabs, proceeding with local deletion:', elErr.message);
        }
      }
    }

    await PhoneNumber.deleteOne({ _id: id });

    res.json({ success: true, message: 'Phone number deleted successfully' });
  } catch (error) {
    console.error('Delete Phone Number Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.updatePhoneNumber = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const isAdmin = req.user.roleId?.name === 'super_admin' || req.user.roleId?.name === 'admin';
    const updateData = { ...req.body };

    const query = { _id: id };
    if (!isAdmin) {
      query.user_id = userId;
    }

    let phoneNumber = await PhoneNumber.findOne(query);
    if (!phoneNumber) {
      return res.status(404).json({ success: false, message: 'Phone number not found' });
    }

    if (updateData.remove_agent === true || updateData.remove_agent === 'true') {
      updateData.agent_id = null;
    }
    delete updateData.remove_agent;

    if (updateData.agent_id === '') {
      updateData.agent_id = null;
    }

    let elevenlabsAgentId = null;

    if (updateData.agent_id) {
      if (phoneNumber.agent_id && phoneNumber.agent_id.toString() !== updateData.agent_id.toString()) {
        return res.status(400).json({
          success: false,
          message: "You can't assign agent. This phone number already has an assigned agent."
        });
      }

      const existCampaign = await Campaign.findOne({ 
        phoneNumberId: id,
        campaignStatus: { $nin: ['Completed', 'Failed', 'Cancelled'] } 
      });
      if (existCampaign) {
        return res.status(400).json({
          success: false,
          message: `You can't assign agent. This phone number is already assigned to campaign "${existCampaign.name}".`
        });
      }

      const existSMSCampaign = await SMSCampaign.findOne({ 
        phoneNumberId: id,
        status: { $nin: ['Completed', 'Failed', 'Cancelled'] }
      });
      if (existSMSCampaign) {
        return res.status(400).json({
          success: false,
          message: `You can't assign agent. This phone number is already assigned to SMS campaign "${existSMSCampaign.name}".`
        });
      }

      const agent = await Agent.findById(updateData.agent_id);
      if (!agent) {
        return res.status(404).json({ success: false, message: 'Agent not found' });
      }
      if (agent.type !== 'incoming') {
        return res.status(400).json({
          success: false,
          message: 'Only agents with type "incoming" can be assigned directly to a phone number. For "flow" type agents, please use them in a campaign.'
        });
      }

      elevenlabsAgentId = agent.elevenlabs_agent_id;
      if ((agent.telephony_provider === 'elevenlabs_sip' || (agent.telephony_provider === 'sip' && agent.voice_provider === 'elevenlabs')) && !elevenlabsAgentId) {
        return res.status(400).json({ success: false, message: 'This agent does not have an ElevenLabs Agent ID configured.' });
      }
    }

    if (phoneNumber.elevenlabs_phone_number_id) {
      const settings = await UserSettings.findOne({ user: req.user.id });
      const activeApiKey = settings?.elevenlabs_api_key;
      if (activeApiKey) {
        await elevenlabsService.updateElevenLabsPhoneNumber(
          phoneNumber.elevenlabs_phone_number_id,
          { agent_id: elevenlabsAgentId },
          activeApiKey
        );
      }
    }

    phoneNumber = await PhoneNumber.findOneAndUpdate(
      query,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    res.json({ success: true, message: 'Phone number updated successfully', data: phoneNumber });
  } catch (error) {
    console.error('Update Phone Number Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update phone number' });
  }
};

exports.updatePurchasePrice = async (req, res) => {
  try {
    const { id } = req.params;
    const { purchase_price, validity_days } = req.body;
    
    if (purchase_price === undefined || purchase_price < 0) {
      return res.status(400).json({ success: false, message: 'Valid purchase price is required' });
    }

    const phoneNumber = await PhoneNumber.findById(id);
    if (!phoneNumber) {
      return res.status(404).json({ success: false, message: 'Phone number not found' });
    }

    phoneNumber.purchase_price = Number(purchase_price);
    
    if (validity_days !== undefined) {
      phoneNumber.validity_days = Number(validity_days);
    }
    
    await phoneNumber.save();

    res.json({ success: true, message: 'Phone number configuration updated successfully', data: phoneNumber });
  } catch (error) {
    console.error('Update Purchase Price Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.importSipPhoneNumber = async (req, res) => {
  try {
    const { phone_number, label, sip_trunk_id } = req.body;
    const userId = req.user.id;

    if (!phone_number || !sip_trunk_id) {
      return res.status(400).json({ success: false, message: 'Phone number and SIP trunk are required' });
    }

    const existing = await PhoneNumber.findOne({ phone_number });
    if (existing) {
      return res.status(400).json({ success: false, message: 'This phone number is already registered in the system' });
    }

    const trunk = await SipTrunk.findOne({ _id: sip_trunk_id, user_id: userId });
    if (!trunk) {
      return res.status(404).json({ success: false, message: 'SIP trunk not found' });
    }

    const settings = await UserSettings.findOne({ user: userId });
    if (!settings || !settings.elevenlabs_api_key) {
      return res.status(400).json({ success: false, message: 'ElevenLabs API key not configured in your settings' });
    }
    const inbound_trunk_config = {
      media_encryption: 'allowed',
      credentials: trunk.username ? { username: trunk.username, password: trunk.password } : null
    };

    const outbound_trunk_config = {
      address: `${trunk.sip_host}:${trunk.port}`,
      transport: trunk.transport || 'tls',
      media_encryption: 'allowed',
      credentials: trunk.username ? { username: trunk.username, password: trunk.password } : null
    };

    const syncResult = await elevenlabsService.importSipPhoneNumber({
      phone_number,
      label: label || `SIP Number ${phone_number}`,
      inbound_trunk_config,
      outbound_trunk_config
    }, settings.elevenlabs_api_key);

    const phoneNumber = await PhoneNumber.create({
      phone_number,
      label: label || null,
      type: 'sip',
      provider: 'sip',
      sip_trunk_id: trunk._id,
      user_id: userId,
      is_system_pool: false,
      is_synced_to_elevenlabs: true,
      elevenlabs_phone_number_id: syncResult.phone_number_id,
      sid: syncResult.phone_number_id
    });

    res.status(201).json({
      success: true,
      message: 'SIP phone number imported and synced to ElevenLabs successfully',
      data: phoneNumber
    });
  } catch (error) {
    console.error('Import SIP Phone Number Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to import SIP phone number' });
  }
};