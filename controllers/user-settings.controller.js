'use strict';

const { db } = require('../models');
const UserSettings = db.UserSettings;

const sanitizeClientId = (val) => {
  if (!val) return val;
  return val.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
};

const sanitizeSecret = (val) => {
  if (!val) return val;
  if (val.length <= 4) return '*'.repeat(val.length);
  return '*'.repeat(val.length - 4) + val.slice(-4);
};

const isMasked = (val) => {
  return typeof val === 'string' && /^\*+/.test(val);
};

exports.updateUserSetting = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      elevenlabs_api_key,
      deepgram_api_key,
      sarvam_ai_api_key,
      twilio_account_sid,
      twilio_auth_token,
      twilio_api_key,
      twilio_api_secret,
      twilio_app_sid,
      plivo_auth_id,
      plivo_auth_token,
      plivo_app_id,
      ai_model,
      ai_api_key,
      openai_api_key,
      google_client_id,
      google_client_secret,
      google_redirect_uri,
      facebook_app_id,
      facebook_app_secret,
      facebook_redirect_uri,
      email_provider,
      email_from_name,
      email_from_email,
      email_config,
      post_call_channel,
      post_call_email_template,
      post_call_whatsapp_template,
      whatsapp_app_id,
      whatsapp_app_secret,
      configuration_id
    } = req.body;

    let userSettings = await UserSettings.findOne({ user: userId });
    if (!userSettings) {
      userSettings = new UserSettings({ user: userId });
    }

    if (elevenlabs_api_key !== undefined && !isMasked(elevenlabs_api_key)) userSettings.elevenlabs_api_key = elevenlabs_api_key;
    if (deepgram_api_key !== undefined && !isMasked(deepgram_api_key)) userSettings.deepgram_api_key = deepgram_api_key;
    if (sarvam_ai_api_key !== undefined && !isMasked(sarvam_ai_api_key)) userSettings.sarvam_ai_api_key = sarvam_ai_api_key;
    if (twilio_account_sid !== undefined) userSettings.twilio_account_sid = twilio_account_sid;
    if (twilio_auth_token !== undefined && !isMasked(twilio_auth_token)) userSettings.twilio_auth_token = twilio_auth_token;
    if (twilio_api_key !== undefined && !isMasked(twilio_api_key)) userSettings.twilio_api_key = twilio_api_key;
    if (twilio_api_secret !== undefined && !isMasked(twilio_api_secret)) userSettings.twilio_api_secret = twilio_api_secret;
    if (twilio_app_sid !== undefined) userSettings.twilio_app_sid = twilio_app_sid;
    if (plivo_auth_id !== undefined) userSettings.plivo_auth_id = plivo_auth_id;
    if (plivo_auth_token !== undefined && !isMasked(plivo_auth_token)) userSettings.plivo_auth_token = plivo_auth_token;
    if (plivo_app_id !== undefined) userSettings.plivo_app_id = plivo_app_id;
    if (ai_model !== undefined) userSettings.ai_model = ai_model;
    if (ai_api_key !== undefined && !isMasked(ai_api_key)) userSettings.ai_api_key = ai_api_key;
    if (openai_api_key !== undefined && !isMasked(openai_api_key)) userSettings.openai_api_key = openai_api_key;

    if (google_client_id !== undefined) userSettings.google_client_id = sanitizeClientId(google_client_id);
    if (google_client_secret !== undefined && !isMasked(google_client_secret)) userSettings.google_client_secret = google_client_secret?.trim();
    if (google_redirect_uri !== undefined) userSettings.google_redirect_uri = google_redirect_uri?.trim().replace(/\/+$/, '');

    if (facebook_app_id !== undefined) userSettings.facebook_app_id = sanitizeClientId(facebook_app_id);
    if (facebook_app_secret !== undefined && !isMasked(facebook_app_secret)) userSettings.facebook_app_secret = facebook_app_secret?.trim();
    if (facebook_redirect_uri !== undefined) userSettings.facebook_redirect_uri = facebook_redirect_uri?.trim().replace(/\/+$/, '');

    if (email_provider !== undefined) userSettings.email_provider = email_provider;
    if (email_from_name !== undefined) userSettings.email_from_name = email_from_name;
    if (email_from_email !== undefined) userSettings.email_from_email = email_from_email;
    if (email_config !== undefined) {
      userSettings.email_config = {
        ...(userSettings.email_config || {}),
        ...email_config
      };
    }
    if (post_call_channel !== undefined) userSettings.post_call_channel = post_call_channel;
    if (post_call_email_template !== undefined) userSettings.post_call_email_template = post_call_email_template;
    if (post_call_whatsapp_template !== undefined) userSettings.post_call_whatsapp_template = post_call_whatsapp_template;
    if (whatsapp_app_id !== undefined) userSettings.whatsapp_app_id = whatsapp_app_id;
    if (whatsapp_app_secret !== undefined && !isMasked(whatsapp_app_secret)) userSettings.whatsapp_app_secret = whatsapp_app_secret;
    if (configuration_id !== undefined) userSettings.configuration_id = configuration_id;

    await userSettings.save();

    res.status(200).json({
      success: true,
      message: 'User settings updated successfully',
      data: userSettings
    });
  } catch (error) {
    console.error('Error updating user settings:', error);
    res.status(500).json({ success: false, message: 'Failed to update user settings' });
  }
};

exports.getUserSetting = async (req, res) => {
  try {
    const userId = req.user.id;
    const userSettings = await UserSettings.findOne({ user: userId })
      .populate('ai_model');

    if (!userSettings) {
      return res.status(200).json({ success: true, data: null });
    }

    const googleStatus = {
      credentials_saved: !!(userSettings.google_client_id && userSettings.google_client_secret && userSettings.google_redirect_uri)
    };

    const settingsObj = userSettings.toObject();

    if (settingsObj.ai_api_key) settingsObj.ai_api_key = sanitizeSecret(settingsObj.ai_api_key);
    if (settingsObj.elevenlabs_api_key) settingsObj.elevenlabs_api_key = sanitizeSecret(settingsObj.elevenlabs_api_key);
    if (settingsObj.deepgram_api_key) settingsObj.deepgram_api_key = sanitizeSecret(settingsObj.deepgram_api_key);
    if (settingsObj.sarvam_ai_api_key) settingsObj.sarvam_ai_api_key = sanitizeSecret(settingsObj.sarvam_ai_api_key);
    if (settingsObj.openai_api_key) settingsObj.openai_api_key = sanitizeSecret(settingsObj.openai_api_key);
    if (settingsObj.twilio_auth_token) settingsObj.twilio_auth_token = sanitizeSecret(settingsObj.twilio_auth_token);
    if (settingsObj.twilio_api_key) settingsObj.twilio_api_key = sanitizeSecret(settingsObj.twilio_api_key);
    if (settingsObj.twilio_api_secret) settingsObj.twilio_api_secret = sanitizeSecret(settingsObj.twilio_api_secret);
    if (settingsObj.plivo_auth_token) settingsObj.plivo_auth_token = sanitizeSecret(settingsObj.plivo_auth_token);
    if (settingsObj.google_client_secret) settingsObj.google_client_secret = sanitizeSecret(settingsObj.google_client_secret);
    if (settingsObj.facebook_app_secret) settingsObj.facebook_app_secret = sanitizeSecret(settingsObj.facebook_app_secret);
    if (settingsObj.whatsapp_app_secret) settingsObj.whatsapp_app_secret = sanitizeSecret(settingsObj.whatsapp_app_secret);

    res.status(200).json({
      success: true,
      data: {
        ...settingsObj,
        google_status: googleStatus
      }
    });
  } catch (error) {
    console.error('Error getting user settings:', error);
    res.status(500).json({ success: false, message: 'Failed to get user settings' });
  }
};