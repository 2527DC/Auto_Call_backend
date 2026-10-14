'use strict';

// What happened on each call, and where each person stands.
//
// After a call ends it is analysed once:
//   - calls that didn't reach anyone get their outcome from a rule (free);
//   - otherwise the AI reads the transcript and picks one of the client's
//     outcomes, writes a summary and fills in the details to collect, each
//     backed by a quote that is checked against the transcript;
//   - a workflow "Set outcome" step, or the caller saying "don't call me",
//     decides the outcome instead of the AI; a person can change it later.
// The outcome then updates the contact's lead status (with history), unless a
// person has set that status themselves.

const { db } = require('../models');
const llmService = require('./llmService');
const { presetSettings, PRESETS, STATUS_OUTCOME } = require('../utils/outcomePresets');
const { cleanFieldValue } = require('../utils/fieldValue');
const { findOrCreateContact } = require('../utils/phone');
const { newUsage, runWithUsage } = require('../utils/usageMeter');

const { Call, Contact, Agent, OutcomeSettings, Setting, User, Form } = db;

const FINAL_STATUSES = ['completed', 'failed', 'busy', 'no-answer', 'canceled', 'declined', 'missed'];
const SHORT_CALL_S = 10;
// A reached call with no transcript yet waits this long for one (recordings are transcribed later).
const TRANSCRIPT_WAIT_MS = 15 * 60 * 1000;
// About 12k tokens: longer calls keep their end, where the outcome is decided.
const MAX_TRANSCRIPT_CHARS = 48000;
const MIN_CONFIDENCE = 0.5;
const MAX_AI_ATTEMPTS = 3;
const HISTORY_KEPT = 50;
// Outcomes that need no quote to be believed (little or nothing was said).
const NO_EVIDENCE_NEEDED = ['call_dropped', 'couldnt_understand', 'needs_review', 'transferred'];
const ADMIN_ROLES = ['super_admin', 'admin'];
// Contacts in these statuses keep them when a later call is analysed; only a person changes them.
const STICKY_STATUSES = ['converted', 'do_not_call'];

const FOLLOW_UP_DEFAULTS = { mode: 'ai_call', max_attempts: 2, retry_after_hours: 4, max_unreached: 3 };

// Text compared loosely: case, punctuation and spacing don't matter.
const loose = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

class OutcomeService {
  constructor() {
    this.settingCache = { at: 0, value: null };
  }

  // ---------- settings ----------

  async platformSettings() {
    if (Date.now() - this.settingCache.at < 30000 && this.settingCache.value) return this.settingCache.value;
    const s = await Setting.findOne().select('outcomes_mode outcomes_enabled_at credits_per_analysis calling_window_start calling_window_end').lean();
    this.settingCache = { at: Date.now(), value: s || {} };
    return this.settingCache.value;
  }

  clearCache() {
    this.settingCache = { at: 0, value: null };
  }

  // A client's outcomes and lead statuses: their own, else the General preset.
  // Rule-set outcomes (no answer, busy, needs review...) are always present.
  async getSettings(userId) {
    const saved = userId ? await OutcomeSettings.findOne({ user_id: userId }).lean() : null;
    const base = presetSettings(saved?.preset || 'general');
    if (!saved) return { ...base, follow_up: { ...FOLLOW_UP_DEFAULTS }, summary_language: 'English', version: 0, saved: false };
    const outcomes = [...(saved.outcomes || [])];
    for (const o of base.outcomes) if (o.system && !outcomes.some(x => x.key === o.key)) outcomes.push(o);
    const lead_statuses = saved.lead_statuses?.length ? saved.lead_statuses : base.lead_statuses;
    return {
      ...saved,
      outcomes,
      lead_statuses,
      success_description: saved.success_description || base.success_description,
      follow_up: { ...FOLLOW_UP_DEFAULTS, ...(saved.follow_up || {}) },
      saved: true
    };
  }

  // Is the analysis on for this call's owner and agent?
  async isEnabledFor(call, agent) {
    const mode = (await this.platformSettings()).outcomes_mode || 'off';
    if (mode === 'off') return false;
    if (agent && agent.analysis?.enabled === false) return false;
    if (mode === 'all') return true;
    const owner = await User.findById(call.user_id).populate('roleId', 'name').select('roleId').lean();
    return ADMIN_ROLES.includes(owner?.roleId?.name);
  }

  // ---------- requesting an analysis ----------

  // Queues the call for analysis (or runs it shortly, without Redis). Safe to
  // call from every place a call can end: the call is claimed only once.
  async request(callId, { delayMs = 4000, force = false } = {}) {
    if (!callId) return;
    const mode = (await this.platformSettings().catch(() => ({}))).outcomes_mode || 'off';
    if (mode === 'off' && !force) return;
    const queue = require('./outcomeQueue');
    if (queue.available()) return queue.add(String(callId), { delayMs, force });
    setTimeout(() => this.process(callId, { force }).catch(err => console.error('[Outcome] Analysis failed:', err.message)), delayMs).unref?.();
  }

  // ---------- the analysis ----------

  // Claims the call (once), decides its outcome, saves it, updates the contact.
  // force: run again on a call already analysed ("Re-analyse").
  async process(callId, { force = false } = {}) {
    const claimable = force
      ? { 'outcome.state': { $ne: 'processing' } }
      : { $or: [{ 'outcome.state': null }, { 'outcome.state': { $in: ['pending', 'waiting_transcript'] } }] };
    const call = await Call.findOneAndUpdate(
      { _id: callId, status: { $in: FINAL_STATUSES }, ...claimable },
      { $set: { 'outcome.state': 'processing', 'outcome.claimed_at': new Date() }, $inc: { 'outcome.attempts': 1 } },
      { new: true }
    );
    if (!call) return null;

    try {
      const agent = call.agent_id ? await Agent.findById(call.agent_id).lean() : null;
      if (!force && !(await this.isEnabledFor(call, agent))) {
        await Call.updateOne({ _id: call._id }, { $set: { 'outcome.state': 'skipped' } });
        return null;
      }
      const settings = await this.getSettings(call.user_id);
      const decided = await this.decide(call, agent, settings);
      if (decided.wait) {
        await Call.updateOne({ _id: call._id }, { $set: { 'outcome.state': 'waiting_transcript' } });
        return { state: 'waiting_transcript' };
      }
      if (decided.retry) {
        await Call.updateOne({ _id: call._id }, { $set: { 'outcome.state': 'pending', 'outcome.error': decided.error } });
        this.request(call._id, { delayMs: 60000 });
        return { state: 'pending' };
      }
      return await this.save(call, agent, settings, decided);
    } catch (err) {
      console.error(`[Outcome] Call ${call._id}: ${err.message}`);
      await Call.updateOne({ _id: call._id }, { $set: { 'outcome.state': 'failed', 'outcome.error': err.message.slice(0, 300) } });
      return null;
    }
  }

  outcomeDef(settings, key) {
    return settings.outcomes.find(o => o.key === key) || settings.outcomes.find(o => o.key === 'needs_review');
  }

  // The outcome for this call, and where it came from.
  async decide(call, agent, settings) {
    const signals = call.live_signals || [];
    const userTurns = (call.transcript || []).filter(t => t.role === 'user' && t.text?.trim());

    // 1. Nobody reached: a rule, no AI.
    if (call.status !== 'completed') {
      return { key: STATUS_OUTCOME[call.status] || 'failed', source: 'rule' };
    }
    const transcript = this.transcriptText(call);
    if (!userTurns.length && (call.duration || 0) < SHORT_CALL_S && (transcript || agent?.enable_call_transcription)) {
      return { key: 'hung_up_early', source: 'rule' };
    }

    // 2. A workflow step or an explicit "don't call me" decides the outcome; the AI still writes the summary.
    const workflow = [...signals].reverse().find(s => s.type === 'set_outcome' && s.outcome_key);
    const dnc = signals.some(s => s.type === 'do_not_call');
    const fixed = workflow ? { key: workflow.outcome_key, source: 'workflow', note: workflow.said } : dnc ? { key: 'do_not_call', source: 'live' } : null;

    // 3. No transcript yet: wait for the recording's, then a person reviews.
    if (!transcript) {
      const ended = new Date(call.ended_at || call.updated_at || call.created_at).getTime();
      if (Date.now() - ended < TRANSCRIPT_WAIT_MS) return { wait: true };
      return fixed || { key: 'needs_review', source: 'rule', error: 'No transcript (transcription is off for this agent?)' };
    }
    if (!userTurns.length && !fixed) {
      return { key: (call.duration || 0) < 20 ? 'hung_up_early' : 'voicemail', source: 'rule' };
    }

    // 4. The AI.
    const fields = await this.fieldsFor(agent);
    const allowed = settings.outcomes.filter(o => !o.archived && (!o.system || o.key === 'needs_review'));
    const usage = newUsage();
    const ai = await runWithUsage(usage, () => llmService.analyzeCall({
      transcript: transcript.length > MAX_TRANSCRIPT_CHARS ? transcript.slice(-MAX_TRANSCRIPT_CHARS) : transcript,
      outcomes: allowed,
      fields,
      signals: signals.filter(s => s.type !== 'set_outcome'),
      business: {
        type: PRESETS[settings.preset]?.label,
        success: agent?.analysis?.success_description || settings.success_description,
        instructions: [agent?.system_prompt, agent?.analysis?.extra_instructions].filter(Boolean).join('\n')
      },
      call: {
        direction: call.direction,
        duration: call.duration,
        when: new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(call.started_at || call.created_at)
      },
      language: settings.summary_language || 'English'
    }));

    if (!ai) {
      if ((call.outcome?.attempts || 0) < MAX_AI_ATTEMPTS && require('./outcomeQueue').available()) return { retry: true, error: 'AI unavailable' };
      // No AI: what the caller made clear during the call, else a person reviews.
      return fixed || this.fromSignals(signals) || { key: 'needs_review', source: 'rule', error: 'AI unavailable' };
    }
    const checked = this.check(ai, transcript, allowed, fields);
    if (fixed) return { ...checked, ...fixed, ai_suggestion: checked.key !== fixed.key ? { key: checked.key, confidence: checked.confidence } : undefined, usage, trimmed: transcript.length > MAX_TRANSCRIPT_CHARS };

    // A callback time the caller gave on the call wins over the AI's reading of it.
    const callLater = [...signals].reverse().find(s => s.type === 'call_later' && s.callback_at);
    if (callLater && !checked.follow_up?.at) checked.follow_up = { requested: true, at: callLater.callback_at, note: checked.follow_up?.note || 'Asked to be called back' };
    return { ...checked, source: 'ai', usage, trimmed: transcript.length > MAX_TRANSCRIPT_CHARS };
  }

  // When the AI can't be reached: what the caller said during the call.
  fromSignals(signals) {
    const order = ['do_not_call', 'wrong_person', 'not_interested', 'call_later', 'wants_human', 'couldnt_understand'];
    const map = { do_not_call: 'do_not_call', wrong_person: 'wrong_number', not_interested: 'not_interested', call_later: 'call_back', wants_human: 'complaint', couldnt_understand: 'couldnt_understand' };
    for (const type of order) {
      const s = [...signals].reverse().find(x => x.type === type);
      if (s) return { key: map[type], source: 'live', follow_up: s.callback_at ? { requested: true, at: s.callback_at, note: 'Asked to be called back' } : undefined };
    }
    return null;
  }

  // The AI's answer, checked: a known outcome, quotes that really are in the
  // transcript, details that fit their field types. Anything else is dropped,
  // and an outcome without proof or with low confidence goes to a person.
  check(ai, transcript, allowed, fields) {
    const haystack = loose(transcript);
    const quoted = (q) => {
      const l = loose(q);
      return l.length >= 2 && haystack.includes(l);
    };
    const keys = allowed.map(o => o.key);
    let key = keys.includes(ai.outcome) ? ai.outcome : 'needs_review';
    const reasons = (Array.isArray(ai.reasons) ? ai.reasons : [])
      .filter(r => r && typeof r.text === 'string')
      .slice(0, 3)
      .map(r => ({ text: r.text.slice(0, 300), quote: quoted(r.quote) ? String(r.quote).slice(0, 300) : undefined }));
    const confidence = typeof ai.confidence === 'number' ? Math.max(0, Math.min(1, ai.confidence)) : null;
    let ai_suggestion;
    const proven = reasons.some(r => r.quote);
    if (key !== 'needs_review' && ((!proven && !NO_EVIDENCE_NEEDED.includes(key)) || (confidence !== null && confidence < MIN_CONFIDENCE))) {
      ai_suggestion = { key, confidence, why: proven ? 'low confidence' : 'no quote from the call supports it' };
      key = 'needs_review';
    }

    const details = {};
    for (const f of fields) {
      const d = ai.details?.[f.key];
      if (!d || d.value === null || d.value === undefined || !quoted(d.quote)) continue;
      const value = cleanFieldValue(f, d.value);
      if (value !== null) details[f.key] = value;
    }

    const at = typeof ai.follow_up?.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ai.follow_up.at) ? new Date(`${ai.follow_up.at.slice(0, 16)}:00+05:30`) : null;
    return {
      key,
      summary: typeof ai.summary === 'string' ? ai.summary.trim().slice(0, 800) : null,
      sentiment: ['positive', 'neutral', 'negative'].includes(ai.sentiment) ? ai.sentiment : null,
      confidence,
      reasons,
      details,
      follow_up: ai.follow_up?.requested ? { requested: true, at: at && !Number.isNaN(at.getTime()) ? at : undefined, note: typeof ai.follow_up.note === 'string' ? ai.follow_up.note.slice(0, 300) : undefined } : undefined,
      ai_suggestion
    };
  }

  // Agent and person lines, plus a team member's after a transfer.
  transcriptText(call) {
    const label = { agent: 'Agent', user: 'Person', human: 'Team member' };
    const lines = (call.transcript || []).filter(t => t.text?.trim()).map(t => `${label[t.role] || 'Person'}: ${t.text.trim()}`);
    const human = (call.transfer_details?.human_transcript || []).filter(t => t.text?.trim()).map(t => `${t.role === 'human' ? 'Team member' : 'Person'}: ${t.text.trim()}`);
    return [...lines, ...human].join('\n');
  }

  // The agent's "details to collect": the fields of its Lead Capture Form.
  async fieldsFor(agent) {
    const formId = agent?.analysis?.form_id;
    if (!formId) return [];
    const form = await Form.findById(formId).select('fields').lean().catch(() => null);
    return (form?.fields || []).map(f => ({ key: f.key, label: f.label, type: f.type || 'text', options: f.options || [], hint: f.hint || f.question }));
  }

  // ---------- saving ----------

  async save(call, agent, settings, decided) {
    const def = this.outcomeDef(settings, decided.key);
    const now = new Date();
    const outcome = {
      state: 'done',
      key: def.key,
      label: def.label,
      reached: def.reached,
      result: def.result,
      summary: decided.summary || null,
      sentiment: decided.sentiment || null,
      confidence: decided.confidence ?? null,
      reasons: decided.reasons || [],
      details: decided.details && Object.keys(decided.details).length ? decided.details : undefined,
      follow_up: decided.follow_up,
      source: decided.source,
      ai_suggestion: decided.ai_suggestion,
      locked: false,
      set_by: null,
      set_at: now,
      model: decided.source === 'ai' || decided.usage ? 'ai' : null,
      settings_version: settings.version || 0,
      trimmed: decided.trimmed || undefined,
      error: decided.error || null,
      attempts: call.outcome?.attempts || 1,
      claimed_at: null,
      charged: !!call.outcome?.charged
    };

    // Re-analysing a call a person decided keeps their decision; the AI's answer is a suggestion.
    if (call.outcome?.locked) {
      const kept = { ...call.outcome.toObject?.() || call.outcome };
      kept.state = 'done';
      kept.ai_suggestion = { key: def.key, label: def.label, summary: outcome.summary, confidence: outcome.confidence, at: now };
      kept.claimed_at = null;
      await Call.updateOne({ _id: call._id }, { $set: { outcome: kept } });
      return kept;
    }

    const contact = await this.contactFor(call);
    const update = { $set: { outcome } };
    if (contact && !call.contact_id) update.$set.contact_id = contact._id;
    if (decided.usage) {
      update.$inc = { 'usage.llm_input_tokens': decided.usage.llm_input_tokens || 0, 'usage.llm_output_tokens': decided.usage.llm_output_tokens || 0 };
    }
    await Call.updateOne({ _id: call._id }, update);
    // (toObject() drops _id in this app, see models/index.js)
    const saved = { ...call.toObject(), _id: call._id, outcome, contact_id: contact?._id || call.contact_id };

    const change = contact ? await this.applyToContact(contact._id, saved, def, outcome.details, settings, { source: decided.source }) : null;
    await this.charge(saved, decided).catch(err => console.error('[Outcome] Charge failed:', err.message));
    this.afterOutcome(saved, def, settings, contact, change);
    console.log(`[Outcome] Call ${call._id}: ${def.key} (${decided.source})`);
    return outcome;
  }

  // Follow-ups, webhooks and alerts, off the analysis path (failures logged only).
  afterOutcome(call, def, settings, contact, change = null) {
    // Follow-ups, webhooks and alerts register themselves on load; make sure they're loaded.
    require('./followUpService');
    require('./outcomeNotifier');
    for (const hook of this.hooks || []) {
      Promise.resolve().then(() => hook(call, def, settings, contact, change)).catch(err => console.error('[Outcome] After-outcome step failed:', err.message));
    }
  }

  onOutcome(fn) {
    this.hooks = [...(this.hooks || []), fn];
  }

  // The person on the other end: the call's contact, or one created for the number.
  async contactFor(call) {
    if (call.contact_id) {
      const c = await Contact.findById(call.contact_id).select('_id').lean();
      if (c) return c;
    }
    const phone = call.direction === 'inbound' ? call.from_number : call.to_number;
    return findOrCreateContact(Contact, call.user_id, phone, { source: call.direction === 'inbound' ? 'inbound_call' : call.campaign_id ? 'campaign' : 'outbound_call', first_name: call.lead_name && call.lead_name !== 'Unknown' ? call.lead_name : '' }).catch(() => null);
  }

  // Credits for the analysis, if the platform charges for it (default: free).
  async charge(call, decided) {
    if (decided.source !== 'ai' || call.outcome?.charged) return;
    const price = Number((await this.platformSettings()).credits_per_analysis) || 0;
    if (price <= 0) return;
    const claimed = await Call.findOneAndUpdate({ _id: call._id, 'outcome.charged': { $ne: true } }, { $set: { 'outcome.charged': true } });
    if (!claimed) return;
    const creditService = require('./creditService');
    await creditService.deductCredits(call.user_id, price, 'analysis_deduction', 'AI call analysis', call._id, 'call', { allowNegative: true });
  }

  // ---------- the contact's lead status ----------

  // Moves the contact's status after a call, by the rules:
  //  - a status a person set is kept (later calls only suggest);
  //  - Converted and Do not call stay unless a person changes them;
  //  - a call that didn't reach the person never undoes one that did;
  //  - calls analysed out of order don't overwrite a newer call's status.
  async applyToContact(contactId, call, def, details, settings, { source, by = null } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const contact = await Contact.findById(contactId).lean();
      if (!contact) return null;
      const lead = { calls: 0, unreached_streak: 0, history: [], ...(contact.lead || {}) };
      const now = new Date();
      const callAt = new Date(call.ended_at || call.created_at || now);
      const from = lead.status || 'new';
      const byPerson = source === 'person';
      const newer = !lead.last_call_at || callAt >= new Date(lead.last_call_at) || byPerson;

      let to = def.lead_status || from;
      if (!def.reached) {
        lead.unreached_streak = newer ? (lead.unreached_streak || 0) + 1 : lead.unreached_streak || 0;
        to = ['new', 'attempting'].includes(from) ? 'attempting' : from;
        if (to === 'attempting' && lead.unreached_streak >= (settings.follow_up?.max_unreached || FOLLOW_UP_DEFAULTS.max_unreached)) to = 'unreachable';
      } else if (newer) {
        lead.unreached_streak = 0;
        lead.last_contacted_at = callAt;
      }
      if (!byPerson && STICKY_STATUSES.includes(from) && !def.stops_calls) to = from;
      if (!newer) to = from;
      let suggestion;
      if (lead.locked && !byPerson && !def.stops_calls) {
        if (to !== from) suggestion = to;
        to = from;
      }

      lead.calls = (lead.calls || 0) + (byPerson ? 0 : 1);
      if (newer) {
        lead.last_outcome_key = def.key;
        lead.last_outcome_label = def.label;
        lead.last_call_id = call._id;
        lead.last_call_at = callAt;
      }
      if (details && Object.keys(details).length) lead.details = newer ? { ...(lead.details || {}), ...details } : { ...details, ...(lead.details || {}) };
      if (def.stops_calls && !lead.dnc?.at) lead.dnc = { at: now, reason: byPerson ? 'Set by a person' : 'Asked on the call not to be contacted again', source: byPerson ? 'person' : 'call', by };
      if (to !== from || suggestion) {
        lead.history = [...(lead.history || []), { at: now, from, to: suggestion ? from : to, source: suggestion ? `${source} (suggested ${suggestion})` : source, call_id: call._id, outcome_key: def.key, by }].slice(-HISTORY_KEPT);
      }
      lead.status = to;
      lead.updated_at = now;

      const res = await Contact.updateOne({ _id: contactId, __v: contact.__v ?? null }, { $set: { lead }, $inc: { __v: 1 } });
      if (res.modifiedCount) return { lead, from, to, source };
    }
    console.error(`[Outcome] Contact ${contactId}: lead status not saved (changed by others meanwhile)`);
    return null;
  }

  // ---------- a person's decisions ----------

  // A person changes a call's outcome: kept on later re-analysis.
  async setCallOutcome({ callId, userId, key, note, actorId }) {
    const call = await Call.findOne({ _id: callId, user_id: userId });
    if (!call) return { error: 404 };
    const settings = await this.getSettings(userId);
    const def = settings.outcomes.find(o => o.key === key && !o.archived);
    if (!def) return { error: 400, message: 'Unknown outcome' };
    const previous = call.outcome?.key ? { key: call.outcome.key, label: call.outcome.label, source: call.outcome.source } : undefined;
    const outcome = {
      ...(call.outcome?.toObject?.() || {}),
      state: 'done', key: def.key, label: def.label, reached: def.reached, result: def.result,
      source: 'person', locked: true, set_by: actorId, set_at: new Date(),
      // The earlier reading (and its summary and quotes) becomes the suggestion.
      ai_suggestion: call.outcome?.key && call.outcome?.source !== 'person'
        ? { ...previous, summary: call.outcome.summary, reasons: call.outcome.reasons, confidence: call.outcome.confidence }
        : call.outcome?.ai_suggestion,
      summary: call.outcome?.source === 'person' ? call.outcome.summary : null,
      reasons: call.outcome?.source === 'person' ? call.outcome.reasons : [],
      note: note || undefined
    };
    await Call.updateOne({ _id: call._id }, { $set: { outcome } });
    const saved = { ...call.toObject(), _id: call._id, outcome };
    const contact = await this.contactFor(saved);
    let change = null;
    if (contact) {
      if (!call.contact_id) await Call.updateOne({ _id: call._id }, { $set: { contact_id: contact._id } });
      change = await this.applyToContact(contact._id, saved, def, null, settings, { source: 'person', by: actorId });
    }
    this.afterOutcome(saved, def, settings, contact, change);
    return { outcome };
  }

  // A person sets the contact's status: locked against later calls.
  // Leaving "Do not call" needs a reason.
  async setContactStatus({ contactId, userId, status, note, actorId }) {
    const contact = await Contact.findOne({ _id: contactId, user_id: userId }).lean();
    if (!contact) return { error: 404 };
    const settings = await this.getSettings(userId);
    if (!settings.lead_statuses.some(s => s.key === status)) return { error: 400, message: 'Unknown status' };
    const from = contact.lead?.status || 'new';
    if (from === 'do_not_call' && status !== 'do_not_call' && !String(note || '').trim()) {
      return { error: 400, message: 'A reason is needed to contact this person again' };
    }
    const now = new Date();
    const lead = { ...(contact.lead || {}), status, locked: true, updated_at: now };
    if (status === 'do_not_call') lead.dnc = { at: now, reason: note || 'Set by a person', source: 'person', by: actorId };
    else if (from === 'do_not_call') lead.dnc = undefined;
    lead.history = [...(lead.history || []), { at: now, from, to: status, source: 'person', by: actorId, note: note || undefined }].slice(-HISTORY_KEPT);
    await Contact.updateOne({ _id: contactId }, { $set: { lead }, $inc: { __v: 1 } });
    if (from !== status) {
      const label = (k) => settings.lead_statuses.find(s => s.key === k)?.label || k;
      require('./outcomeNotifier').leadStatusChanged(userId, contact, from, status, 'person', null, label).catch(() => {});
    }
    // "Do not call" stops what was planned for them.
    if (status === 'do_not_call') await require('./followUpService').cancelOpen(contactId, 'do_not_call');
    return { lead };
  }

  // Lets later calls move the status again.
  async unlockContactStatus({ contactId, userId, actorId }) {
    const res = await Contact.updateOne({ _id: contactId, user_id: userId }, { $set: { 'lead.locked': false, 'lead.updated_at': new Date() }, $push: { 'lead.history': { at: new Date(), source: 'person', by: actorId, note: 'Unlocked: calls may change the status again' } } });
    return res.matchedCount ? { ok: true } : { error: 404 };
  }

  // ---------- the sweeper ----------

  // Every minute (cron/outcomeSweeper.js): calls that ended without being
  // queued, analyses stuck after a restart, and transcripts that never came.
  async sweep() {
    const platform = await this.platformSettings();
    if (!platform.outcomes_mode || platform.outcomes_mode === 'off') return 0;
    const since = new Date(Math.max(Date.now() - 3 * 24 * 3600 * 1000, new Date(platform.outcomes_enabled_at || 0).getTime()));
    const settled = new Date(Date.now() - 30 * 1000);
    const stuck = new Date(Date.now() - 10 * 60 * 1000);

    await Call.updateMany({ 'outcome.state': 'processing', 'outcome.claimed_at': { $lt: stuck } }, { $set: { 'outcome.state': 'pending' } });
    const due = await Call.find({
      created_at: { $gte: since },
      status: { $in: FINAL_STATUSES },
      $or: [
        { 'outcome.state': null, updated_at: { $lt: settled } },
        { 'outcome.state': 'pending', updated_at: { $lt: new Date(Date.now() - 2 * 60 * 1000) } },
        { 'outcome.state': 'waiting_transcript', updated_at: { $lt: new Date(Date.now() - TRANSCRIPT_WAIT_MS) } }
      ]
    }).select('_id').limit(200).lean();
    for (const c of due) await this.request(c._id, { delayMs: 0 });
    return due.length;
  }
}

module.exports = new OutcomeService();
