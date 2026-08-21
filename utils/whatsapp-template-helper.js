'use strict';

const axios = require('axios');
const storageService = require('../services/storageService');

const API_VERSION = "v21.0";

const extractVariables = (text) => {
  const regex = /{{(.*?)}}/g;
  const variables = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    variables.push({
      key: match[1].trim(),
    });
  }

  return variables;
};

const uploadSampleMediaForTemplate = async ({ app_id, access_token, file_name, file_size, mime_type, buffer }) => {
  const startUrl = `https://graph.facebook.com/${API_VERSION}/${app_id}/uploads`;
  const startResponse = await axios.post(startUrl, null, {
    params: {
      file_name,
      file_length: file_size,
      file_type: mime_type,
      access_token,
    },
  });
  const sessionId = startResponse.data.id;

  const uploadUrl = `https://graph.facebook.com/${API_VERSION}/${sessionId}`;
  const uploadResponse = await axios.post(uploadUrl, buffer, {
    headers: {
      Authorization: `OAuth ${access_token}`,
      file_offset: "0",
      "Content-Type": "application/octet-stream",
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  return uploadResponse.data.h;
};

const buildMetaTemplatePayload = (template) => {
  const components = [];

  if (template.header) {
    if (template.header.format === "text") {
      components.push({
        type: "HEADER",
        format: "TEXT",
        text: template.header.text,
      });
    }

    if (template.header.format === "media") {
      const component = {
        type: "HEADER",
        format: template.header.media_type.toUpperCase(),
      };

      if (template.header.media_type === "image") {
        if (template.header.media_url && template.header.media_url.startsWith("http")) {
          component.example = { header_url: [template.header.media_url] };
        } else if (template.header.handle) {
          component.example = { header_handle: [template.header.handle] };
        }
      } else if (template.header.media_type === "video") {
        if (template.header.media_url && template.header.media_url.startsWith("http")) {
          component.example = { header_url: [template.header.media_url] };
        } else if (template.header.handle) {
          component.example = { header_handle: [template.header.handle] };
        }
      } else if (template.header.media_type === "document") {
        if (template.header.media_url && template.header.media_url.startsWith("http")) {
          component.example = { header_url: [template.header.media_url] };
        } else if (template.header.handle) {
          component.example = { header_handle: [template.header.handle] };
        }
      } else if (template.header.handle) {
        component.example = { header_handle: [template.header.handle] };
      }

      components.push(component);
    }
  }

  const bodyVariables = template.body_variables || [];
  const bodyComponent = {
    type: "BODY",
    text: template.message_body,
  };

  const hasVariables = bodyVariables.length > 0;
  const isPositional = hasVariables && bodyVariables.every((v) => /^\d+$/.test(v.key));

  if (hasVariables) {
    if (isPositional) {
      const examplesArray = bodyVariables.map((v) => String(v.example || "example"));
      bodyComponent.example = {
        body_text: [examplesArray],
      };
    } else {
      bodyComponent.example = {
        body_text_named_params: bodyVariables.map((v) => ({
          param_name: String(v.key),
          example: String(v.example || "example"),
        })),
      };
    }
  }

  components.push(bodyComponent);

  if (template.footer_text) {
    components.push({
      type: "FOOTER",
      text: template.footer_text,
    });
  }

  return {
    name: template.template_name,
    language: template.language,
    category: "UTILITY",
    parameter_format: bodyVariables.length > 0 && bodyVariables.every((v) => /^\d+$/.test(v.key)) ? "positional" : "named",
    components,
  };
};

const submitTemplateToMeta = async (payload, WABA_ID, ACCESS_TOKEN) => {
  const url = `https://graph.facebook.com/${API_VERSION}/${WABA_ID}/message_templates`;
  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  return response.data;
};

const findComponent = (components, type) => {
  if (!Array.isArray(components)) return null;
  const upper = (type || "").toUpperCase();
  return components.find((c) => (c.type || "").toUpperCase() === upper);
};

const extractBodyText = (components) => {
  const bodyComponent = findComponent(components, "BODY");
  return bodyComponent ? bodyComponent.text : "";
};

const extractVariablesFromComponents = (components) => {
  const bodyComponent = findComponent(components, "BODY");
  if (!bodyComponent || !bodyComponent.text) return [];

  const text = bodyComponent.text;
  const variableKeys = [];
  const regex = /{{(.*?)}}/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    variableKeys.push(match[1].trim());
  }

  let examples = [];
  const ex = bodyComponent.example;
  if (ex && ex.body_text) {
    const bt = ex.body_text;
    if (Array.isArray(bt)) {
      examples = Array.isArray(bt[0]) ? bt[0] : bt;
    }
  }

  return variableKeys.map((key, i) => ({
    key,
    example: examples[i] != null ? String(examples[i]) : "example",
  }));
};

const extractHeader = (components) => {
  const headerComponent = findComponent(components, "HEADER");
  if (!headerComponent) return null;

  const format = (headerComponent.format || "").toUpperCase();
  if (format === "TEXT") {
    return {
      format: "text",
      text: headerComponent.text,
    };
  }

  if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) {
    const example = headerComponent.example || {};
    const handle = example.header_handle?.[0] || example.header_handle || headerComponent.handle;
    const url = example.header_url || example.url || headerComponent.url || headerComponent.header_url;

    return {
      format: "media",
      media_type: format.toLowerCase(),
      media_url: url || (handle ? String(handle) : null),
      handle: handle || undefined,
    };
  }

  return null;
};

const extractFooterText = (components) => {
  const footerComponent = findComponent(components, "FOOTER");
  return footerComponent ? footerComponent.text : null;
};

const metaTemplateToDbDocument = (metaTemplate, wabaId, userId) => {
  const components = metaTemplate.components || [];

  const doc = {
    user_id: userId,
    waba_id: wabaId,
    template_name: (metaTemplate.name || "").toLowerCase(),
    language: metaTemplate.language || "en_US",
    category: "UTILITY",
    status: (metaTemplate.status || "draft").toLowerCase(),
    meta_template_id: metaTemplate.id,
    rejection_reason: metaTemplate.rejected_reason || null,
    message_body: extractBodyText(components),
    body_variables: extractVariablesFromComponents(components),
    header: extractHeader(components),
    footer_text: extractFooterText(components),
  };

  return doc;
};

const fetchTemplatesFromMeta = async (wabaId, accessToken) => {
  const url = `https://graph.facebook.com/${API_VERSION}/${wabaId}/message_templates`;

  const response = await axios.get(url, {
    params: {
      fields: "id,name,status,category,language,components,rejected_reason,quality_score",
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return response.data.data || [];
};

const getWhatsAppTypeFromMime = (mime) => {
  if (!mime) return "text";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
};

const saveBufferLocally = async (buffer, mimeType, fileType, userId) => {
  const extension = mimeType.split('/')[1] || 'bin';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

  const fileObj = {
    buffer: buffer,
    filename: filename,
    mimetype: mimeType,
    originalname: filename
  };

  const folder = `whatsapp/${fileType || 'other'}`;
  const fileUrl = await storageService.uploadFile(fileObj, userId || 'system', folder);
  return fileUrl;
};

const downloadAndStoreMedia = async (url, accessToken, mimeType, fileType, userId) => {
  let response;
  try {
    response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  } catch (err) {
    if (err.response?.status === 403 && url.includes('scontent.whatsapp.net')) {
      response = await axios.get(url, { responseType: "arraybuffer" });
    } else {
      throw err;
    }
  }

  const buffer = Buffer.from(response.data);
  return await saveBufferLocally(buffer, mimeType, fileType, userId);
};

module.exports = {
  extractVariables,
  uploadSampleMediaForTemplate,
  buildMetaTemplatePayload,
  submitTemplateToMeta,
  findComponent,
  extractBodyText,
  extractVariablesFromComponents,
  extractHeader,
  extractFooterText,
  metaTemplateToDbDocument,
  fetchTemplatesFromMeta,
  getWhatsAppTypeFromMime,
  saveBufferLocally,
  downloadAndStoreMedia
};
