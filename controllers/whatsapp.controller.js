const { db } = require('../models');
const { WhatsappWaba, WhatsappPhoneNumber, WhatsAppTemplate, UserSettings } = db;
const axios = require('axios');
const whatsappService = require('../services/whatsappService');

const API_VERSION = 'v21.0';

exports.handleEmbeddedSignup = async (req, res) => {
  const userId = req.user._id;
  const { code, data, signupData } = req.body;

  const finalSignupData = data || signupData;

  if (!code || !finalSignupData?.waba_id || !finalSignupData?.phone_number_id) {
    return res.status(400).json({ success: false, error: 'Invalid signup payload' });
  }

  try {
    const userSettings = await UserSettings.findOne({ user: userId }).lean();

    const APP_ID = userSettings?.whatsapp_app_id;
    const APP_SECRET = userSettings?.whatsapp_app_secret;

    if (!APP_ID || !APP_SECRET) {
      return res.status(400).json({ success: false, error: 'Meta App credentials are not configured in User Settings' });
    }

    const tokenRes = await axios.get(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`, {
      params: {
        client_id: APP_ID,
        client_secret: APP_SECRET,
        code
      }
    });

    const accessToken = tokenRes.data.access_token;

    const phoneRes = await axios.get(`https://graph.facebook.com/${API_VERSION}/${finalSignupData.phone_number_id}`, {
      params: { fields: 'display_phone_number,verified_name,quality_rating,status' },
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const phoneData = phoneRes.data;

    let waba = await WhatsappWaba.findOneAndUpdate(
      { whatsapp_business_account_id: finalSignupData.waba_id },
      {
        user_id: userId,
        access_token: accessToken,
        name: phoneData.verified_name || phoneData.display_phone_number,
        status: 'active',
        deleted_at: null
      },
      { upsert: true, new: true }
    );

    await WhatsappPhoneNumber.findOneAndUpdate(
      { whatsapp_phone_number_id: finalSignupData.phone_number_id },
      {
        user_id: userId,
        waba_id: waba._id,
        display_phone_number: phoneData.display_phone_number,
        verified_name: phoneData.verified_name,
        quality_rating: phoneData.quality_rating,
        status: phoneData.status,
        deleted_at: null
      },
      { upsert: true }
    );

    await whatsappService.syncTemplatesFromMeta(userId);

    res.json({ success: true, data: waba });
  } catch (error) {
    console.error('WhatsApp Signup Error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: 'Failed to complete WhatsApp signup' });
  }
};

exports.getPhoneNumbers = async (req, res) => {
  try {
    const phoneNumbers = await WhatsappPhoneNumber.find({ user_id: req.user._id, deleted_at: null }).lean();
    res.json({ success: true, data: phoneNumbers });
  } catch (error) {
    console.error('getPhoneNumbers Error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch phone numbers' });
  }
};

exports.disconnectWaba = async (req, res) => {
  try {
    const userId = req.user._id;
    await WhatsappWaba.updateMany({ user_id: userId, deleted_at: null }, { deleted_at: new Date() });
    await WhatsappPhoneNumber.updateMany({ user_id: userId, deleted_at: null }, { deleted_at: new Date() });

    res.json({ success: true, message: 'WhatsApp Business disconnected successfully' });
  } catch (error) {
    console.error('disconnectWaba Error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to disconnect WhatsApp' });
  }
};

exports.getConnections = async (req, res) => {
  try {
    const connections = await WhatsappWaba.find({ user_id: req.user._id, deleted_at: null }).lean();
    res.json({ success: true, data: connections });
  } catch (error) {
    console.error('getConnections Error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch WhatsApp WABA connections' });
  }
};

exports.getManualConnectDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const waba = await WhatsappWaba.findOne({ user_id: userId, deleted_at: null }).lean();
    
    if (!waba) {
      return res.json({ success: true, data: null });
    }

    const phoneNumber = await WhatsappPhoneNumber.findOne({ 
      user_id: userId, 
      waba_id: waba._id, 
      deleted_at: null 
    }).lean();

    const data = {
      phone_number_id: phoneNumber?.whatsapp_phone_number_id || '',
      waba_id: waba.whatsapp_business_account_id || '',
      business_id: waba.business_id || '',
      registered_phone_number: phoneNumber?.display_phone_number || '',
      access_token: waba.access_token || ''
    };

    res.json({ success: true, data });
  } catch (error) {
    console.error('getManualConnectDetails Error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch manual connect details' });
  }
};

exports.manualConnect = async (req, res) => {
  const userId = req.user._id;
  const { phone_number_id, waba_id, business_id, registered_phone_number, access_token } = req.body;

  if (!phone_number_id || !waba_id || !business_id || !registered_phone_number || !access_token) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }

  try {
    const phoneRes = await axios.get(`https://graph.facebook.com/${API_VERSION}/${phone_number_id}`, {
      params: { fields: 'display_phone_number,verified_name,quality_rating,status' },
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const phoneData = phoneRes.data;

    let waba = await WhatsappWaba.findOneAndUpdate(
      { whatsapp_business_account_id: waba_id },
      {
        user_id: userId,
        business_id: business_id,
        access_token: access_token,
        name: phoneData.verified_name || phoneData.display_phone_number,
        status: 'active',
        deleted_at: null
      },
      { upsert: true, new: true }
    );

    await WhatsappPhoneNumber.findOneAndUpdate(
      { whatsapp_phone_number_id: phone_number_id },
      {
        user_id: userId,
        waba_id: waba._id,
        display_phone_number: registered_phone_number || phoneData.display_phone_number,
        verified_name: phoneData.verified_name,
        quality_rating: phoneData.quality_rating,
        status: phoneData.status,
        deleted_at: null
      },
      { upsert: true }
    );

    await whatsappService.syncTemplatesFromMeta(userId);

    res.json({ success: true, data: waba });
  } catch (error) {
    console.error('WhatsApp Manual Connect Error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: 'Failed to complete manual WhatsApp connection. Please verify your credentials.' });
  }
};

exports.webhook = async (req, res) => {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === (process.env.WHATSAPP_VERIFY_TOKEN)) {
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  try {
    await whatsappService.handleWebhook(req.body);
    res.status(200).end();
  } catch (error) {
    console.error('Webhook Error:', error.message);
    res.status(500).end();
  }
};