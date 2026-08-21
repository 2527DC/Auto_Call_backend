'use strict';

const { db } = require('../models');
const SipTrunk = db.SipTrunk;
const PhoneNumber = db.PhoneNumber;

exports.getSipTrunks = async (req, res) => {
  try {
    const userId = req.user.id;

    let {
      search = '', page = 1, limit = 10, sort_by = 'created_at', sort_order = 'desc', status, provider, engine
    } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    const query = { user_id: userId };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sip_host: { $regex: search, $options: 'i' } },
        { provider: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) query.status = status;
    if (provider) query.provider = provider;
    if (engine) query.engine = engine;

    const allowedSortFields = ['name', 'provider', 'engine', 'status', 'created_at', 'updated_at'];

    const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortDirection = sort_order === 'asc' ? 1 : -1;
    const skip = (page - 1) * limit;

    const [trunks, total] = await Promise.all([
      SipTrunk.find(query).sort({ [sortField]: sortDirection }).skip(skip).limit(limit).lean(),
      SipTrunk.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: trunks,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        has_next_page: page < Math.ceil(total / limit),
        has_prev_page: page > 1
      },
      filters: {
        search,
        status,
        provider,
        engine
      },
      sorting: {
        sort_by: sortField,
        sort_order
      }
    });
  } catch (error) {
    console.error('Get SIP Trunks Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.createSipTrunk = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      name,
      engine,
      provider,
      sip_host,
      port,
      transport,
      username,
      password,
      auth_realm,
      default_caller_id,
      region
    } = req.body;

    if (!name || !sip_host) {
      return res.status(400).json({ success: false, message: 'Name and SIP host are required' });
    }

    if (engine && !['elevenlabs_sip', 'deepgram_sip', 'custom'].includes(engine)) {
      return res.status(400).json({ success: false, message: 'Invalid SIP trunk engine selected.' });
    }

    const existing = await SipTrunk.findOne({ user_id: userId, sip_host });
    if (existing) {
      return res.status(400).json({ success: false, message: 'A SIP trunk with this SIP host already exists' });
    }

    const trunk = await SipTrunk.create({
      name,
      engine: engine || 'elevenlabs_sip',
      provider: provider || 'twilio',
      sip_host,
      port: port || 5061,
      transport: transport || 'tls',
      username: username || null,
      password: password || null,
      auth_realm: auth_realm || null,
      default_caller_id: default_caller_id || null,
      region: region || null,
      user_id: userId
    });

    res.status(201).json({ success: true, message: 'SIP trunk created successfully', data: trunk });
  } catch (error) {
    console.error('Create SIP Trunk Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to create SIP trunk' });
  }
};

exports.updateSipTrunk = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updateData = { ...req.body };

    delete updateData.user_id;

    const query = { _id: id, user_id: userId };
    const trunk = await SipTrunk.findOne(query);

    if (!trunk) {
      return res.status(404).json({ success: false, message: 'SIP trunk not found' });
    }

    if (updateData.engine && !['elevenlabs_sip', 'deepgram_sip', 'custom'].includes(updateData.engine)) {
      return res.status(400).json({ success: false, message: 'Invalid SIP trunk engine selected.' });
    }

    if (updateData.sip_host && updateData.sip_host !== trunk.sip_host) {
      const existing = await SipTrunk.findOne({ user_id: userId, sip_host: updateData.sip_host, _id: { $ne: id } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'A SIP trunk with this SIP host already exists' });
      }
    }

    const updated = await SipTrunk.findOneAndUpdate(
      query,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    res.json({ success: true, message: 'SIP trunk updated successfully', data: updated });
  } catch (error) {
    console.error('Update SIP Trunk Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to update SIP trunk' });
  }
};

exports.deleteSipTrunk = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const query = { _id: id, user_id: userId };
    const trunk = await SipTrunk.findOneAndDelete(query);
    if (!trunk) {
      return res.status(404).json({ success: false, message: 'SIP trunk not found' });
    }

    await PhoneNumber.deleteMany({ sip_trunk_id: id, user_id: userId });

    res.json({ success: true, message: 'SIP trunk deleted successfully' });
  } catch (error) {
    console.error('Delete SIP Trunk Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};