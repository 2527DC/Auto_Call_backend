'use strict';

const twilio = require('twilio');
const plivo = require('plivo');
const { db } = require('../models');
const UserSettings = db.UserSettings;
const PhoneNumber = db.PhoneNumber;
const Call = db.Call;
const User = db.User;
const Campaign = db.Campaign;
const SMSCampaign = db.SMSCampaign;
const creditService = require('../services/creditService');

exports.generateToken = async (req, res) => {
  try {
    const userId = req.user.id;
    const { phoneNumberId } = req.body;

    if (!phoneNumberId) {
      return res.status(400).json({ success: false, message: 'phoneNumberId is required' });
    }

    const numberRecord = await PhoneNumber.findOne({
      _id: phoneNumberId,
      $or: [
        { user_id: userId },
        { is_system_pool: true },
        { user_id: null }
      ]
    });

    if (!numberRecord) {
      return res.status(404).json({ success: false, message: 'Phone number not found' });
    }

    const settings = await UserSettings.findOne({ user: userId });
    if (!settings) {
      return res.status(400).json({ success: false, message: 'User settings not found' });
    }

    const existCampaign = await Campaign.findOne({
      phoneNumberId,
      campaignStatus: { $nin: ['Completed', 'Failed', 'Cancelled'] }
    });
    if (existCampaign) {
      return res.status(400).json({ success: false, message: `This phone number is currently in use by a Voice Campaign (${existCampaign.name}) and cannot be used in the Virtual Phone.` });
    }

    const existSMSCampaign = await SMSCampaign.findOne({
      phoneNumberId,
      status: { $nin: ['Completed', 'Failed', 'Cancelled'] }
    });
    if (existSMSCampaign) {
      return res.status(400).json({ success: false, message: `This phone number is currently in use by an SMS Campaign (${existSMSCampaign.name}) and cannot be used in the Virtual Phone.` });
    }

    if (numberRecord.provider === 'twilio') {
      const accountSid = settings.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID;
      const apiKey = settings.twilio_api_key || process.env.TWILIO_API_KEY;
      const apiSecret = settings.twilio_api_secret || process.env.TWILIO_API_SECRET;
      const appSid = settings.twilio_app_sid || process.env.TWILIO_APP_SID;

      if (!accountSid || !apiKey || !apiSecret || !appSid) {
        return res.status(400).json({ success: false, message: 'Twilio API Key, Secret, or App SID missing' });
      }

      const AccessToken = twilio.jwt.AccessToken;
      const VoiceGrant = AccessToken.VoiceGrant;

      const token = new AccessToken(accountSid, apiKey, apiSecret, { identity: `user_${userId}` });
      const voiceGrant = new VoiceGrant({
        outgoingApplicationSid: appSid,
        incomingAllow: true,
      });
      token.addGrant(voiceGrant);

      return res.json({ success: true, provider: 'twilio', token: token.toJwt(), number: numberRecord.phone_number });
    } else if (numberRecord.provider === 'plivo') {
      const authId = settings.plivo_auth_id || process.env.PLIVO_AUTH_ID;
      const authToken = settings.plivo_auth_token || process.env.PLIVO_AUTH_TOKEN;

      if (!authId || !authToken) {
        return res.status(400).json({ success: false, message: 'Plivo credentials missing' });
      }

      const appId = settings.plivo_app_id || process.env.PLIVO_APP_ID;
      const endpointUsername = `u${userId}`;
      

      let client = new plivo.Client(authId, authToken);
      let realUsername = null;
      try {
        const createRes = await client.endpoints.create(endpointUsername, 'dialer@123', endpointUsername, appId);
        realUsername = createRes.username;
      } catch (err) {
        console.warn('Could not create endpoint, fetching existing...', err.message);
        try {
          const listRes = await client.endpoints.list();
          const endpointList = Array.isArray(listRes) ? listRes : (listRes.objects || listRes.endpoints || []);
          const existing = endpointList.find(e => e.alias === endpointUsername);
          if (existing) {
            realUsername = existing.username;
          } else {
            return res.status(500).json({ success: false, message: 'Could not resolve Plivo endpoint' });
          }
        } catch (listErr) {
          console.error('Failed to list endpoints', listErr);
          return res.status(500).json({ success: false, message: 'Could not retrieve Plivo endpoints' });
        }
      }

      return res.json({
        success: true,
        provider: 'plivo',
        username: realUsername,
        password: 'dialer@123',
        number: numberRecord.phone_number
      });
    }

    return res.status(400).json({ success: false, message: 'Unsupported provider' });
  } catch (error) {
    console.error('Generate Token Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.handleOutboundWebhook = async (req, res) => {
  try {
    let { From, To } = req.body;
    
    // Helper to get case-insensitive header from Plivo req.body
    const getHeader = (key) => {
      const lowerKey = key.toLowerCase();
      const foundKey = Object.keys(req.body).find(k => k.toLowerCase() === lowerKey);
      return foundKey ? req.body[foundKey] : undefined;
    };

    let callerId = req.body.callerId || getHeader('X-PH-callerId');
    
    // Plivo SDK sends To as a SIP URI (e.g. sip:1234@phone.plivo.com). We need to extract the raw number.
    To = getHeader('X-PH-To') || To;
    if (To && To.startsWith('sip:')) {
      To = To.split('@')[0].replace('sip:', '');
    }
    const provider = req.body.provider || getHeader('X-PH-provider');
    const record = req.body.record || getHeader('X-PH-record');

    // Ensure To and callerId are properly formatted with + if they are just digits
    if (callerId && /^\d+$/.test(callerId)) {
      callerId = '+' + callerId;
    }
    if (To && /^\d+$/.test(To)) {
      To = '+' + To;
    }

    let userId = req.query.userId;
    if (!userId) {
      if ((provider === 'twilio' || !provider) && req.body.Caller && req.body.Caller.includes('user_')) {
        userId = req.body.Caller.split('user_')[1];
      } else if (provider === 'plivo' && req.body.From && req.body.From.startsWith('u')) {
        userId = req.body.From.substring(1, 25);
      }
    }

    if (userId) {
      const user = await User.findById(userId).populate('roleId');
      const isAdmin = user && user.roleId && (user.roleId.name === 'super_admin' || user.roleId.name === 'admin');

      if (!isAdmin) {
        const balance = await creditService.getCreditBalance(userId);
        if (balance <= 0) {
          return res.status(402).send('Insufficient credits');
        }
      }

      const callSid = req.body.CallSid || req.body.CallUUID || `webdialer_${Date.now()}`;
      try {
        await Call.create({
          user_id: userId,
          twilio_call_sid: callSid,
          from_number: callerId || From,
          to_number: To,
          status: 'initiated',
          direction: 'outbound'
        });
      } catch (err) {
        console.error('Failed to create call log:', err.message);
      }
    }

    if (provider === 'twilio' || !provider) {
      const twiml = new twilio.twiml.VoiceResponse();
      const dialOpts = { callerId: callerId || From, answerOnBridge: true };
      
      if (record === 'true') {
        dialOpts.record = 'record-from-answer';
        dialOpts.recordingStatusCallback = `${process.env.APP_URL}/api/calls/recording-callback`;
        dialOpts.recordingStatusCallbackEvent = 'completed';
      }
      
      const dial = twiml.dial(dialOpts);
      
      dial.number({
        statusCallbackEvent: 'initiated ringing answered completed',
        statusCallback: `${process.env.APP_URL}/api/calls/status`,
        statusCallbackMethod: 'POST'
      }, To);
      
      res.type('text/xml');
      return res.send(twiml.toString());
    } else if (provider === 'plivo') {
      const plivoRecord = record === 'true' ? 'record="true"' : '';
      const plivoCallback = `callbackUrl="${process.env.APP_URL}/api/calls/plivo-status" callbackMethod="POST"`;

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId || From}" ${plivoRecord} ${plivoCallback}>
    <Number>${To}</Number>
  </Dial>
</Response>`;
      console.log('Plivo XML generated:', xml);
      res.type('text/xml');
      return res.send(xml);
    }

    return res.status(400).send('Invalid provider');
  } catch (error) {
    console.error('Outbound Webhook Error:', error);
    res.status(500).send('Internal Server Error');
  }
};
