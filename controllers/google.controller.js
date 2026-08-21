'use strict';

const { db } = require('../models');
const GoogleAccount = db.GoogleAccount;
const GoogleCalendar = db.GoogleCalendar;
const GoogleSheet = db.GoogleSheet;
const { getOAuth2Client, SCOPES } = require('../utils/google-api-helper');
const { encrypt } = require('../utils/encryption-utils');
const { google } = require('googleapis');
const axios = require('axios');
const qs = require('querystring');

exports.connect = async (req, res) => {
  try {
    const oauth2Client = await getOAuth2Client(req.user.id);
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES.join(' '),
      prompt: 'consent',
      state: req.user.id,
      include_granted_scopes: true
    });
    console.log(`[Google Connect] Generated Auth URL for User ID: ${req.user.id}`);
    res.json({ success: true, url });
  } catch (error) {
    console.error('Google connect error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate auth URL' });
  }
};

exports.callback = async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Code missing' });
    }

    const userId = state;
    console.log(`[Google Callback] Received callback for User ID: ${userId}`);
    
    const oauth2Client = await getOAuth2Client(userId);
    if (!oauth2Client.redirectUri) {
      throw new Error('google_redirect_uri is not configured in user settings');
    }
    
    const tokenResponse = await axios.post(
      'https://oauth2.googleapis.com/token',
      qs.stringify({
        code,
        client_id: oauth2Client._clientId,
        client_secret: oauth2Client._clientSecret,
        redirect_uri: oauth2Client.redirectUri,
        grant_type: 'authorization_code'
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }}
    );
    
    const tokens = tokenResponse.data;
    oauth2Client.setCredentials(tokens);

    const userInfoResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    
    const email = userInfoResponse.data.email;
    console.log(`[Google Callback] Authenticated email: ${email}`);

    const expiryDate = tokens.expiry_date || (tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null);    
    if (!expiryDate) {
      throw new Error('Token expiry information not provided by Google');
    }

    const googleAccount = await GoogleAccount.findOneAndUpdate(
      { user_id: userId, email },
      {
        access_token: encrypt(tokens.access_token),
        refresh_token: encrypt(tokens.refresh_token),
        expires_at: expiryDate,
        scopes: tokens.scope ? tokens.scope.split(' ') : SCOPES,
        status: 'active',
        deleted_at: null
      },
      { upsert: true, returnDocument: 'after' }
    );

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/toolbox-hub/google-workspace?success=true`);
  } catch (error) {
    console.error('Google callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/toolbox-hub/google-workspace?success=false&message=${encodeURIComponent(error.message)}`);
  }
};

exports.listAccounts = async (req, res) => {
  try {
    const accounts = await GoogleAccount.find({ user_id: req.user.id, deleted_at: null })
      .select('email status created_at')
      .lean();

    res.json({ success: true, accounts });
  } catch (error) {
    console.error('List Google accounts error:', error);
    res.status(500).json({ success: false, message: 'Failed to list accounts' });
  }
};

exports.disconnectAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const account = await GoogleAccount.findOneAndUpdate(
      { _id: id, user_id: req.user.id },
      { deleted_at: new Date(), status: 'inactive' }
    );

    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    await GoogleCalendar.updateMany({ google_account_id: id }, { deleted_at: new Date() });
    await GoogleSheet.updateMany({ google_account_id: id }, { deleted_at: new Date() });

    res.json({ success: true, message: 'Account disconnected successfully' });
  } catch (error) {
    console.error('Disconnect Google account error:', error);
    res.status(500).json({ success: false, message: 'Failed to disconnect account' });
  }
};