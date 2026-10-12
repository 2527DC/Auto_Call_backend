'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db } = require('../../models');
const { WhatsappConversation, WhatsappMessage, WhatsappPhoneNumber, WhatsappFlowRun, WhatsAppTemplate, Contact, User } = db;
const meta = require('./meta');
const storageService = require('../storageService');
const { emitToAccount } = require('../../utils/realtime');

const WINDOW_MS = 24 * 60 * 60 * 1000;
// Delivery statuses only move forward: a late "delivered" never replaces "read".
const STATUS_ORDER = ['pending', 'sent', 'delivered', 'read'];

class WindowClosedError extends Error {
  constructor() {
    super('The 24-hour reply window has closed. Send an approved template to restart the chat.');
    this.code = 'WINDOW_CLOSED';
  }
}

const isWindowOpen = (conversation) =>
  !!conversation.last_inbound_at && Date.now() - new Date(conversation.last_inbound_at).getTime() < WINDOW_MS;

const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/amr': '.amr',
  'application/pdf': '.pdf', 'text/plain': '.txt',
  'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};
const extFor = (mime, filename) => MIME_EXT[(mime || '').split(';')[0]] || (filename ? path.extname(filename) : '') || '';

// Stores a file under a random name, so links to customers' media can't be guessed.
const storeFile = (accountId, { buffer, mimetype, filename }) =>
  storageService.uploadFile(
    { buffer, mimetype, originalname: filename || 'file', filename: `${crypto.randomBytes(16).toString('hex')}${extFor(mimetype, filename)}` },
    accountId,
    'whatsapp'
  );

// The short line shown in the chat list.
const previewOf = ({ type, text, media }) => {
  const labels = { image: '📷 Photo', video: '🎥 Video', audio: '🎤 Audio', sticker: 'Sticker', document: '📄 Document', location: '📍 Location', contacts: '👤 Contact', template: '📋 Template' };
  if (text) return (labels[type] && type !== 'template' ? `${labels[type]}: ` : '') + text.slice(0, 120);
  if (type === 'document' && media?.filename) return `📄 ${media.filename}`;
  return labels[type] || '';
};

// The customer's message in the shape we store.
const parseInbound = (msg) => {
  switch (msg.type) {
    case 'text':
      return { type: 'text', text: msg.text?.body || '' };
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker': {
      const m = msg[msg.type] || {};
      return {
        type: msg.type,
        text: m.caption || '',
        media: { meta_id: m.id || null, mime_type: m.mime_type || null, filename: m.filename || null },
      };
    }
    case 'location': {
      const l = msg.location || {};
      return {
        type: 'location',
        text: [l.name, l.address].filter(Boolean).join(' - ') || `${l.latitude}, ${l.longitude}`,
        location: { latitude: l.latitude, longitude: l.longitude, name: l.name, address: l.address },
      };
    }
    case 'contacts':
      return {
        type: 'contacts',
        text: (msg.contacts || []).map((c) => [c.name?.formatted_name, c.phones?.[0]?.phone].filter(Boolean).join(' ')).join(', '),
        interactive: { contacts: msg.contacts || [] },
      };
    case 'interactive': {
      const r = msg.interactive?.button_reply || msg.interactive?.list_reply;
      if (r) return { type: 'button_reply', text: r.title || '', interactive: { id: r.id, title: r.title, description: r.description || null } };
      return { type: 'unsupported', text: '[Interactive message]' };
    }
    case 'button':
      // A quick-reply button on a template.
      return { type: 'button_reply', text: msg.button?.text || '', interactive: { id: msg.button?.payload || msg.button?.text, title: msg.button?.text } };
    default:
      return { type: 'unsupported', text: `[${msg.type || 'Unknown'} message]` };
  }
};

const phoneVariants = (waId) => {
  const digits = String(waId).replace(/\D/g, '');
  const variants = new Set([`+${digits}`, digits]);
  if (digits.length > 10) {
    const local = digits.slice(-10);
    variants.add(local);
    variants.add(`0${local}`);
  }
  return [...variants];
};

class WhatsappInbox {
  constructor() {
    this.WindowClosedError = WindowClosedError;
    this.isWindowOpen = isWindowOpen;
  }

  // The business number a webhook is for, with its token and owner. Accounts
  // without the beta switched on are skipped, so nothing changes for them.
  async resolveNumber(metaPhoneNumberId) {
    if (!metaPhoneNumberId) return null;
    const phone = await WhatsappPhoneNumber.findOne({ whatsapp_phone_number_id: metaPhoneNumberId, deleted_at: null }).populate('waba_id').lean();
    if (!phone?.waba_id || phone.waba_id.deleted_at) return null;
    const owner = await User.findById(phone.user_id).select('beta_features roleId').populate('roleId', 'name').lean();
    const isAdmin = ['super_admin', 'admin'].includes(owner?.roleId?.name);
    if (!owner || (!isAdmin && !owner.beta_features?.whatsapp)) return null;
    return { phone, waba: phone.waba_id, accountId: phone.user_id };
  }

  async linkContact(accountId, waId, name) {
    const existing = await Contact.findOne({ user_id: accountId, phone_number: { $in: phoneVariants(waId) } }).select('_id').lean();
    if (existing) return existing._id;
    const [first = '', ...rest] = (name || '').trim().split(/\s+/);
    const contact = await Contact.create({ user_id: accountId, phone_number: `+${waId}`, first_name: first, last_name: rest.join(' ') });
    return contact._id;
  }

  async findOrCreateConversation({ accountId, phone, waba, waId, profileName }) {
    const query = { phone_number_id: phone._id, wa_id: waId };
    const existing = await WhatsappConversation.findOne(query);
    if (existing) {
      if (!existing.contact_id) {
        existing.contact_id = await this.linkContact(accountId, waId, profileName).catch(() => null);
        await existing.save();
      }
      return existing;
    }
    const contactId = await this.linkContact(accountId, waId, profileName).catch(() => null);
    try {
      const created = await WhatsappConversation.create({ ...query, user_id: accountId, waba_id: waba._id, contact_id: contactId, profile_name: profileName });
      emitToAccount(accountId, 'whatsapp:conversation', { conversation_id: created.id });
      return created;
    } catch (err) {
      // Two webhooks for a new customer at once: the other one created it.
      if (err.code === 11000) return WhatsappConversation.findOne(query);
      throw err;
    }
  }

  // A customer message from the webhook. Returns what the automations need, or
  // null when there is nothing to act on (beta off, a replay, a reaction).
  async ingestInbound(value, msg) {
    const resolved = await this.resolveNumber(value.metadata?.phone_number_id);
    if (!resolved) return null;
    const { phone, waba, accountId } = resolved;

    const waId = msg.from;
    const profile = (value.contacts || []).find((c) => c.wa_id === waId) || value.contacts?.[0];
    const profileName = profile?.profile?.name || '';
    const conversation = await this.findOrCreateConversation({ accountId, phone, waba, waId, profileName });

    if (msg.type === 'reaction') {
      await this.applyCustomerReaction(conversation, msg.reaction);
      return null;
    }

    const parsed = parseInbound(msg);
    const replyTo = msg.context?.id
      ? await WhatsappMessage.findOne({ wamid: msg.context.id, conversation_id: conversation._id }).select('_id').lean()
      : null;

    let message;
    try {
      message = await WhatsappMessage.create({
        user_id: accountId,
        conversation_id: conversation._id,
        direction: 'inbound',
        sender: 'customer',
        ...parsed,
        reply_to_message_id: replyTo?._id || null,
        wamid: msg.id,
        status: 'received',
      });
    } catch (err) {
      if (err.code === 11000) return null; // Meta sent this message again.
      throw err;
    }

    const sentAt = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();
    const reopen = conversation.status === 'resolved' ? { status: 'open', bot_paused: false, ai_reply_count: 0 } : {};
    const updated = await WhatsappConversation.findByIdAndUpdate(
      conversation._id,
      {
        $inc: { unread_count: 1 },
        $set: {
          last_message: { text: previewOf(parsed), type: parsed.type, direction: 'inbound', at: new Date() },
          last_inbound_at: sentAt,
          ...(profileName ? { profile_name: profileName } : {}),
          ...reopen,
        },
      },
      { new: true }
    );

    if (parsed.media?.meta_id) {
      this.mirrorMedia(message, waba.access_token).catch((e) => console.error('[WhatsApp] Media download failed:', e.message));
    }

    emitToAccount(accountId, 'whatsapp:message', { conversation_id: updated.id, message_id: message.id });
    const inboundCount = await WhatsappMessage.countDocuments({ conversation_id: conversation._id, direction: 'inbound' });
    return { conversation: updated, message, phone, waba, accountId, isFirstMessage: inboundCount === 1 };
  }

  // Meta's media links expire, so inbound files are copied to our storage straight away.
  async mirrorMedia(message, token) {
    const file = await meta.downloadMedia(message.media.meta_id, token);
    const update = { 'media.mime_type': file.mime_type || message.media.mime_type, 'media.size': file.size };
    if (!file.tooLarge) {
      update['media.url'] = await storeFile(message.user_id, { buffer: file.buffer, mimetype: file.mime_type, filename: message.media.filename });
    }
    await WhatsappMessage.updateOne({ _id: message._id }, { $set: update });
    emitToAccount(message.user_id, 'whatsapp:message', { conversation_id: String(message.conversation_id), message_id: message.id });
  }

  async applyCustomerReaction(conversation, reaction) {
    if (!reaction?.message_id) return;
    const target = await WhatsappMessage.findOne({ wamid: reaction.message_id, conversation_id: conversation._id });
    if (!target) return;
    target.reactions = target.reactions.filter((r) => r.actor !== 'customer');
    if (reaction.emoji) target.reactions.push({ actor: 'customer', emoji: reaction.emoji });
    await target.save();
    emitToAccount(conversation.user_id, 'whatsapp:message', { conversation_id: conversation.id, message_id: target.id });
  }

  // A delivery status from the webhook.
  async applyStatus(statusObj) {
    const { id: wamid, status } = statusObj;
    let allowedFrom;
    if (status === 'failed') allowedFrom = ['pending', 'sent'];
    else if (STATUS_ORDER.includes(status)) allowedFrom = STATUS_ORDER.slice(0, STATUS_ORDER.indexOf(status));
    else return;

    const set = { status };
    if (status === 'failed') {
      const e = statusObj.errors?.[0];
      set.error = { code: e?.code ?? null, message: e?.error_data?.details || e?.title || e?.message || 'Message failed' };
    }
    const message = await WhatsappMessage.findOneAndUpdate({ wamid, status: { $in: allowedFrom } }, { $set: set }, { new: true }).select('conversation_id user_id');
    if (message) {
      emitToAccount(message.user_id, 'whatsapp:status', { conversation_id: String(message.conversation_id), message_id: message.id, status });
    }
  }

  async numberFor(conversation) {
    const phone = await WhatsappPhoneNumber.findById(conversation.phone_number_id).populate('waba_id').lean();
    if (!phone || phone.deleted_at || !phone.waba_id || phone.waba_id.deleted_at) {
      throw new Error('This WhatsApp number is no longer connected.');
    }
    return { phoneNumberId: phone.whatsapp_phone_number_id, token: phone.waba_id.access_token };
  }

  // Records an outgoing message, sends it, and stores the result. A failed send is
  // kept with its error so the chat shows it; the caller checks message.status.
  async deliver(conversation, { sender, actor = {}, record, build, isTemplate = false }) {
    if (!isTemplate && !isWindowOpen(conversation)) throw new WindowClosedError();
    const { phoneNumberId, token } = await this.numberFor(conversation);

    const replyTo = record.reply_to_message_id
      ? await WhatsappMessage.findOne({ _id: record.reply_to_message_id, conversation_id: conversation._id }).select('wamid').lean()
      : null;

    const message = await WhatsappMessage.create({
      user_id: conversation.user_id,
      conversation_id: conversation._id,
      direction: 'outbound',
      sender,
      sent_by_user_id: actor.userId || null,
      sent_by_member_id: actor.memberId || null,
      ...record,
      reply_to_message_id: replyTo?._id || null,
      status: 'pending',
    });
    emitToAccount(conversation.user_id, 'whatsapp:message', { conversation_id: String(conversation._id), message_id: message.id });

    try {
      message.wamid = await meta.sendMessage(phoneNumberId, token, await build(conversation.wa_id, replyTo?.wamid, { phoneNumberId, token }));
      message.status = 'sent';
    } catch (err) {
      message.status = 'failed';
      message.error = { code: err.code ?? null, message: err.message };
    }
    await message.save();

    const convUpdate = { last_message: { text: previewOf(message), type: message.type, direction: 'outbound', at: new Date() } };
    // A person replying takes over: automations and AI stay quiet in this chat.
    if (sender === 'agent' && message.status !== 'failed') {
      convUpdate.bot_paused = true;
      await this.stopRuns(conversation._id, 'agent_replied');
    }
    await WhatsappConversation.updateOne({ _id: conversation._id }, { $set: convUpdate });
    emitToAccount(conversation.user_id, 'whatsapp:message', { conversation_id: String(conversation._id), message_id: message.id });
    return message;
  }

  sendText(conversation, text, opts = {}) {
    return this.deliver(conversation, {
      ...opts,
      record: { type: 'text', text, reply_to_message_id: opts.replyToId || null, flow_run_id: opts.flowRunId || null },
      build: (to, replyWamid) => meta.textMessage(to, text, replyWamid),
    });
  }

  // A file from the inbox composer: kept in our storage for the chat, sent to Meta by upload.
  async sendFile(conversation, file, caption, opts = {}) {
    const kind = meta.kindForMime(file.mimetype) === 'sticker' ? 'image' : meta.kindForMime(file.mimetype);
    if (file.size > meta.MEDIA_LIMITS[kind]) {
      throw new Error(`This ${kind} is too large for WhatsApp (max ${Math.round(meta.MEDIA_LIMITS[kind] / 1024 / 1024)} MB).`);
    }
    if (!isWindowOpen(conversation)) throw new WindowClosedError();
    const url = await storeFile(conversation.user_id, { buffer: file.buffer, mimetype: file.mimetype, filename: file.originalname });
    return this.deliver(conversation, {
      ...opts,
      record: {
        type: kind,
        text: caption || '',
        media: { url, mime_type: file.mimetype, filename: file.originalname, size: file.size },
        reply_to_message_id: opts.replyToId || null,
      },
      build: async (to, replyWamid, { phoneNumberId, token }) => {
        const id = await meta.uploadMedia(phoneNumberId, token, { buffer: file.buffer, mimetype: file.mimetype, filename: file.originalname });
        return meta.mediaMessage(to, kind, { id, caption, filename: file.originalname }, replyWamid);
      },
    });
  }

  // Media from an automation step: a public link is sent as is, a file in our
  // local storage is uploaded to Meta.
  sendMediaLink(conversation, { type, url, filename, caption }, opts = {}) {
    return this.deliver(conversation, {
      ...opts,
      record: { type, text: caption || '', media: { url, filename: filename || null }, flow_run_id: opts.flowRunId || null },
      build: async (to, replyWamid, { phoneNumberId, token }) => {
        if (/^https?:\/\//.test(url)) return meta.mediaMessage(to, type, { link: url, caption, filename }, replyWamid);
        const absolute = path.join(process.cwd(), url.replace(/^\/+/, ''));
        if (!absolute.startsWith(path.join(process.cwd(), 'uploads'))) throw new Error('Invalid media path');
        const buffer = await fs.promises.readFile(absolute);
        const mimetype = Object.keys(MIME_EXT).find((m) => MIME_EXT[m] === path.extname(absolute).toLowerCase()) || 'application/octet-stream';
        const id = await meta.uploadMedia(phoneNumberId, token, { buffer, mimetype, filename: filename || path.basename(absolute) });
        return meta.mediaMessage(to, type, { id, caption, filename }, replyWamid);
      },
    });
  }

  sendButtons(conversation, content, opts = {}) {
    return this.deliver(conversation, {
      ...opts,
      record: { type: 'interactive', text: content.text, interactive: { kind: 'buttons', ...content }, flow_run_id: opts.flowRunId || null },
      build: (to) => meta.buttonsMessage(to, content),
    });
  }

  sendList(conversation, content, opts = {}) {
    return this.deliver(conversation, {
      ...opts,
      record: { type: 'interactive', text: content.text, interactive: { kind: 'list', ...content }, flow_run_id: opts.flowRunId || null },
      build: (to) => meta.listMessage(to, content),
    });
  }

  // An approved template, the only thing WhatsApp allows once the 24-hour window has closed.
  async sendTemplate(conversation, templateId, { bodyValues = [], buttonValues = {} } = {}, opts = {}) {
    const template = await WhatsAppTemplate.findOne({ _id: templateId, status: 'approved' }).lean();
    if (!template || String(template.waba_id) !== String(conversation.waba_id)) throw new Error('Template not found or not approved for this number');

    const components = [];
    if (template.header?.format === 'media' && template.header.media_url) {
      components.push({ type: 'header', parameters: [{ type: template.header.media_type, [template.header.media_type]: { link: template.header.media_url } }] });
    }
    if (bodyValues.length) components.push({ type: 'body', parameters: bodyValues.map((v) => ({ type: 'text', text: String(v || '-') })) });
    (template.buttons || []).forEach((btn, index) => {
      if ((btn.type === 'url' || btn.type === 'website') && btn.url?.includes('{{') && buttonValues[index]) {
        components.push({ type: 'button', sub_type: 'url', index: String(index), parameters: [{ type: 'text', text: String(buttonValues[index]) }] });
      }
    });

    let text = template.message_body || '';
    bodyValues.forEach((v, i) => { text = text.split(`{{${i + 1}}}`).join(String(v)); });

    return this.deliver(conversation, {
      ...opts,
      isTemplate: true,
      record: { type: 'template', text, template: { name: template.template_name, language: template.language } },
      build: (to) => meta.templateMessage(to, template.template_name, template.language, components),
    });
  }

  async addInternal(conversation, { type, text, actor = {} }) {
    const message = await WhatsappMessage.create({
      user_id: conversation.user_id,
      conversation_id: conversation._id,
      direction: 'internal',
      sender: type === 'note' ? 'agent' : 'system',
      sent_by_user_id: actor.userId || null,
      sent_by_member_id: actor.memberId || null,
      type,
      text,
      status: 'sent',
    });
    emitToAccount(conversation.user_id, 'whatsapp:message', { conversation_id: String(conversation._id), message_id: message.id });
    return message;
  }

  addEvent(conversation, text) {
    return this.addInternal(conversation, { type: 'event', text });
  }

  async react(conversation, message, emoji) {
    if (!message.wamid) throw new Error('This message can\'t be reacted to');
    if (!isWindowOpen(conversation)) throw new WindowClosedError();
    const { phoneNumberId, token } = await this.numberFor(conversation);
    await meta.sendMessage(phoneNumberId, token, meta.reactionMessage(conversation.wa_id, message.wamid, emoji));
    message.reactions = message.reactions.filter((r) => r.actor !== 'agent');
    if (emoji) message.reactions.push({ actor: 'agent', emoji });
    await message.save();
    emitToAccount(conversation.user_id, 'whatsapp:message', { conversation_id: String(conversation._id), message_id: message.id });
    return message;
  }

  // Opening a chat: blue ticks for the customer and the unread count back to 0.
  async markRead(conversation) {
    if (!conversation.unread_count) return;
    await WhatsappConversation.updateOne({ _id: conversation._id }, { $set: { unread_count: 0 } });
    const last = await WhatsappMessage.findOne({ conversation_id: conversation._id, direction: 'inbound', wamid: { $ne: null } }).sort({ created_at: -1 }).select('wamid').lean();
    if (last && isWindowOpen(conversation)) {
      const { phoneNumberId, token } = await this.numberFor(conversation);
      await meta.markRead(phoneNumberId, token, last.wamid).catch((e) => console.warn('[WhatsApp] Mark read failed:', e.message));
    }
    emitToAccount(conversation.user_id, 'whatsapp:conversation', { conversation_id: String(conversation._id) });
  }

  stopRuns(conversationId, reason) {
    return WhatsappFlowRun.updateMany(
      { conversation_id: conversationId, status: 'active', simulation: false },
      { $set: { status: 'stopped', end_reason: reason, ended_at: new Date() } }
    );
  }
}

module.exports = new WhatsappInbox();
