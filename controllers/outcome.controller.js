'use strict';

const { db } = require('../models');
const outcomeService = require('../services/outcomeService');
const { presetSettings, presetList, PRESETS } = require('../utils/outcomePresets');
const { phoneVariants } = require('../utils/phone');
const { csvCell } = require('../utils/csv');

const { Call, Contact, OutcomeSettings, Appointment } = db;

// Team members work on their owner's data.
const ownerOf = (req) => (req.user.isTeamMember ? req.user.user_id : req.user._id);
const actorOf = (req) => (req.user.isTeamMember ? null : req.user._id);
const isId = (v) => db.mongoose.Types.ObjectId.isValid(v);
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const KEY = /^[a-z][a-z0-9_]{1,39}$/;

// ---------- settings ----------

exports.getSettings = async (req, res) => {
  try {
    const userId = ownerOf(req);
    const [settings, templates] = await Promise.all([
      outcomeService.getSettings(userId),
      // Approved WhatsApp templates, for the morning summary.
      db.WhatsAppTemplate.find({ user_id: userId, status: { $in: ['APPROVED', 'approved'] } }).select('template_name language').limit(100).lean()
    ]);
    res.json({ success: true, data: { settings, presets: presetList(), whatsapp_templates: templates.map(t => ({ id: String(t._id), name: t.template_name, language: t.language })) } });
  } catch (error) {
    console.error('Get outcome settings error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

// Saves the client's outcomes and lead statuses. Rule-set outcomes can be
// renamed but not removed; every outcome needs its flags and a lead status
// that exists; keys never change once used (archive instead of delete).
exports.updateSettings = async (req, res) => {
  try {
    const userId = ownerOf(req);
    const current = await outcomeService.getSettings(userId);
    const body = req.body || {};

    const lead_statuses = Array.isArray(body.lead_statuses) ? body.lead_statuses : current.lead_statuses;
    for (const s of lead_statuses) {
      if (!KEY.test(s.key || '') || !String(s.label || '').trim()) return fail(res, 400, `Lead status "${s.label || s.key}" needs a name and a key of lowercase letters`);
      if (!['open', 'won', 'lost', 'closed'].includes(s.kind)) return fail(res, 400, `Lead status "${s.label}" needs a kind (open, won, lost or closed)`);
    }
    for (const base of presetSettings().lead_statuses) {
      if (!lead_statuses.some(s => s.key === base.key)) return fail(res, 400, `Lead status "${base.label}" can be renamed but not removed`);
    }
    const statusKeys = lead_statuses.map(s => s.key);

    const outcomes = Array.isArray(body.outcomes) ? body.outcomes : current.outcomes;
    const seen = new Set();
    for (const o of outcomes) {
      if (!KEY.test(o.key || '') || seen.has(o.key)) return fail(res, 400, `Outcome "${o.label || o.key}" needs a unique key of lowercase letters`);
      seen.add(o.key);
      if (!String(o.label || '').trim()) return fail(res, 400, `Outcome "${o.key}" needs a name`);
      if (!['good', 'bad', 'neutral'].includes(o.result)) return fail(res, 400, `Outcome "${o.label}" needs a result (good, bad or neutral)`);
      if (!['none', 'retry', 'follow_up', 'team_task'].includes(o.next_step)) return fail(res, 400, `Outcome "${o.label}" needs a next step`);
      if (o.lead_status && !statusKeys.includes(o.lead_status)) return fail(res, 400, `Outcome "${o.label}" points to an unknown lead status`);
      if (!o.system && !String(o.description || '').trim()) return fail(res, 400, `Outcome "${o.label}" needs a description: the AI uses it to recognise the outcome`);
    }
    for (const base of presetSettings().outcomes.filter(o => o.system)) {
      if (!outcomes.some(o => o.key === base.key)) return fail(res, 400, `Outcome "${base.label}" can be renamed but not removed`);
    }
    // Keys used on calls stay; removing one archives it.
    for (const old of current.outcomes) {
      if (!outcomes.some(o => o.key === old.key)) outcomes.push({ ...old, archived: true });
    }

    const update = {
      outcomes: outcomes.map((o, i) => ({
        key: o.key, label: String(o.label).trim().slice(0, 60), description: String(o.description || '').slice(0, 300),
        reached: !!o.reached, result: o.result, next_step: o.next_step, stops_calls: !!o.stops_calls,
        lead_status: o.lead_status || null, system: !!presetSettings().outcomes.find(b => b.key === o.key)?.system,
        archived: !!o.archived, order: Number.isFinite(o.order) ? o.order : i
      })),
      lead_statuses: lead_statuses.map((s, i) => ({ key: s.key, label: String(s.label).trim().slice(0, 40), kind: s.kind, order: Number.isFinite(s.order) ? s.order : i })),
      preset: PRESETS[body.preset] ? body.preset : current.preset,
      success_description: body.success_description !== undefined ? String(body.success_description).slice(0, 500) : current.success_description,
      summary_language: body.summary_language ? String(body.summary_language).slice(0, 30) : current.summary_language,
      follow_up: { ...current.follow_up, ...(body.follow_up || {}) },
      digest: { ...(current.digest || {}), ...(body.digest || {}) }
    };
    const dg = update.digest;
    dg.enabled = !!dg.enabled;
    dg.email = String(dg.email || '').trim().slice(0, 120);
    dg.whatsapp_to = String(dg.whatsapp_to || '').trim().slice(0, 20);
    if (dg.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(dg.email)) return fail(res, 400, 'Enter a valid email for the summary');
    if (dg.whatsapp_template_id && !isId(dg.whatsapp_template_id)) return fail(res, 400, 'Choose a WhatsApp template');
    if (dg.whatsapp_template_id && !(await db.WhatsAppTemplate.exists({ _id: dg.whatsapp_template_id, user_id: userId }))) return fail(res, 400, 'Choose one of your WhatsApp templates');
    if (dg.enabled && !dg.email && !(dg.whatsapp_template_id && dg.whatsapp_to)) return fail(res, 400, 'Add an email or a WhatsApp template and number for the summary');
    dg.last_sent_on = current.digest?.last_sent_on || null;
    const fu = update.follow_up;
    if (!['ai_call', 'team'].includes(fu.mode)) return fail(res, 400, 'Follow-up mode must be ai_call or team');
    for (const [k, min, max] of [['max_attempts', 1, 5], ['retry_after_hours', 1, 72], ['max_unreached', 1, 10]]) {
      fu[k] = Number(fu[k]);
      if (!Number.isFinite(fu[k]) || fu[k] < min || fu[k] > max) return fail(res, 400, `${k} must be between ${min} and ${max}`);
    }

    const saved = await OutcomeSettings.findOneAndUpdate(
      { user_id: userId },
      { $set: update, $inc: { version: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, message: 'Call outcomes saved', data: saved });
  } catch (error) {
    console.error('Update outcome settings error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

// Starts from a preset: its names replace the current ones; the client's own
// extra outcomes are kept.
exports.applyPreset = async (req, res) => {
  try {
    const { preset } = req.body || {};
    if (!PRESETS[preset]) return fail(res, 400, 'Unknown preset');
    const userId = ownerOf(req);
    const current = await outcomeService.getSettings(userId);
    const base = presetSettings(preset);
    const extra = current.saved ? current.outcomes.filter(o => !base.outcomes.some(b => b.key === o.key)) : [];
    const saved = await OutcomeSettings.findOneAndUpdate(
      { user_id: userId },
      { $set: { preset, success_description: base.success_description, outcomes: [...base.outcomes, ...extra], lead_statuses: base.lead_statuses }, $inc: { version: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, message: `Using the ${PRESETS[preset].label} preset`, data: saved });
  } catch (error) {
    console.error('Apply preset error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

// ---------- calls ----------

exports.setCallOutcome = async (req, res) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, 'Call not found');
    const result = await outcomeService.setCallOutcome({ callId: req.params.id, userId: ownerOf(req), key: req.body?.key, note: req.body?.note, actorId: actorOf(req) });
    if (result.error) return fail(res, result.error, result.message || 'Call not found');
    res.json({ success: true, message: 'Outcome updated', data: result.outcome });
  } catch (error) {
    console.error('Set call outcome error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

exports.reanalyzeCall = async (req, res) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, 'Call not found');
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    const callQuery = isAdmin ? { _id: req.params.id } : { _id: req.params.id, user_id: ownerOf(req) };
    const call = await Call.findOne(callQuery).select('_id status outcome.state').lean();
    if (!call) return fail(res, 404, 'Call not found');
    if (call.outcome?.state === 'processing') return fail(res, 409, 'This call is being analysed right now');
    const outcome = await outcomeService.process(call._id, { force: true });
    res.json({ success: true, message: outcome ? 'Call analysed again' : 'Nothing to analyse yet', data: outcome });
  } catch (error) {
    console.error('Re-analyse call error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

// Tries the current outcome settings on a past call without saving anything.
exports.testOnCall = async (req, res) => {
  try {
    const { call_id } = req.body || {};
    if (!isId(call_id)) return fail(res, 400, 'Choose a call');
    const userId = ownerOf(req);
    const call = await Call.findOne({ _id: call_id, user_id: userId });
    if (!call) return fail(res, 404, 'Call not found');
    const agent = call.agent_id ? await db.Agent.findById(call.agent_id).lean() : null;
    const settings = await outcomeService.getSettings(userId);
    const decided = await outcomeService.decide(call, agent, settings);
    if (decided.wait) return res.json({ success: true, data: { waiting: 'This call has no transcript yet' } });
    if (decided.retry) return fail(res, 503, 'The AI could not be reached; try again');
    const def = outcomeService.outcomeDef(settings, decided.key);
    const { usage, ...shown } = decided;
    res.json({ success: true, data: { ...shown, label: def.label, result: def.result, reached: def.reached, lead_status: def.lead_status } });
  } catch (error) {
    console.error('Test outcome error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

// Analyses past calls in a date range that have no outcome (at most 200 a run).
exports.analyzePastCalls = async (req, res) => {
  try {
    const { from, to, agent_id } = req.body || {};
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return fail(res, 400, 'Choose a valid date range');
    const query = { user_id: ownerOf(req), created_at: { $gte: start, $lte: end }, status: { $in: ['completed', 'failed', 'busy', 'no-answer', 'canceled', 'declined', 'missed'] }, $or: [{ 'outcome.state': null }, { 'outcome.state': 'skipped' }] };
    if (agent_id && isId(agent_id)) query.agent_id = agent_id;
    const calls = await Call.find(query).select('_id').sort({ created_at: -1 }).limit(200).lean();
    await Call.updateMany({ _id: { $in: calls.map(c => c._id) }, 'outcome.state': 'skipped' }, { $set: { 'outcome.state': null } });
    for (const c of calls) await outcomeService.request(c._id, { delayMs: 0, force: true });
    res.json({ success: true, message: `${calls.length} call(s) queued for analysis`, data: { queued: calls.length } });
  } catch (error) {
    console.error('Analyse past calls error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

// ---------- leads ----------

const leadRow = (c, labels) => ({
  id: String(c._id),
  name: [c.first_name, c.last_name].filter(Boolean).join(' '),
  first_name: c.first_name,
  last_name: c.last_name,
  phone_number: c.phone_number,
  email: c.email,
  source: c.source,
  is_blocked: c.is_blocked,
  created_at: c.created_at,
  lead: {
    ...(c.lead || {}),
    status: c.lead?.status || 'new',
    status_label: labels[c.lead?.status || 'new'] || c.lead?.status || 'New',
    history: undefined,
    notes: undefined,
    notes_count: c.lead?.notes?.length || 0
  }
});

async function leadQuery(req) {
  const userId = ownerOf(req);
  const { status, q, source, agent_id, campaign_id, from, to, due, all } = req.query;
  const query = { user_id: userId };
  if (!all) query['lead.status'] = { $ne: null };
  if (status) query['lead.status'] = status === 'new' ? { $in: [null, 'new'] } : status;
  if (source) query.source = source;
  if (q) {
    const rx = new RegExp(escapeRegex(String(q).slice(0, 60)), 'i');
    query.$or = [{ first_name: rx }, { last_name: rx }, { email: rx }, { phone_number: rx }, { phone_e164: rx }];
  }
  if (due === 'today') query['lead.next_follow_up_at'] = { $lte: new Date(new Date().setHours(23, 59, 59, 999)) };
  if (from || to) {
    query['lead.updated_at'] = {};
    if (from && !Number.isNaN(new Date(from).getTime())) query['lead.updated_at'].$gte = new Date(from);
    if (to && !Number.isNaN(new Date(to).getTime())) query['lead.updated_at'].$lte = new Date(to);
  }
  if ((agent_id && isId(agent_id)) || (campaign_id && isId(campaign_id))) {
    const callQuery = { user_id: userId, contact_id: { $ne: null } };
    if (agent_id && isId(agent_id)) callQuery.agent_id = agent_id;
    if (campaign_id && isId(campaign_id)) callQuery.campaign_id = campaign_id;
    query._id = { $in: await Call.distinct('contact_id', callQuery) };
  }
  return { userId, query };
}

exports.listLeads = async (req, res) => {
  try {
    const { userId, query } = await leadQuery(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const settings = await outcomeService.getSettings(userId);
    const labels = Object.fromEntries(settings.lead_statuses.map(s => [s.key, s.label]));
    const countsQuery = { ...query };
    delete countsQuery['lead.status'];
    if (!req.query.all) countsQuery['lead.status'] = { $ne: null };
    const [rows, total, counts] = await Promise.all([
      Contact.find(query).sort({ 'lead.updated_at': -1, created_at: -1 }).skip((page - 1) * limit).limit(limit).select('-lead.history').lean(),
      Contact.countDocuments(query),
      Contact.aggregate([{ $match: countsQuery }, { $group: { _id: { $ifNull: ['$lead.status', 'new'] }, n: { $sum: 1 } } }])
    ]);
    res.json({
      success: true,
      data: rows.map(c => leadRow(c, labels)),
      counts: Object.fromEntries(counts.map(c => [c._id, c.n])),
      statuses: settings.lead_statuses,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('List leads error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

// One person: their status and history, every call with its outcome, appointments and notes.
exports.getLead = async (req, res) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, 'Lead not found');
    const userId = ownerOf(req);
    const contact = await Contact.findOne({ _id: req.params.id, user_id: userId }).lean();
    if (!contact) return fail(res, 404, 'Lead not found');
    const settings = await outcomeService.getSettings(userId);
    const labels = Object.fromEntries(settings.lead_statuses.map(s => [s.key, s.label]));
    const variants = phoneVariants(contact.phone_number);
    const [calls, appointments] = await Promise.all([
      Call.find({ user_id: userId, $or: [{ contact_id: contact._id }, { from_number: { $in: variants } }, { to_number: { $in: variants } }] })
        .sort({ created_at: -1 }).limit(50)
        .select('direction status duration created_at started_at ended_at recording_url agent_id campaign_id outcome end_reason transcript')
        .populate('agent_id', 'name').populate('campaign_id', 'name').lean(),
      Appointment ? Appointment.find({ user_id: userId, phone: { $in: variants } }).sort({ appointment_date: -1 }).limit(20).lean() : []
    ]);
    res.json({
      success: true,
      data: {
        ...leadRow(contact, labels),
        lead: { ...(contact.lead || {}), status: contact.lead?.status || 'new', status_label: labels[contact.lead?.status || 'new'] },
        calls: calls.map(c => ({
          id: String(c._id), direction: c.direction, status: c.status, duration: c.duration, created_at: c.created_at,
          agent: c.agent_id?.name, campaign: c.campaign_id?.name, recording_url: c.recording_url, end_reason: c.end_reason,
          outcome: c.outcome, transcript: c.transcript
        })),
        appointments,
        follow_ups: (await db.FollowUp.find({ user_id: userId, contact_id: contact._id }).sort({ created_at: -1 }).limit(30)
          .populate('agent_id', 'name').populate('campaign_id', 'name').populate('assigned_member_id', 'name').lean()).map(followUpRow),
        statuses: settings.lead_statuses,
        outcomes: settings.outcomes.filter(o => !o.archived)
      }
    });
  } catch (error) {
    console.error('Get lead error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

exports.setLeadStatus = async (req, res) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, 'Lead not found');
    const result = await outcomeService.setContactStatus({ contactId: req.params.id, userId: ownerOf(req), status: req.body?.status, note: req.body?.note, actorId: actorOf(req) });
    if (result.error) return fail(res, result.error, result.message || 'Lead not found');
    res.json({ success: true, message: 'Status updated', data: result.lead });
  } catch (error) {
    console.error('Set lead status error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

exports.unlockLead = async (req, res) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, 'Lead not found');
    const result = await outcomeService.unlockContactStatus({ contactId: req.params.id, userId: ownerOf(req), actorId: actorOf(req) });
    if (result.error) return fail(res, 404, 'Lead not found');
    res.json({ success: true, message: 'Calls may change this status again' });
  } catch (error) {
    console.error('Unlock lead error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

exports.addLeadNote = async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return fail(res, 400, 'Write a note');
    if (!isId(req.params.id)) return fail(res, 404, 'Lead not found');
    const note = { text: text.slice(0, 1000), by: actorOf(req), at: new Date() };
    const result = await Contact.updateOne({ _id: req.params.id, user_id: ownerOf(req) }, { $push: { 'lead.notes': { $each: [note], $slice: -200 } } });
    if (!result.matchedCount) return fail(res, 404, 'Lead not found');
    res.json({ success: true, message: 'Note added', data: note });
  } catch (error) {
    console.error('Add lead note error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

exports.setLeadTags = async (req, res) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, 'Lead not found');
    const tags = [...new Set((Array.isArray(req.body?.tags) ? req.body.tags : []).map(t => String(t).trim().slice(0, 30)).filter(Boolean))].slice(0, 20);
    const result = await Contact.updateOne({ _id: req.params.id, user_id: ownerOf(req) }, { $set: { 'lead.tags': tags } });
    if (!result.matchedCount) return fail(res, 404, 'Lead not found');
    res.json({ success: true, message: 'Tags saved', data: tags });
  } catch (error) {
    console.error('Set lead tags error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

// Several leads at once: status, owner or a tag.
exports.bulkUpdateLeads = async (req, res) => {
  try {
    const { ids, action, value, note } = req.body || {};
    const userId = ownerOf(req);
    const list = (Array.isArray(ids) ? ids : []).filter(isId).slice(0, 500);
    if (!list.length) return fail(res, 400, 'Choose at least one lead');
    let done = 0;
    if (action === 'status') {
      for (const id of list) {
        const r = await outcomeService.setContactStatus({ contactId: id, userId, status: value, note, actorId: actorOf(req) });
        if (r.error === 400) return fail(res, 400, r.message);
        if (!r.error) done++;
      }
    } else if (action === 'owner') {
      if (value && !isId(value)) return fail(res, 400, 'Choose a team member');
      if (value && !(await db.TeamMember.exists({ _id: value, user_id: userId }))) return fail(res, 400, 'Choose one of your team members');
      done = (await Contact.updateMany({ _id: { $in: list }, user_id: userId }, { $set: { 'lead.owner_member_id': value || null } })).modifiedCount;
    } else if (action === 'tag') {
      const tag = String(value || '').trim().slice(0, 30);
      if (!tag) return fail(res, 400, 'Write a tag');
      done = (await Contact.updateMany({ _id: { $in: list }, user_id: userId }, { $addToSet: { 'lead.tags': tag } })).modifiedCount;
    } else {
      return fail(res, 400, 'Unknown action');
    }
    res.json({ success: true, message: `${done} lead(s) updated`, data: { updated: done } });
  } catch (error) {
    console.error('Bulk update leads error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

// The current list (same filters) as a CSV, with each captured detail as a column.
exports.exportLeads = async (req, res) => {
  try {
    const { userId, query } = await leadQuery(req);
    const settings = await outcomeService.getSettings(userId);
    const labels = Object.fromEntries(settings.lead_statuses.map(s => [s.key, s.label]));
    const rows = await Contact.find(query).sort({ 'lead.updated_at': -1 }).limit(10000).select('-lead.history').lean();
    const detailKeys = [...new Set(rows.flatMap(r => Object.keys(r.lead?.details || {})))];
    const header = ['Name', 'Phone', 'Email', 'Status', 'Last outcome', 'Last call', 'Next follow-up', 'Calls', 'Tags', 'Source', ...detailKeys];
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) {
      lines.push([
        [r.first_name, r.last_name].filter(Boolean).join(' '), r.phone_number, r.email,
        labels[r.lead?.status || 'new'] || r.lead?.status, r.lead?.last_outcome_label, r.lead?.last_call_at, r.lead?.next_follow_up_at,
        r.lead?.calls || 0, (r.lead?.tags || []).join('; '), r.source,
        ...detailKeys.map(k => r.lead?.details?.[k])
      ].map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + lines.join('\n'));
  } catch (error) {
    console.error('Export leads error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

// ---------- follow-ups ----------

const IST_OFFSET_MS = 330 * 60000;
const istDayBounds = (now = new Date()) => {
  const d = new Date(now.getTime() + IST_OFFSET_MS);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 86400000) };
};
const OPEN_FU = ['pending', 'in_progress'];

const followUpRow = (f) => ({
  id: String(f._id), contact_id: f.contact_id?._id ? String(f.contact_id._id) : f.contact_id ? String(f.contact_id) : null,
  name: f.name || [f.contact_id?.first_name, f.contact_id?.last_name].filter(Boolean).join(' '), phone: f.phone,
  due_at: f.due_at, reason: f.reason, note: f.note, said: f.said, mode: f.mode, status: f.status,
  attempts: f.attempts, max_attempts: f.max_attempts, error: f.error, closed_reason: f.closed_reason, closed_at: f.closed_at,
  call_id: f.call_id, last_call_id: f.last_call_id, agent: f.agent_id?.name || null, campaign: f.campaign_id?.name || null,
  assigned_member: f.assigned_member_id ? { id: String(f.assigned_member_id._id || f.assigned_member_id), name: f.assigned_member_id.name } : null,
  created_at: f.created_at
});

exports.listFollowUps = async (req, res) => {
  try {
    const userId = ownerOf(req);
    const { tab = 'due_today', mode, q, contact_id } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const { start, end } = istDayBounds();
    const base = { user_id: userId };
    if (mode && ['ai_call', 'team'].includes(mode)) base.mode = mode;
    if (contact_id && isId(contact_id)) base.contact_id = contact_id;
    if (q) {
      const rx = new RegExp(escapeRegex(String(q).slice(0, 60)), 'i');
      base.$or = [{ name: rx }, { phone: rx }, { note: rx }];
    }
    const tabs = {
      overdue: { status: { $in: OPEN_FU }, due_at: { $lt: start } },
      due_today: { status: { $in: OPEN_FU }, due_at: { $gte: start, $lt: end } },
      upcoming: { status: { $in: OPEN_FU }, due_at: { $gte: end } },
      done: { status: { $in: ['done', 'missed', 'cancelled'] } }
    };
    const query = { ...base, ...(tabs[tab] || tabs.due_today) };
    const sort = tab === 'done' ? { closed_at: -1, updated_at: -1 } : { due_at: 1 };
    const [rows, total, ...counts] = await Promise.all([
      db.FollowUp.find(query).sort(sort).skip((page - 1) * limit).limit(limit)
        .populate('contact_id', 'first_name last_name').populate('agent_id', 'name').populate('campaign_id', 'name').populate('assigned_member_id', 'name').lean(),
      db.FollowUp.countDocuments(query),
      ...Object.values(tabs).map(t => db.FollowUp.countDocuments({ ...base, ...t }))
    ]);
    res.json({
      success: true,
      data: rows.map(followUpRow),
      counts: Object.fromEntries(Object.keys(tabs).map((k, i) => [k, counts[i]])),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('List follow-ups error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

exports.createFollowUp = async (req, res) => {
  try {
    const { contact_id, due_at, mode = 'team', note, assigned_member_id } = req.body || {};
    if (!isId(contact_id)) return fail(res, 400, 'Choose a lead');
    if (!['ai_call', 'team'].includes(mode)) return fail(res, 400, 'Choose who follows up');
    if (due_at && Number.isNaN(new Date(due_at).getTime())) return fail(res, 400, 'Choose a valid time');
    if (assigned_member_id && !(isId(assigned_member_id) && await db.TeamMember.exists({ _id: assigned_member_id, user_id: ownerOf(req) }))) return fail(res, 400, 'Choose one of your team members');
    const followUpService = require('../services/followUpService');
    const result = await followUpService.create({ userId: ownerOf(req), contactId: contact_id, dueAt: due_at, mode, note, assignedMemberId: assigned_member_id || null, actorId: actorOf(req) });
    if (result.error) return fail(res, result.error, result.message);
    res.status(201).json({ success: true, message: 'Follow-up added', data: result.followUp });
  } catch (error) {
    console.error('Create follow-up error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

const ownFollowUp = async (req) => (isId(req.params.id) ? db.FollowUp.findOne({ _id: req.params.id, user_id: ownerOf(req) }) : null);

exports.updateFollowUp = async (req, res) => {
  try {
    const fu = await ownFollowUp(req);
    if (!fu) return fail(res, 404, 'Follow-up not found');
    if (!OPEN_FU.includes(fu.status)) return fail(res, 400, 'This follow-up is already closed');
    if (fu.status === 'in_progress') return fail(res, 409, 'The callback is being made right now');
    const { due_at, note, assigned_member_id, mode } = req.body || {};
    if (due_at !== undefined) {
      const d = new Date(due_at);
      if (Number.isNaN(d.getTime())) return fail(res, 400, 'Choose a valid time');
      fu.due_at = d;
      fu.attempts = 0;
      fu.error = null;
    }
    if (mode !== undefined) {
      if (!['ai_call', 'team'].includes(mode)) return fail(res, 400, 'Choose who follows up');
      fu.mode = mode;
    }
    if (note !== undefined) fu.note = String(note).slice(0, 500);
    if (assigned_member_id !== undefined) {
      if (assigned_member_id && !(isId(assigned_member_id) && await db.TeamMember.exists({ _id: assigned_member_id, user_id: ownerOf(req) }))) return fail(res, 400, 'Choose one of your team members');
      fu.assigned_member_id = assigned_member_id || null;
    }
    await fu.save();
    if (fu.contact_id) await require('../services/followUpService').refreshContact(fu.contact_id);
    res.json({ success: true, message: 'Follow-up updated', data: fu });
  } catch (error) {
    console.error('Update follow-up error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

const closeFollowUp = (status, closedReason, message) => async (req, res) => {
  try {
    const fu = await ownFollowUp(req);
    if (!fu) return fail(res, 404, 'Follow-up not found');
    if (!OPEN_FU.includes(fu.status)) return fail(res, 400, 'This follow-up is already closed');
    fu.status = status;
    fu.closed_at = new Date();
    fu.closed_reason = closedReason;
    if (req.body?.note) fu.note = [fu.note, String(req.body.note).slice(0, 500)].filter(Boolean).join(' | ');
    await fu.save();
    if (fu.contact_id) await require('../services/followUpService').refreshContact(fu.contact_id);
    res.json({ success: true, message, data: fu });
  } catch (error) {
    console.error('Close follow-up error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};
exports.completeFollowUp = closeFollowUp('done', 'by_person', 'Marked as done');
exports.cancelFollowUp = closeFollowUp('cancelled', 'by_person', 'Follow-up cancelled');

// The AI agent calls now (within calling hours), instead of at the due time.
exports.callFollowUpNow = async (req, res) => {
  try {
    const fu = await ownFollowUp(req);
    if (!fu) return fail(res, 404, 'Follow-up not found');
    if (fu.status !== 'pending') return fail(res, 400, fu.status === 'in_progress' ? 'The callback is being made right now' : 'This follow-up is already closed');
    if (!fu.agent_id) return fail(res, 400, 'No agent to call with; this follow-up is for the team');
    const claimed = await db.FollowUp.findOneAndUpdate({ _id: fu._id, status: 'pending' }, { $set: { status: 'in_progress', mode: 'ai_call', last_attempt_at: new Date() } }, { new: true });
    if (!claimed) return fail(res, 409, 'The callback is being made right now');
    const followUpService = require('../services/followUpService');
    const placed = await followUpService.place(claimed);
    const after = await db.FollowUp.findById(fu._id).lean();
    if (!placed) return fail(res, 400, after.error || (after.status === 'pending' ? `Outside calling hours; the call is set for ${new Date(after.due_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'The call could not be placed'));
    res.json({ success: true, message: 'Calling now', data: after });
  } catch (error) {
    console.error('Call follow-up now error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};

// ---------- campaigns ----------

// A new draft campaign (same agent, number, schedule and retries) with the
// people whose latest call in this campaign had one of the chosen outcomes.
// People who asked not to be called are left out.
exports.recallCampaign = async (req, res) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, 'Campaign not found');
    const userId = ownerOf(req);
    const keys = (Array.isArray(req.body?.outcome_keys) ? req.body.outcome_keys : []).filter(k => typeof k === 'string').slice(0, 30);
    if (!keys.length) return fail(res, 400, 'Choose at least one outcome');
    const campaign = await db.Campaign.findOne({ _id: req.params.id, userId }).lean();
    if (!campaign) return fail(res, 404, 'Campaign not found');

    const calls = await Call.find({ campaign_id: campaign._id, user_id: userId }).sort({ created_at: -1 }).select('to_number lead_name contact_id outcome.key').lean();
    const latest = new Map();
    for (const c of calls) if (!latest.has(c.to_number)) latest.set(c.to_number, c);
    const { findOrCreateContact } = require('../utils/phone');
    const { isDoNotContact } = require('../utils/doNotContact');
    const contactIds = [];
    let skipped = 0;
    for (const c of latest.values()) {
      if (!keys.includes(c.outcome?.key)) continue;
      const contact = c.contact_id ? await Contact.findById(c.contact_id).lean() : await findOrCreateContact(Contact, userId, c.to_number, { source: 'campaign', first_name: c.lead_name || '' });
      if (!contact || isDoNotContact(contact)) { skipped++; continue; }
      contactIds.push(contact._id);
    }
    if (!contactIds.length) return fail(res, 400, skipped ? 'Everyone with these outcomes asked not to be called' : 'No calls with these outcomes');

    const copy = await db.Campaign.create({
      name: `${campaign.name} – call again`.slice(0, 120),
      typeId: campaign.typeId,
      description: campaign.description,
      agentId: campaign.agentId,
      phoneNumberId: campaign.phoneNumberId,
      phoneNumberModel: campaign.phoneNumberModel,
      callSchedule: campaign.callSchedule,
      autoRetrySettings: campaign.autoRetrySettings,
      userId,
      contactIds,
      campaignStatus: 'Draft'
    });
    res.status(201).json({ success: true, message: `Draft campaign created with ${contactIds.length} contact(s)${skipped ? `; ${skipped} left out (do not call)` : ''}`, data: { id: copy._id, contacts: contactIds.length, skipped } });
  } catch (error) {
    console.error('Recall campaign error:', error);
    fail(res, 500, 'Internal Server Error');
  }
};
