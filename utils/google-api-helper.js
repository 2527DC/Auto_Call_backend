'use strict';

const { google } = require('googleapis');
const { db } = require('../models');
const GoogleAccount = db.GoogleAccount;
const UserSettings = db.UserSettings;
const { encrypt } = require('./encryption-utils');
const { decrypt } = require('./encryption-utils');
const axios = require('axios');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email'
];

async function getOAuth2Client(userId) {
  if (!userId) {
    throw new Error('User ID is required to fetch Google OAuth credentials');
  }

  const userSettings = await UserSettings.findOne({ user: userId });
  if (!userSettings || !userSettings.google_client_id || !userSettings.google_client_secret) {
    throw new Error('Google OAuth credentials not configured in user settings');
  }

  return new google.auth.OAuth2(
    userSettings.google_client_id,
    userSettings.google_client_secret,
    userSettings.google_redirect_uri
  );
}

async function getGoogleAccountById(accountId) {
  const account = await GoogleAccount.findById(accountId);
  if (!account || account.deleted_at) {
    throw new Error('Google account not found');
  }
  return account;
}

async function getAuthenticatedClient(googleAccountId) {
  const account = await getGoogleAccountById(googleAccountId);
  const oauth2Client = await getOAuth2Client(account.user_id);

  let accessToken = decrypt(account.access_token);
  const refreshToken = decrypt(account.refresh_token);
  const expiryDate = new Date(account.expires_at).getTime();

  const isExpired = Date.now() >= expiryDate - 5 * 60 * 1000;

  if (isExpired && refreshToken) {
    try {
      const userSettings = await UserSettings.findOne({ user: account.user_id });
      const response = await axios.post('https://oauth2.googleapis.com/token', null, {
        params: {
          grant_type: 'refresh_token',
          client_id: userSettings.google_client_id,
          client_secret: userSettings.google_client_secret,
          refresh_token: refreshToken
        }
      });

      accessToken = response.data.access_token;
      const newExpiryDate = Date.now() + (response.data.expires_in * 1000);

      const update = {
        access_token: encrypt(accessToken),
        expires_at: new Date(newExpiryDate)
      };

      if (response.data.refresh_token) {
        update.refresh_token = encrypt(response.data.refresh_token);
      }

      await GoogleAccount.findByIdAndUpdate(googleAccountId, update);
    } catch (error) {
      console.error('[Google Auth] Token refresh failed:', error.response?.data || error.message);
      throw new Error('Failed to refresh Google token. Please reconnect your account.');
    }
  }

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiryDate
  });

  return oauth2Client;
}

async function getCalendarClient(googleAccountId) {
  const auth = await getAuthenticatedClient(googleAccountId);
  return google.calendar({ version: 'v3', auth });
}

async function getSheetsClient(googleAccountId) {
  const auth = await getAuthenticatedClient(googleAccountId);
  return google.sheets({ version: 'v4', auth });
}

async function getDriveClient(googleAccountId) {
  const auth = await getAuthenticatedClient(googleAccountId);
  return google.drive({ version: 'v3', auth });
}

async function handleGoogleApiError(error, googleAccountId) {
  if (error.code === 401 || error.code === 403) {
    try {
      await GoogleAccount.findByIdAndUpdate(googleAccountId, {
        status: 'expired'
      });
      return true;
    } catch (err) {
      console.error('[Google API] Failed to update account status:', err.message);
    }
  }
  return false;
}

module.exports = {
  SCOPES,
  getOAuth2Client,
  getGoogleAccountById,
  getAuthenticatedClient,
  getCalendarClient,
  getSheetsClient,
  getDriveClient,
  handleGoogleApiError
};
