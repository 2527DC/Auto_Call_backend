'use strict';

const { db } = require('../models');
const Template = db.WhatsAppTemplate;
const WhatsappWaba = db.WhatsappWaba;
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const templateHelper = require('../utils/whatsapp-template-helper');

const API_VERSION = 'v21.0';

exports.createTemplate = async (req, res) => {
  try {
    let {
      waba_id,
      template_name,
      language = 'en_US',
      message_body,
      footer_text,
      variable_examples,
      variables_example,
    } = req.body;

    let rawVars = variable_examples || variables_example || {};
    if (typeof rawVars === 'string') {
      try {
        rawVars = JSON.parse(rawVars);
      } catch (e) {
        console.error('Error parsing variables:', e);
      }
    }

    const processedVariableExamples = {};
    if (Array.isArray(rawVars)) {
      rawVars.forEach((v) => {
        if (v && v.key) processedVariableExamples[v.key] = v.example;
      });
    } else if (typeof rawVars === 'object' && rawVars !== null) {
      Object.assign(processedVariableExamples, rawVars);
    }

    const userId = req.user.id;

    if (!waba_id) {
      return res.status(400).json({ message: 'WABA ID is required' });
    }

    const waba = await WhatsappWaba.findOne({
      _id: waba_id,
      user_id: userId,
      deleted_at: null,
    });
    if (!waba) {
      return res.status(404).json({ message: 'WhatsApp WABA not found' });
    }

    waba_id = waba._id.toString();
    const { access_token, whatsapp_business_account_id, app_id } = waba;

    const uploadedFile = req.file || (req.files && req.files.file && req.files.file[0]);
    let header = null;

    if (uploadedFile) {
      let buffer = uploadedFile.buffer;
      if (!buffer && uploadedFile.path) {
        try {
          if (uploadedFile.path.startsWith('http')) {
            const response = await axios.get(uploadedFile.path, { responseType: 'arraybuffer' });
            buffer = Buffer.from(response.data);
          } else {
            buffer = fs.readFileSync(path.join(process.cwd(), uploadedFile.path));
          }
        } catch (err) {
          console.error('[TemplateController] Error reading uploaded file:', err.message);
        }
      }

      if (buffer) {
        const handle = await templateHelper.uploadSampleMediaForTemplate({
          app_id: app_id,
          access_token,
          file_name: uploadedFile.originalname,
          file_size: uploadedFile.size,
          mime_type: uploadedFile.mimetype,
          buffer: buffer,
        });

        const mediaType = templateHelper.getWhatsAppTypeFromMime(uploadedFile.mimetype);
        const localUrl = await templateHelper.saveBufferLocally(buffer, uploadedFile.mimetype, mediaType, userId);

        header = {
          format: 'media',
          media_type: mediaType,
          media_url: localUrl,
          handle: handle,
        };
      }
    }
    if (req.body.header_text && !header) {
      header = {
        format: 'text',
        text: req.body.header_text,
      };
    }

    const extractedVariables = templateHelper.extractVariables(message_body);
    const bodyVariables = extractedVariables.map((v) => ({
      key: v.key,
      example: processedVariableExamples[v.key] || 'example',
    }));

    const createdTemplate = await Template.create({
      user_id: userId,
      waba_id: waba_id,
      template_name: template_name.toLowerCase(),
      language,
      category: 'UTILITY',
      header,
      message_body: message_body,
      body_variables: bodyVariables,
      footer_text,
      status: 'draft',
    });

    try {
      const metaPayload = templateHelper.buildMetaTemplatePayload(createdTemplate);
      const metaResponse = await templateHelper.submitTemplateToMeta(metaPayload, waba.whatsapp_business_account_id, waba.access_token);

      await Template.findByIdAndUpdate(createdTemplate._id, {
        status: metaResponse.status?.toLowerCase(),
        meta_template_id: metaResponse.id || metaResponse.name,
      });

    } catch (error) {
      await Template.findByIdAndDelete(createdTemplate._id);
      throw error;
    }

    const finalTemplate = await Template.findById(createdTemplate._id).select('-__v').populate('waba_id').lean();
    return res.status(201).json({
      message: 'Template submitted',
      template_id: createdTemplate._id,
      data: finalTemplate,
    });
  } catch (error) {
    console.error('Error creating template:', error);
    return res.status(400).json({
      message: error.response?.data?.error?.error_user_msg || error.message,
      error: error.response?.data?.error?.error_user_msg || error.message,
    });
  }
};

exports.getAllTemplates = async (req, res) => {
  try {
    const userId = req.user.id;
    const { waba_id, status, search } = req.query;

    if (!waba_id) {
      return res.status(400).json({ message: 'WABA ID is required' });
    }

    const waba = await WhatsappWaba.findOne({
      _id: waba_id,
      user_id: userId,
      deleted_at: null,
    });
    if (!waba) {
      return res.status(404).json({ message: 'WhatsApp WABA not found' });
    }

    const filter = {
      user_id: userId,
      waba_id: waba_id,
      deleted_at: null
    };

    if (status) {
      filter.status = status;
    }

    if (search) {
      filter.$or = [
        { template_name: { $regex: search, $options: 'i' } },
        { status: { $regex: search, $options: 'i' } },
      ];
    }

    const templates = await Template.find(filter).sort({ created_at: -1 }).select('-__v').populate('waba_id').lean();

    return res.json({
      success: true,
      count: templates.length,
      data: templates,
    });
  } catch (error) {
    console.error('Error getting templates:', error);
    return res.status(500).json({ success: false, message: 'Failed to get templates', details: error.message, });
  }
};

exports.getTemplateById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const template = await Template.findOne({
      _id: id,
      user_id: userId,
      deleted_at: null,
    }).select('-__v').populate('waba_id').lean();

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found', });
    }

    return res.json({ success: true, data: template, });
  } catch (error) {
    console.error('Error getting template:', error);
    return res.status(500).json({ success: false, message: 'Failed to get template', details: error.message, });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.body) {
      return res.status(400).json({ message: 'Request body is missing' });
    }

    let {
      template_name,
      language,
      message_body,
      footer_text,
      variable_examples,
      variables_example,
      header_text,
    } = req.body;

    let rawVars = variable_examples || variables_example || {};
    if (typeof rawVars === 'string') {
      try {
        rawVars = JSON.parse(rawVars);
      } catch (e) {
        console.error('Error parsing variables:', e);
        rawVars = {};
      }
    }

    const processedVariableExamples = {};
    if (Array.isArray(rawVars)) {
      rawVars.forEach((v) => {
        if (v && v.key) processedVariableExamples[v.key] = v.example;
      });
    } else if (typeof rawVars === 'object' && rawVars !== null) {
      Object.assign(processedVariableExamples, rawVars);
    }

    const userId = req.user.id;

    const template = await Template.findOne({
      _id: id,
      user_id: userId,
      deleted_at: null,
    });

    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }

    const waba = await WhatsappWaba.findOne({
      _id: template.waba_id,
      user_id: userId,
      deleted_at: null,
    });

    if (!waba) {
      return res.status(404).json({ message: 'WhatsApp WABA not found' });
    }

    const { access_token, whatsapp_business_account_id, app_id } = waba;

    const updateData = {};

    const uploadedFile = req.file || (req.files && req.files.file && req.files.file[0]);
    if (uploadedFile) {
      let buffer = uploadedFile.buffer;
      if (!buffer && uploadedFile.path) {
        try {
          if (uploadedFile.path.startsWith('http')) {
            const response = await axios.get(uploadedFile.path, { responseType: 'arraybuffer' });
            buffer = Buffer.from(response.data);
          } else {
            buffer = fs.readFileSync(path.join(process.cwd(), uploadedFile.path));
          }
        } catch (err) {
          console.error('[TemplateController] Error reading uploaded file:', err.message);
        }
      }

      if (buffer) {
        const handle = await templateHelper.uploadSampleMediaForTemplate({
          app_id: app_id,
          access_token,
          file_name: uploadedFile.originalname,
          file_size: uploadedFile.size,
          mime_type: uploadedFile.mimetype,
          buffer: buffer,
        });

        const mediaType = templateHelper.getWhatsAppTypeFromMime(uploadedFile.mimetype);
        const localUrl = await templateHelper.saveBufferLocally(buffer, uploadedFile.mimetype, mediaType, userId);

        updateData.header = {
          format: 'media',
          media_type: mediaType,
          media_url: localUrl,
          handle: handle,
        };
      }
    } else if (header_text !== undefined) {
      if (header_text) {
        updateData.header = {
          format: 'text',
          text: header_text,
        };
      } else {
        updateData.header = null;
      }
    }

    if (template_name) updateData.template_name = template_name.toLowerCase();
    if (language) updateData.language = language;
    if (footer_text !== undefined) updateData.footer_text = footer_text;

    if (message_body) {
      updateData.message_body = message_body;
      const extractedVariables = templateHelper.extractVariables(message_body);
      updateData.body_variables = extractedVariables.map((v) => {
        const existingVar = (template.body_variables || []).find((ev) => ev.key === v.key);
        return {
          key: v.key,
          example: processedVariableExamples[v.key] || (existingVar ? existingVar.example : 'example'),
        };
      });
    }

    const updatedTemplate = await Template.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).populate('waba_id');

    res.json({
      success: true,
      message: 'Template updated successfully in Draft state.',
      data: updatedTemplate,
    });

  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update template',
      details: error.message,
    });
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const template = await Template.findOne({
      _id: id,
      user_id: userId,
      deleted_at: null,
    });

    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }

    if (template.meta_template_id) {
      const waba = await WhatsappWaba.findOne({
        _id: template.waba_id,
        user_id: userId,
        deleted_at: null,
      });

      if (waba && waba.whatsapp_business_account_id) {
        try {
          const deleteUrl = `https://graph.facebook.com/${API_VERSION}/${waba.whatsapp_business_account_id}/message_templates`;
          await axios.delete(deleteUrl, {
            params: { name: template.template_name },
            headers: { Authorization: `Bearer ${waba.access_token}` },
          });
        } catch (metaErr) {
          console.warn('Could not delete from Meta (might already be deleted or invalid state):', metaErr.message);
        }
      }
    }

    await Template.findByIdAndUpdate(id, {
      deleted_at: new Date()
    });

    return res.json({ success: true, message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete template',
      details: error.message,
    });
  }
};

exports.syncTemplatesFromMeta = async (req, res) => {
  try {
    const userId = req.user.id;
    const { waba_id, meta_template_ids } = req.body || {};

    if (!waba_id) {
      return res.status(400).json({
        success: false,
        message: 'waba_id is required',
      });
    }

    const idsToSync = Array.isArray(meta_template_ids) ? meta_template_ids : [];
    if (idsToSync.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'meta_template_ids is required and must be a non-empty array of Meta template IDs',
      });
    }

    const waba = await WhatsappWaba.findOne({
      _id: waba_id,
      user_id: userId,
      deleted_at: null,
    });

    if (!waba) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp WABA not found',
      });
    }

    const allMetaTemplates = await templateHelper.fetchTemplatesFromMeta(waba.whatsapp_business_account_id, waba.access_token);
    const idSet = new Set(idsToSync.map((id) => String(id).trim()).filter(Boolean));
    const metaTemplatesToSync = allMetaTemplates.filter((t) => idSet.has(String(t.id)));

    let syncedCount = 0;
    let updatedCount = 0;
    const errors = [];

    for (const metaTemplate of metaTemplatesToSync) {
      try {
        if ((metaTemplate.category || '').toUpperCase() !== 'UTILITY') {
          continue;
        }

        const doc = templateHelper.metaTemplateToDbDocument(metaTemplate, waba_id, userId);

        if (doc.header && doc.header.format === 'media' && doc.header.media_url && doc.header.media_url.startsWith('http')) {
          try {
            const localUrl = await templateHelper.downloadAndStoreMedia(
              doc.header.media_url,
              waba.access_token,
              doc.header.media_type === 'image' ? 'image/png' : (doc.header.media_type === 'video' ? 'video/mp4' : 'application/pdf'),
              doc.header.media_type,
              userId
            );
            if (localUrl) {
              doc.header.media_url = localUrl;
            }
          } catch (mirrorErr) {
            console.error(`[Sync] Failed to mirror media for ${doc.template_name}:`, mirrorErr.message);
          }
        }

        const existing = await Template.findOne({
          user_id: userId,
          meta_template_id: metaTemplate.id,
        });

        if (existing) {
          await Template.findByIdAndUpdate(existing._id, doc);
          updatedCount++;
        } else {
          await Template.create(doc);
          syncedCount++;
        }
      } catch (err) {
        errors.push({
          meta_template_id: metaTemplate.id,
          template_name: metaTemplate.name,
          error: err.message,
        });
      }
    }

    const notFoundIds = idsToSync.filter((id) => !metaTemplatesToSync.some((t) => String(t.id) === String(id)));

    return res.json({
      success: true,
      message: 'Sync completed',
      stats: {
        requested: idsToSync.length,
        found_on_meta: metaTemplatesToSync.length,
        not_found_on_meta: notFoundIds,
        newly_synced: syncedCount,
        updated: updatedCount,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error syncing templates:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync templates',
      details: error.message,
    });
  }
};

exports.syncTemplatesStatusFromMeta = async (req, res) => {
  try {
    const userId = req.user.id;
    const { waba_id, template_ids } = req.body || {};

    if (!waba_id) {
      return res.status(400).json({
        success: false,
        message: 'waba_id is required',
      });
    }

    const waba = await WhatsappWaba.findOne({
      _id: waba_id,
      user_id: userId,
      deleted_at: null,
    });

    if (!waba) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp WABA not found',
      });
    }

    const query = {
      user_id: userId,
      waba_id: waba_id,
      meta_template_id: { $exists: true, $ne: null, $ne: '' },
    };
    if (Array.isArray(template_ids) && template_ids.length > 0) {
      query._id = { $in: template_ids };
    }

    const dbTemplates = await Template.find(query).lean();
    if (dbTemplates.length === 0) {
      return res.json({
        success: true,
        message: 'No templates to sync status for',
        stats: { updated: 0, not_found_on_meta: 0, errors: 0 },
      });
    }

    const metaTemplates = await templateHelper.fetchTemplatesFromMeta(waba.whatsapp_business_account_id, waba.access_token);
    const metaById = new Map(metaTemplates.map((t) => [String(t.id), t]));

    let updatedCount = 0;
    const errors = [];
    const notFound = [];

    for (const dbT of dbTemplates) {
      const metaT = metaById.get(String(dbT.meta_template_id));
      if (!metaT) {
        notFound.push({ template_id: dbT._id.toString(), meta_template_id: dbT.meta_template_id, template_name: dbT.template_name });
        continue;
      }
      try {
        const status = (metaT.status || '').toLowerCase();
        const rejection_reason = metaT.rejected_reason || null;
        await Template.findByIdAndUpdate(dbT._id, {
          status,
          rejection_reason,
        });
        updatedCount++;
      } catch (err) {
        errors.push({
          template_id: dbT._id.toString(),
          template_name: dbT.template_name,
          message: err.message,
        });
      }
    }

    return res.json({
      success: true,
      message: 'Status sync completed',
      stats: {
        total_checked: dbTemplates.length,
        updated: updatedCount,
        not_found_on_meta: notFound.length,
        errors: errors.length,
      },
      not_found_on_meta: notFound.length > 0 ? notFound : undefined,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error syncing template status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync template status',
      details: error.message,
    });
  }
};

exports.getTemplatesFromMeta = async (req, res) => {
  try {
    const userId = req.user.id;
    const waba_id = req.query.waba_id || req.body?.waba_id;

    if (!waba_id) {
      return res.status(400).json({
        success: false,
        message: 'waba_id is required',
      });
    }

    const waba = await WhatsappWaba.findOne({
      _id: waba_id,
      user_id: userId,
      deleted_at: null,
    });

    if (!waba) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp WABA not found',
      });
    }

    const metaTemplates = await templateHelper.fetchTemplatesFromMeta(waba.whatsapp_business_account_id, waba.access_token);

    const utilityTemplates = metaTemplates.filter(
      (template) => template.category === 'UTILITY'
    );

    return res.json({
      success: true,
      data: utilityTemplates,
      count: utilityTemplates.length,
    });
  } catch (error) {
    console.error('Error fetching templates from Meta:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch templates from Meta',
      details: error.message,
    });
  }
};
