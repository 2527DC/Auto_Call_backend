'use strict';

const { db } = require('../models');
const GoogleSheet = db.GoogleSheet;
const { getAuthenticatedClient, handleGoogleApiError } = require('../utils/google-api-helper');
const axios = require('axios');

exports.createGoogleSheet = async (req, res) => {
  try {
    const userId = req.user.id;
    const { google_account_id, name, spreadsheet_id, sheet_name, range, headers, is_active, description, create_in_google } = req.body;

    if (!google_account_id) {
      return res.status(400).json({ success: false, message: 'google_account_id is required' });
    }

    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    let finalSpreadsheetId = '';

    if (create_in_google) {
      try {
        const authClient = await getAuthenticatedClient(google_account_id);
        const { token: accessToken } = await authClient.getAccessToken();

        const sheetName = sheet_name || 'Sheet1';

        const response = await axios.post(
          'https://sheets.googleapis.com/v4/spreadsheets',
          { 
            properties: { title: name },
            sheets: [
              { properties: { title: sheetName } }
            ]
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        finalSpreadsheetId = response.data.spreadsheetId;

        if (headers && Array.isArray(headers) && headers.length > 0) {
          const headerValues = [headers];

          await axios.put(
            `https://sheets.googleapis.com/v4/spreadsheets/${finalSpreadsheetId}/values/${sheetName}!A1:Z1`,
            {
              values: headerValues,
              majorDimension: 'ROWS'
            },
            {
              params: {
                valueInputOption: 'RAW'
              },
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              }
            }
          );
        }
      } catch (error) {
        const wasHandled = await handleGoogleApiError(error, google_account_id);
        const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
        return res.status(500).json({ success: false, message });
      }
    }

    const sheet = await GoogleSheet.create({
      user_id: userId,
      google_account_id,
      name,
      spreadsheet_id: finalSpreadsheetId,
      sheet_name: sheet_name || 'Sheet1',
      range: range || 'A:E',
      headers: headers || ['Name', 'Phone', 'Date', 'Time', 'Status'],
      is_active: is_active !== undefined ? is_active : true,
      is_linked: Boolean(create_in_google),
      description: description || ''
    });

    res.status(201).json({ success: true, message: 'Google Sheet added successfully', data: sheet });
  } catch (error) {
    console.error('Create Google Sheet Error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to create Google Sheet' });
  }
};



exports.getGoogleSheets = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      search,
      name,
      spreadsheet_id,
      sheet_name,
      is_active,
      sort_by = 'created_at',
      sort_order = 'desc',
      page = 1,
      limit = 10
    } = req.query;

    const query = { user_id: userId, deleted_at: null };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { spreadsheet_id: { $regex: search, $options: 'i' } },
        { sheet_name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    if (name) query.name = { $regex: name, $options: 'i' };
    if (spreadsheet_id) query.spreadsheet_id = spreadsheet_id;
    if (sheet_name) query.sheet_name = { $regex: sheet_name, $options: 'i' };
    if (is_active !== undefined) query.is_active = is_active === 'true';

    const sortOptions = {};
    const allowedSortFields = ['name', 'spreadsheet_id', 'sheet_name', 'is_active', 'created_at', 'updated_at', 'last_synced_at'];

    if (allowedSortFields.includes(sort_by)) {
      sortOptions[sort_by] = sort_order === 'asc' ? 1 : -1;
    } else {
      sortOptions.created_at = -1;
    }

    const total = await GoogleSheet.countDocuments(query);
    const sheets = await GoogleSheet.find(query)
      .sort(sortOptions)
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: sheets,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    console.error('Get Google Sheets Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};



exports.deleteGoogleSheet = async (req, res) => {
  try {
    const { id } = req.params;
    const { delete_from } = req.query;
    const userId = req.user.id;

    const sheet = await GoogleSheet.findOne({ _id: id, user_id: userId, deleted_at: null });
    if (!sheet) {
      return res.status(404).json({ success: false, message: 'Google Sheet not found' });
    }

    if (delete_from === 'google' && sheet.is_linked) {
      try {
        const authClient = await getAuthenticatedClient(sheet.google_account_id);
        const { token: accessToken } = await authClient.getAccessToken();

        await axios.patch(
          `https://www.googleapis.com/drive/v3/files/${sheet.spreadsheet_id}`,
          { trashed: true },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (error) {
        const wasHandled = await handleGoogleApiError(error, sheet.google_account_id);
        const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
        return res.status(500).json({ success: false, message });
      }
    }

    sheet.deleted_at = new Date();
    sheet.is_active = false;
    await sheet.save();

    res.json({
      success: true,
      message: delete_from === 'google'
        ? 'Sheet deleted from both Google Drive and Platform'
        : 'Sheet removed from Platform only'
    });
  } catch (error) {
    console.error('Delete Google Sheet Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.bulkDeleteGoogleSheets = async (req, res) => {
  try {
    const { ids, delete_from } = req.body;
    const userId = req.user.id;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'IDs array is required' });
    }

    const results = { success: [], failed: [] };

    for (const id of ids) {
      try {
        const sheet = await GoogleSheet.findById(id);
        if (!sheet || sheet.user_id.toString() !== userId.toString()) {
          results.failed.push({ id, message: 'Sheet not found' });
          continue;
        }

        if (delete_from === 'google' && sheet.is_linked) {
          try {
            const authClient = await getAuthenticatedClient(sheet.google_account_id);
            const { token: accessToken } = await authClient.getAccessToken();

            await axios.patch(
              `https://www.googleapis.com/drive/v3/files/${sheet.spreadsheet_id}`,
              { trashed: true },
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json'
                }
              }
            );
          } catch (error) {
            console.error(`Failed to delete sheet ${id} from Google:`, error.message);
          }
        }

        sheet.deleted_at = new Date();
        sheet.is_active = false;
        await sheet.save();
        results.success.push(id);
      } catch (err) {
        results.failed.push({ id, message: err.message });
      }
    }

    res.json({
      success: true,
      message: `Successfully deleted ${results.success.length} sheets`,
      results
    });
  } catch (error) {
    console.error('Bulk Delete Google Sheets Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.syncSheets = async (req, res) => {
  try {
    const userId = req.user.id;
    const { google_account_id, sheets } = req.body;

    if (!google_account_id) {
      return res.status(400).json({ success: false, message: 'google_account_id is required' });
    }

    if (!sheets || !Array.isArray(sheets) || sheets.length === 0) {
      const authClient = await getAuthenticatedClient(google_account_id);
      const { token: accessToken } = await authClient.getAccessToken();

      const response = await axios.get(
        'https://www.googleapis.com/drive/v3/files',
        {
          params: {
            q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
            fields: 'files(id, name)'
          },
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );
      return res.json({ success: true, mode: 'list', sheets: response.data.files });
    }

    const syncedSheets = [];
    for (const sheet of sheets) {
      const updatedSheet = await GoogleSheet.findOneAndUpdate(
        { google_account_id, spreadsheet_id: sheet.id, user_id: userId, },
        {
          name: sheet.name,
          deleted_at: null,
          is_linked: true
        },
        { upsert: true, new: true }
      );
      syncedSheets.push(updatedSheet);
    }

    res.json({
      success: true,
      mode: 'sync',
      message: `${syncedSheets.length} sheets synced successfully`,
      sheets: syncedSheets
    });
  } catch (error) {
    console.error('Google Sheets sync error:', error.response?.data || error.message);
    const wasHandled = await handleGoogleApiError(error, req.body.google_account_id);
    const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
    res.status(500).json({ success: false, message });
  }
};

exports.linkGoogleSheet = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const sheet = await GoogleSheet.findOne({ _id: id, user_id: userId, deleted_at: null });
    if (!sheet) {
      return res.status(404).json({ success: false, message: 'Google Sheet not found' });
    }

    if (sheet.is_linked) {
      return res.status(400).json({ success: false, message: 'Sheet is already linked' });
    }

    const authClient = await getAuthenticatedClient(sheet.google_account_id);
    const { token: accessToken } = await authClient.getAccessToken();

    const response = await axios.post(
      'https://sheets.googleapis.com/v4/spreadsheets',
      { properties: { title: sheet.name } },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const spreadsheetId = response.data.spreadsheetId;

    if (sheet.headers && Array.isArray(sheet.headers) && sheet.headers.length > 0) {
      const headerValues = [sheet.headers];
      const sheetName = sheet.sheet_name || 'Sheet1';

      await axios.put(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:Z1`,
        {
          values: headerValues,
          majorDimension: 'ROWS'
        },
        {
          params: { valueInputOption: 'RAW' },
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    sheet.spreadsheet_id = spreadsheetId;
    sheet.is_linked = true;
    await sheet.save();

    res.json({
      success: true,
      message: 'Sheet linked successfully',
      data: sheet
    });
  } catch (error) {
    console.error('Link Google Sheet error:', error.response?.data || error.message);
    let message = 'Failed to link sheet';
    if (error.response?.data?.error?.message) {
      message = error.response.data.error.message;
    }
    res.status(500).json({ success: false, message });
  }
};

exports.readSheet = async (req, res) => {
  try {
    const { sheet_id } = req.params;
    const { range } = req.query;
    const userId = req.user.id;

    const sheet = await GoogleSheet.findOne({
      _id: sheet_id,
      user_id: userId,
      deleted_at: null
    });

    if (!sheet) {
      return res.status(404).json({ success: false, message: 'Sheet not found' });
    }

    const authClient = await getAuthenticatedClient(sheet.google_account_id);
    const { token: accessToken } = await authClient.getAccessToken();

    const response = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheet_id}/values/${range || 'A1:Z100'}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    res.json({
      success: true,
      range: response.data.range,
      majorDimension: response.data.majorDimension,
      values: response.data.values || []
    });
  } catch (error) {
    console.error('Read Google Sheet Error:', error);
    const wasHandled = await handleGoogleApiError(error, req.params.sheet_id);
    const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
    res.status(500).json({ success: false, message });
  }
};

exports.writeSheet = async (req, res) => {
  try {
    const { sheet_id } = req.params;
    const userId = req.user.id;
    const { range, values, valueInputOption = 'RAW', majorDimension = 'ROWS' } = req.body;

    if (!range || !values || !Array.isArray(values)) {
      return res.status(400).json({
        success: false,
        message: 'range and values (array) are required'
      });
    }

    if (!['ROWS', 'COLUMNS'].includes(majorDimension)) {
      return res.status(400).json({
        success: false,
        message: 'majorDimension must be either ROWS or COLUMNS'
      });
    }

    const sheet = await GoogleSheet.findOne({
      _id: sheet_id,
      user_id: userId,
      deleted_at: null
    });

    if (!sheet) {
      return res.status(404).json({ success: false, message: 'Sheet not found' });
    }

    const authClient = await getAuthenticatedClient(sheet.google_account_id);
    const { token: accessToken } = await authClient.getAccessToken();

    let formattedRange = range;
    if (!range.includes('!')) {
      formattedRange = `${sheet.sheet_name}!${range}`;
    }

    if (values && values.length > 0) {
      const maxColumns = Math.max(...values.map(row => row.length));
      if (maxColumns > 0) {
        const rangeParts = formattedRange.split('!');
        const sheetName = rangeParts[0];
        const cellRange = rangeParts[1] || range;

        const columnMatch = cellRange.match(/^([A-Z]+)\d*:([A-Z]+)\d*$/);
        if (columnMatch) {
          const startCol = columnMatch[1];
          const startRow = cellRange.match(/^([A-Z]+)(\d*)/)?.[2] || '1';

          const startColNum = startCol.split('').reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0);
          const endColNum = startColNum + maxColumns - 1;
          let endCol = '';
          let temp = endColNum;
          while (temp > 0) {
            temp--;
            endCol = String.fromCharCode(65 + (temp % 26)) + endCol;
            temp = Math.floor(temp / 26);
          }

          formattedRange = `${sheetName}!${startCol}${startRow}:${endCol}`;
        }
      }
    }

    const response = await axios.put(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheet_id}/values/${formattedRange}`,
      {
        values: values,
        majorDimension: majorDimension
      },
      {
        params: {
          valueInputOption: valueInputOption
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      message: 'Sheet updated successfully',
      response: response.data
    });
  } catch (error) {
    console.error('Write Google Sheet Error:', error);
    const wasHandled = await handleGoogleApiError(error, req.params.sheet_id);
    const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
    res.status(500).json({ success: false, message });
  }
};

exports.appendSheet = async (req, res) => {
  try {
    const { sheet_id } = req.params;
    const userId = req.user.id;
    const { values, valueInputOption = 'RAW' } = req.body;

    if (!values || !Array.isArray(values)) {
      return res.status(400).json({
        success: false,
        message: 'values (array) is required'
      });
    }

    const sheet = await GoogleSheet.findOne({
      _id: sheet_id,
      user_id: userId,
      deleted_at: null
    });

    if (!sheet) {
      return res.status(404).json({ success: false, message: 'Sheet not found' });
    }

    const authClient = await getAuthenticatedClient(sheet.google_account_id);
    const { token: accessToken } = await authClient.getAccessToken();

    const response = await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheet_id}/values/${sheet.range || 'A:E'}:append`,
      {
        values: values,
        majorDimension: 'ROWS'
      },
      {
        params: {
          valueInputOption: valueInputOption,
          insertDataOption: 'INSERT_ROWS'
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      message: 'Data appended to sheet successfully',
      response: response.data
    });
  } catch (error) {
    console.error('Append Google Sheet Error:', error);
    const wasHandled = await handleGoogleApiError(error, req.params.sheet_id);
    const message = wasHandled ? 'Google account unauthorized or expired. Please reconnect.' : error.response?.data?.error?.message || error.message;
    res.status(500).json({ success: false, message });
  }
};