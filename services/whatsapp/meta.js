'use strict';

const axios = require('axios');
const FormData = require('form-data');

const API_VERSION = 'v21.0';
// WHATSAPP_GRAPH_URL points at a mock Graph API for local testing.
const GRAPH = process.env.WHATSAPP_GRAPH_URL || `https://graph.facebook.com/${API_VERSION}`;

// Meta's limits for interactive messages.
const LIMITS = {
  body: 1024,
  header: 60,
  footer: 60,
  buttons: 3,
  button_title: 20,
  list_button: 20,
  list_rows: 10,
  row_title: 24,
  row_description: 72,
  caption: 1024,
  text: 4096,
};

// Media Meta accepts, and the largest file it takes for each (bytes).
const MEDIA_LIMITS = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
  sticker: 500 * 1024,
};

const clip = (s, n) => String(s ?? '').slice(0, n);

class MetaError extends Error {
  constructor(message, code = null, status = null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Meta's error, in words a person can act on.
const toMetaError = (err) => {
  const e = err.response?.data?.error;
  if (!e) return new MetaError(err.message || 'WhatsApp request failed', null, err.response?.status || null);
  const details = e.error_data?.details;
  return new MetaError(details || e.message || 'WhatsApp request failed', e.code ?? null, err.response?.status || null);
};

const post = async (path, token, body, config = {}) => {
  try {
    const res = await axios.post(`${GRAPH}/${path}`, body, {
      timeout: 20000,
      ...config,
      headers: { Authorization: `Bearer ${token}`, ...(config.headers || {}) },
    });
    return res.data;
  } catch (err) {
    throw toMetaError(err);
  }
};

// Sends one message from a business number and returns its wamid.
const sendMessage = async (phoneNumberId, token, message) => {
  const data = await post(`${phoneNumberId}/messages`, token, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    ...message,
  });
  return data.messages?.[0]?.id || null;
};

const withContext = (payload, replyToWamid) => (replyToWamid ? { ...payload, context: { message_id: replyToWamid } } : payload);

const textMessage = (to, text, replyToWamid) =>
  withContext({ to, type: 'text', text: { body: clip(text, LIMITS.text), preview_url: /https?:\/\//.test(text) } }, replyToWamid);

// media: { id } (uploaded to Meta) or { link }, plus caption / filename.
const mediaMessage = (to, kind, media, replyToWamid) => {
  const body = media.id ? { id: media.id } : { link: media.link };
  if (media.caption && kind !== 'audio' && kind !== 'sticker') body.caption = clip(media.caption, LIMITS.caption);
  if (media.filename && kind === 'document') body.filename = media.filename;
  return withContext({ to, type: kind, [kind]: body }, replyToWamid);
};

const header = (text) => (text ? { header: { type: 'text', text: clip(text, LIMITS.header) } } : {});
const footer = (text) => (text ? { footer: { text: clip(text, LIMITS.footer) } } : {});

const buttonsMessage = (to, { text, header: h, footer: f, buttons }) => ({
  to,
  type: 'interactive',
  interactive: {
    type: 'button',
    ...header(h),
    body: { text: clip(text, LIMITS.body) },
    ...footer(f),
    action: {
      buttons: buttons.slice(0, LIMITS.buttons).map((b) => ({ type: 'reply', reply: { id: String(b.id), title: clip(b.title, LIMITS.button_title) } })),
    },
  },
});

const listMessage = (to, { text, header: h, footer: f, button_label, sections }) => ({
  to,
  type: 'interactive',
  interactive: {
    type: 'list',
    ...header(h),
    body: { text: clip(text, LIMITS.body) },
    ...footer(f),
    action: {
      button: clip(button_label || 'Choose', LIMITS.list_button),
      sections: sections.map((s) => ({
        ...(s.title ? { title: clip(s.title, LIMITS.row_title) } : {}),
        rows: s.rows.map((r) => ({
          id: String(r.id),
          title: clip(r.title, LIMITS.row_title),
          ...(r.description ? { description: clip(r.description, LIMITS.row_description) } : {}),
        })),
      })),
    },
  },
});

const reactionMessage = (to, wamid, emoji) => ({ to, type: 'reaction', reaction: { message_id: wamid, emoji: emoji || '' } });

const templateMessage = (to, name, language, components) => ({
  to,
  type: 'template',
  template: { name, language: { code: language }, ...(components?.length ? { components } : {}) },
});

// Blue ticks for the customer, optionally with "typing…" until the next reply (up to 25 s).
const markRead = (phoneNumberId, token, wamid, typing = false) =>
  post(`${phoneNumberId}/messages`, token, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: wamid,
    ...(typing ? { typing_indicator: { type: 'text' } } : {}),
  });

// Inbound media: Meta gives a short-lived URL that needs the token to download.
const downloadMedia = async (mediaId, token, maxBytes = 16 * 1024 * 1024) => {
  try {
    const info = await axios.get(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
    const { url, mime_type, file_size } = info.data;
    if (file_size && file_size > maxBytes) return { tooLarge: true, mime_type, size: file_size };
    const file = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: maxBytes,
    });
    return { buffer: Buffer.from(file.data), mime_type, size: file_size || file.data.byteLength };
  } catch (err) {
    throw toMetaError(err);
  }
};

// Uploads a file to Meta so it can be sent by id (no public URL needed).
const uploadMedia = async (phoneNumberId, token, { buffer, mimetype, filename }) => {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimetype);
  form.append('file', buffer, { filename: filename || 'file', contentType: mimetype });
  const data = await post(`${phoneNumberId}/media`, token, form, { headers: form.getHeaders(), maxBodyLength: Infinity });
  return data.id;
};

// Meta only sends a business account's message webhooks to apps subscribed to it.
const subscribeApp = (wabaId, token) => post(`${wabaId}/subscribed_apps`, token, {});

const isAppSubscribed = async (wabaId, token) => {
  try {
    const res = await axios.get(`${GRAPH}/${wabaId}/subscribed_apps`, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 });
    return Array.isArray(res.data?.data) && res.data.data.length > 0;
  } catch {
    return null; // Unknown: the token may lack the permission to check.
  }
};

// The WhatsApp media kind for a MIME type.
const kindForMime = (mime = '') => {
  if (mime === 'image/webp') return 'sticker';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
};

module.exports = {
  API_VERSION,
  LIMITS,
  MEDIA_LIMITS,
  MetaError,
  sendMessage,
  textMessage,
  mediaMessage,
  buttonsMessage,
  listMessage,
  reactionMessage,
  templateMessage,
  markRead,
  downloadMedia,
  uploadMedia,
  subscribeApp,
  isAppSubscribed,
  kindForMime,
};
