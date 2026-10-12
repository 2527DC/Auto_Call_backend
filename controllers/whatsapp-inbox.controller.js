'use strict';

const mongoose = require('mongoose');
const { db } = require('../models');
const { WhatsappConversation, WhatsappMessage, WhatsappFlowRun, WhatsappInboxSetting, WhatsappPhoneNumber, WhatsAppTemplate, TeamMember, TeamPermission, Permission, UserSettings } = db;
const inbox = require('../services/whatsapp/inbox');
const meta = require('../services/whatsapp/meta');
const { accountIdOf } = require('../middlewares/whatsappBeta');
const { emitToAccount } = require('../utils/realtime');
const { sendNotification } = require('../utils/notificationHelper');

const PAGE = 30;
const isId = (id) => mongoose.Types.ObjectId.isValid(id);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const actorOf = (user) => (user.isTeamMember ? { memberId: user._id } : { userId: user._id });
const nameOfMember = (m) => (m ? `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.email : null);

// Team members see chats assigned to them and unassigned ones they can pick up.
const scopeFor = (user) => {
  const query = { user_id: accountIdOf(user) };
  if (user.isTeamMember) query.assigned_member_id = { $in: [user._id, null] };
  return query;
};

const loadConversation = async (req, res) => {
  if (!isId(req.params.id)) {
    res.status(404).json({ success: false, message: 'Chat not found' });
    return null;
  }
  const conversation = await WhatsappConversation.findOne({ _id: req.params.id, ...scopeFor(req.user) });
  if (!conversation) res.status(404).json({ success: false, message: 'Chat not found' });
  return conversation;
};

const shape = (c) => {
  const o = c.toJSON ? c.toJSON() : c;
  return {
    ...o,
    window_open: inbox.isWindowOpen(o),
    window_expires_at: o.last_inbound_at ? new Date(new Date(o.last_inbound_at).getTime() + 24 * 3600 * 1000) : null,
  };
};

const fail = (res, error, fallback) => {
  if (error.code === 'WINDOW_CLOSED') return res.status(409).json({ success: false, code: 'WINDOW_CLOSED', message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ success: false, message: error.message || fallback });
};

// GET /api/whatsapp-inbox/conversations?status=open&filter=mine&search=&label=&before=
exports.listConversations = async (req, res) => {
  try {
    const base = scopeFor(req.user);
    const query = { ...base };
    const { status = 'open', filter = 'all', search = '', label, before } = req.query;
    if (['open', 'pending', 'resolved'].includes(status)) query.status = status;
    if (filter === 'mine') query.assigned_member_id = req.user.isTeamMember ? req.user._id : { $ne: null };
    if (filter === 'unassigned') query.assigned_member_id = null;
    if (filter === 'unread') query.unread_count = { $gt: 0 };
    if (label) query.labels = label;
    if (before) query['last_message.at'] = { $lt: new Date(before) };
    if (search.trim()) {
      const re = new RegExp(escapeRe(search.trim().slice(0, 50)), 'i');
      query.$or = [{ profile_name: re }, { wa_id: re }, { 'last_message.text': re }, { labels: re }];
    }

    const conversations = await WhatsappConversation.find(query)
      .populate('contact_id', 'first_name last_name email')
      .populate('assigned_member_id', 'first_name last_name email avatar')
      .populate('phone_number_id', 'display_phone_number verified_name')
      .sort({ 'last_message.at': -1, _id: -1 })
      .limit(PAGE + 1);

    const accountMatch = { ...base, user_id: new mongoose.Types.ObjectId(String(base.user_id)) };
    const [counts] = await WhatsappConversation.aggregate([
      { $match: accountMatch },
      {
        $group: {
          _id: null,
          open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } },
          unread: { $sum: { $cond: [{ $and: [{ $gt: ['$unread_count', 0] }, { $ne: ['$status', 'resolved'] }] }, 1, 0] } },
        },
      },
    ]);
    const labels = await WhatsappConversation.distinct('labels', base);

    res.json({
      success: true,
      data: conversations.slice(0, PAGE).map(shape),
      has_more: conversations.length > PAGE,
      counts: { open: counts?.open || 0, pending: counts?.pending || 0, resolved: counts?.resolved || 0, unread: counts?.unread || 0 },
      labels: labels.filter(Boolean).sort(),
    });
  } catch (error) {
    fail(res, error, 'Failed to load chats');
  }
};

// GET /api/whatsapp-inbox/conversations/:id
exports.getConversation = async (req, res) => {
  try {
    const conversation = await loadConversation(req, res);
    if (!conversation) return;
    await conversation.populate([
      { path: 'contact_id', select: 'first_name last_name email group_ids', populate: { path: 'group_ids', select: 'group_name' } },
      { path: 'assigned_member_id', select: 'first_name last_name email avatar' },
      { path: 'phone_number_id', select: 'display_phone_number verified_name' },
    ]);
    const run = await WhatsappFlowRun.findOne({ conversation_id: conversation._id, status: 'active', simulation: false })
      .populate('flow_id', 'name nodes')
      .lean();
    let activeRun = null;
    if (run) {
      const node = (run.flow_id?.nodes || []).find((n) => n.id === run.current_node_id);
      const { __history, ...vars } = run.vars || {};
      activeRun = {
        id: String(run._id),
        flow_id: String(run.flow_id?._id || run.flow_id),
        flow_name: run.flow_id?.name || 'Automation',
        step: node?.data?.label || node?.type || null,
        waiting: run.waiting?.kind || null,
        vars,
        started_at: run.created_at,
      };
    }
    res.json({ success: true, data: { ...shape(conversation), active_run: activeRun } });
  } catch (error) {
    fail(res, error, 'Failed to load the chat');
  }
};

// GET /api/whatsapp-inbox/conversations/:id/messages?before=<message id>
exports.listMessages = async (req, res) => {
  try {
    const conversation = await loadConversation(req, res);
    if (!conversation) return;
    const query = { conversation_id: conversation._id };
    if (req.query.before && isId(req.query.before)) {
      const pivot = await WhatsappMessage.findById(req.query.before).select('created_at').lean();
      if (pivot) query.created_at = { $lt: pivot.created_at };
    }
    const limit = Math.min(100, Number(req.query.limit) || 50);
    const messages = await WhatsappMessage.find(query)
      .populate('sent_by_user_id', 'name')
      .populate('sent_by_member_id', 'first_name last_name email')
      .populate('reply_to_message_id', 'text type direction media.filename')
      .sort({ created_at: -1 })
      .limit(limit + 1);
    res.json({
      success: true,
      data: messages.slice(0, limit).reverse().map((m) => ({
        ...m.toJSON(),
        sent_by: m.sent_by_user_id?.name || nameOfMember(m.sent_by_member_id) || null,
      })),
      has_more: messages.length > limit,
    });
  } catch (error) {
    fail(res, error, 'Failed to load messages');
  }
};

// POST /api/whatsapp-inbox/conversations/:id/messages
// JSON { type: 'text' | 'note' | 'template', text, reply_to, template_id, body_values, button_values }
// or multipart with "file" (+ caption, reply_to).
exports.sendMessage = async (req, res) => {
  try {
    const conversation = await loadConversation(req, res);
    if (!conversation) return;
    const actor = actorOf(req.user);
    const opts = { sender: 'agent', actor, replyToId: isId(req.body.reply_to) ? req.body.reply_to : null };
    let message;

    if (req.file) {
      message = await inbox.sendFile(conversation, req.file, String(req.body.caption || '').slice(0, 1024), opts);
    } else if (req.body.type === 'note') {
      const text = String(req.body.text || '').trim();
      if (!text) return res.status(400).json({ success: false, message: 'Write a note first' });
      message = await inbox.addInternal(conversation, { type: 'note', text, actor });
    } else if (req.body.type === 'template') {
      if (!isId(req.body.template_id)) return res.status(400).json({ success: false, message: 'Choose a template' });
      message = await inbox.sendTemplate(conversation, req.body.template_id, {
        bodyValues: Array.isArray(req.body.body_values) ? req.body.body_values : [],
        buttonValues: req.body.button_values || {},
      }, opts);
    } else {
      const text = String(req.body.text || '').trim();
      if (!text) return res.status(400).json({ success: false, message: 'Write a message first' });
      message = await inbox.sendText(conversation, text.slice(0, 4096), opts);
    }

    if (message.status === 'failed') {
      return res.status(502).json({ success: false, message: message.error?.message || 'WhatsApp did not accept the message', data: message });
    }
    res.status(201).json({ success: true, data: message });
  } catch (error) {
    fail(res, error, 'Failed to send the message');
  }
};

// POST /api/whatsapp-inbox/messages/:id/react { emoji }
exports.react = async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ success: false, message: 'Message not found' });
    const message = await WhatsappMessage.findById(req.params.id);
    const conversation = message && (await WhatsappConversation.findOne({ _id: message.conversation_id, ...scopeFor(req.user) }));
    if (!conversation) return res.status(404).json({ success: false, message: 'Message not found' });
    const updated = await inbox.react(conversation, message, String(req.body.emoji || '').slice(0, 8));
    res.json({ success: true, data: updated });
  } catch (error) {
    fail(res, error, 'Failed to react');
  }
};

// POST /api/whatsapp-inbox/conversations/:id/read
exports.markRead = async (req, res) => {
  try {
    const conversation = await loadConversation(req, res);
    if (!conversation) return;
    await inbox.markRead(conversation);
    res.json({ success: true });
  } catch (error) {
    fail(res, error, 'Failed to mark as read');
  }
};

// PATCH /api/whatsapp-inbox/conversations/:id { status, labels }
exports.updateConversation = async (req, res) => {
  try {
    const conversation = await loadConversation(req, res);
    if (!conversation) return;
    const who = req.user.name || 'A team member';

    if (req.body.status && req.body.status !== conversation.status) {
      if (!['open', 'pending', 'resolved'].includes(req.body.status)) return res.status(400).json({ success: false, message: 'Unknown status' });
      conversation.status = req.body.status;
      if (req.body.status === 'resolved') {
        // A resolved chat starts fresh: the automations and AI may answer it again.
        conversation.bot_paused = false;
        conversation.ai_reply_count = 0;
        conversation.unread_count = 0;
        await inbox.stopRuns(conversation._id, 'resolved');
      }
      await inbox.addEvent(conversation, `${who} marked the chat ${req.body.status}.`);
    }
    if (Array.isArray(req.body.labels)) {
      conversation.labels = [...new Set(req.body.labels.map((l) => String(l).trim().slice(0, 30)).filter(Boolean))].slice(0, 20);
    }
    await conversation.save();
    emitToAccount(conversation.user_id, 'whatsapp:conversation', { conversation_id: conversation.id });
    res.json({ success: true, data: shape(conversation) });
  } catch (error) {
    fail(res, error, 'Failed to update the chat');
  }
};

// POST /api/whatsapp-inbox/conversations/:id/assign { member_id }
exports.assign = async (req, res) => {
  try {
    const conversation = await loadConversation(req, res);
    if (!conversation) return;
    const memberId = req.body.member_id || null;
    if (req.user.isTeamMember && memberId && String(memberId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Team members can only assign chats to themselves' });
    }
    let member = null;
    if (memberId) {
      if (!isId(memberId)) return res.status(400).json({ success: false, message: 'Unknown team member' });
      member = await TeamMember.findOne({ _id: memberId, user_id: conversation.user_id, status: 'active' }).lean();
      if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });
    }
    conversation.assigned_member_id = memberId;
    await conversation.save();
    await inbox.addEvent(conversation, member ? `Assigned to ${nameOfMember(member)}.` : 'Unassigned.');
    if (member && String(member._id) !== String(req.user._id)) {
      sendNotification(req.app, member._id, 'info', 'WhatsApp chat assigned to you', `You were assigned the chat with ${conversation.profile_name || `+${conversation.wa_id}`}.`).catch(() => {});
    }
    emitToAccount(conversation.user_id, 'whatsapp:conversation', { conversation_id: conversation.id });
    res.json({ success: true, data: shape(conversation) });
  } catch (error) {
    fail(res, error, 'Failed to assign the chat');
  }
};

// POST /api/whatsapp-inbox/conversations/:id/bot { paused }
// Pausing stops the automation and AI in this chat; resuming lets them answer again.
exports.setBot = async (req, res) => {
  try {
    const conversation = await loadConversation(req, res);
    if (!conversation) return;
    const paused = !!req.body.paused;
    conversation.bot_paused = paused;
    if (!paused) conversation.ai_reply_count = 0;
    await conversation.save();
    if (paused) await inbox.stopRuns(conversation._id, 'paused_by_agent');
    await inbox.addEvent(conversation, paused ? 'Automation and AI paused for this chat.' : 'Automation and AI resumed for this chat.');
    emitToAccount(conversation.user_id, 'whatsapp:conversation', { conversation_id: conversation.id });
    res.json({ success: true, data: shape(conversation) });
  } catch (error) {
    fail(res, error, 'Failed to update the bot');
  }
};

// GET /api/whatsapp-inbox/team-members — active members whose team may reply on WhatsApp.
exports.teamMembers = async (req, res) => {
  try {
    const accountId = accountIdOf(req.user);
    const permission = await Permission.findOne({ slug: 'reply.whatsapp_inbox' }).select('_id').lean();
    const teamIds = permission ? (await TeamPermission.find({ permission_id: permission._id }).select('team_id').lean()).map((t) => t.team_id) : [];
    const query = { user_id: accountId, team_id: { $in: teamIds }, status: 'active' };
    if (req.user.isTeamMember) query._id = req.user._id;
    const members = await TeamMember.find(query).select('first_name last_name email avatar').lean();
    const counts = await WhatsappConversation.aggregate([
      { $match: { assigned_member_id: { $in: members.map((m) => m._id) }, status: { $ne: 'resolved' } } },
      { $group: { _id: '$assigned_member_id', n: { $sum: 1 } } },
    ]);
    const countBy = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
    res.json({
      success: true,
      data: members.map((m) => ({ id: String(m._id), name: nameOfMember(m), email: m.email, avatar: m.avatar, open_chats: countBy[String(m._id)] || 0 })),
    });
  } catch (error) {
    fail(res, error, 'Failed to load team members');
  }
};

// GET /api/whatsapp-inbox/templates — approved templates to restart a closed chat.
exports.templates = async (req, res) => {
  try {
    const accountId = accountIdOf(req.user);
    const numbers = await WhatsappPhoneNumber.find({ user_id: accountId, deleted_at: null }).select('waba_id').lean();
    const templates = await WhatsAppTemplate.find({ waba_id: { $in: numbers.map((n) => n.waba_id) }, status: 'approved' })
      .select('template_name language category message_body header buttons waba_id')
      .sort({ template_name: 1 })
      .lean();
    res.json({
      success: true,
      data: templates.map((t) => ({
        id: String(t._id),
        name: t.template_name,
        language: t.language,
        category: t.category,
        body: t.message_body || '',
        waba_id: String(t.waba_id),
        body_variables: (String(t.message_body || '').match(/\{\{\d+\}\}/g) || []).length,
        url_buttons: (t.buttons || []).map((b, i) => ((b.type === 'url' || b.type === 'website') && b.url?.includes('{{') ? i : null)).filter((i) => i !== null),
      })),
    });
  } catch (error) {
    fail(res, error, 'Failed to load templates');
  }
};

// GET /api/whatsapp-inbox/setup — what the inbox needs to work, for its getting-started banner.
exports.setup = async (req, res) => {
  try {
    const accountId = accountIdOf(req.user);
    const [numbers, settings, userSettings] = await Promise.all([
      WhatsappPhoneNumber.find({ user_id: accountId, deleted_at: null }).select('display_phone_number verified_name waba_id').populate('waba_id', 'whatsapp_business_account_id access_token').lean(),
      WhatsappInboxSetting.findOne({ user_id: accountId }).select('ai.enabled').lean(),
      UserSettings.findOne({ user: accountId }).select('ai_model ai_api_key').lean(),
    ]);
    const subscribed = await Promise.all(
      numbers.map((n) => (n.waba_id ? meta.isAppSubscribed(n.waba_id.whatsapp_business_account_id, n.waba_id.access_token) : null))
    );
    res.json({
      success: true,
      data: {
        numbers: numbers.map((n, i) => ({ id: String(n._id), display_phone_number: n.display_phone_number, verified_name: n.verified_name, webhook_subscribed: subscribed[i] })),
        ai_enabled: !!settings?.ai?.enabled,
        ai_model_configured: !!(userSettings?.ai_model && userSettings?.ai_api_key),
        webhook_path: '/api/whatsapp/webhook',
      },
    });
  } catch (error) {
    fail(res, error, 'Failed to load the inbox setup');
  }
};

// POST /api/whatsapp-inbox/setup/subscribe — asks Meta to send this account's messages to our webhook.
exports.subscribeWebhook = async (req, res) => {
  try {
    const numbers = await WhatsappPhoneNumber.find({ user_id: accountIdOf(req.user), deleted_at: null })
      .populate('waba_id', 'whatsapp_business_account_id access_token')
      .lean();
    const wabas = [...new Map(numbers.filter((n) => n.waba_id).map((n) => [String(n.waba_id._id), n.waba_id])).values()];
    if (!wabas.length) return res.status(400).json({ success: false, message: 'Connect a WhatsApp number first' });
    for (const waba of wabas) await meta.subscribeApp(waba.whatsapp_business_account_id, waba.access_token);
    res.json({ success: true, message: 'WhatsApp will now send new messages to Voxeno' });
  } catch (error) {
    res.status(502).json({ success: false, message: `Meta refused: ${error.message}` });
  }
};

// GET / PUT /api/whatsapp-inbox/quick-replies — saved replies for the composer.
exports.getQuickReplies = async (req, res) => {
  try {
    const settings = await WhatsappInboxSetting.findOne({ user_id: accountIdOf(req.user) }).select('quick_replies').lean();
    res.json({ success: true, data: settings?.quick_replies || [] });
  } catch (error) {
    fail(res, error, 'Failed to load quick replies');
  }
};

exports.saveQuickReplies = async (req, res) => {
  try {
    const list = (Array.isArray(req.body.quick_replies) ? req.body.quick_replies : [])
      .map((q) => ({ title: String(q?.title || '').trim().slice(0, 60), text: String(q?.text || '').trim().slice(0, 1024) }))
      .filter((q) => q.title && q.text)
      .slice(0, 100);
    const settings = await WhatsappInboxSetting.findOneAndUpdate(
      { user_id: accountIdOf(req.user) },
      { $set: { quick_replies: list } },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: settings.quick_replies });
  } catch (error) {
    fail(res, error, 'Failed to save quick replies');
  }
};
