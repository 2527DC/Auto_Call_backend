'use strict';

// Follow-ups: what to do next about a person, and when.
//   - From call outcomes: "call me at 6" becomes an AI callback (or a team task,
//     as the agent is set up); interested / needs details / complaint / couldn't
//     understand become team tasks; a call that reaches the person closes the
//     open ones; "do not call" cancels everything.
//   - Campaign "Auto retry": unanswered or busy calls are tried again later.
//   - Every minute, due AI callbacks are placed, within calling hours, only for
//     clients with credits, never to someone who asked not to be called.
// One open callback per person and one open task per reason; a newer one updates it.

const { db } = require('../models');
const outcomeService = require('./outcomeService');
const { nextAllowed, isAllowed, parseInterval } = require('../utils/callingWindow');
const { phoneVariants, findContactByPhone } = require('../utils/phone');
const { isDoNotContact } = require('../utils/doNotContact');

const { FollowUp, Contact, Agent, Campaign, Call, PhoneNumber, Notification } = db;

const OPEN = ['pending', 'in_progress'];
// Follow-ups that are about reaching the person: done once a call reaches them.
// Team tasks (interested, complaint, a note added by hand...) stay until a person closes them.
const CLOSED_BY_REACHING = ['callback_requested', 'missed_inbound', 'retry_not_reached', 'call_dropped', 'unreachable'];
// Due AI callbacks placed per minute in total, and per client.
const PER_RUN = 20;
const PER_CLIENT = 5;
// A placed call that hasn't reported back after this long counts as not reached.
const ATTEMPT_TIMEOUT_MS = 30 * 60 * 1000;
const NOT_REACHED_STATUSES = ['no-answer', 'missed', 'busy', 'declined', 'failed', 'canceled'];
const RETRY_LABEL = { 'no-answer': 'No Answer', missed: 'No Answer', canceled: 'No Answer', busy: 'Busy', declined: 'Busy', failed: 'Call Failed' };
const IST_OFFSET_MS = 330 * 60000;

const contactName = (c) => [c?.first_name, c?.last_name].filter(Boolean).join(' ');

// 11 AM India time on the next day (team tasks for interested people).
const nextMorning = (now = new Date()) => {
  const d = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 11, 0) - IST_OFFSET_MS);
};

class FollowUpService {
  constructor() {
    outcomeService.onOutcome((call, def, settings, contact) => this.fromOutcome(call, def, settings, contact));
  }

  async platformWindow() {
    const s = await outcomeService.platformSettings();
    return { start: s.calling_window_start ?? 10, end: s.calling_window_end ?? 21 };
  }

  // Who follows up for this agent: ai_call, team, or nobody (null).
  modeFor(agent, settings) {
    const mode = agent?.analysis?.follow_up_mode || 'default';
    if (mode === 'off') return null;
    if (mode === 'ai_call' || mode === 'team') return mode;
    return settings?.follow_up?.mode || 'ai_call';
  }

  // ---------- from call outcomes ----------

  async fromOutcome(call, def, settings, contactRef) {
    const contact = contactRef?._id ? await Contact.findById(contactRef._id).lean() : null;
    if (!contact) return;
    if (def.stops_calls) return this.cancelOpen(contact._id, 'do_not_call');

    // A call that was a follow-up attempt and didn't reach the person: try again or give up.
    if (!def.reached) {
      if (call.follow_up_id) return this.attemptFailed(call.follow_up_id, call);
      if (call.direction === 'inbound') {
        const agent = call.agent_id ? await Agent.findById(call.agent_id).lean() : null;
        const mode = this.modeFor(agent, settings);
        if (mode) await this.upsert({ call, contact, agent, reason: 'missed_inbound', mode, dueAt: new Date(), note: 'Missed incoming call' });
      }
      return;
    }

    // The person was reached: whatever was open for them is done.
    await this.closeOpen(contact._id, call.follow_up_id ? 'reached' : 'reached_by_later_call');

    const agent = call.agent_id ? await Agent.findById(call.agent_id).lean() : null;
    const mode = this.modeFor(agent, settings);
    if (!mode && def.next_step !== 'team_task') return;
    const askedAt = call.outcome?.follow_up?.at ? new Date(call.outcome.follow_up.at) : null;
    const said = (call.live_signals || []).filter(s => ['call_later', 'not_interested_offered_later'].includes(s.type)).map(s => s.said).filter(Boolean).pop() || '';

    if (def.next_step === 'follow_up') {
      if (def.key === 'call_back') {
        const due = askedAt && askedAt > new Date() ? askedAt : require('../utils/callerUnderstanding').defaultCallback().at;
        return this.upsert({ call, contact, agent, reason: 'callback_requested', mode: mode || 'team', dueAt: due, said, note: call.outcome?.follow_up?.note || 'Asked to be called back' });
      }
      // Interested / needs details: a person follows up, the next morning unless a time was agreed.
      return this.upsert({ call, contact, agent, reason: def.key === 'needs_info' ? 'needs_info' : 'interested', mode: 'team', dueAt: askedAt || nextMorning(), note: call.outcome?.follow_up?.note || call.outcome?.summary || def.label });
    }
    if (def.next_step === 'team_task') {
      return this.upsert({ call, contact, agent, reason: def.key, mode: 'team', dueAt: new Date(), note: call.outcome?.summary || def.label, urgent: def.key === 'complaint' });
    }
    if (def.next_step === 'retry' && mode) {
      const hours = settings.follow_up?.retry_after_hours || 4;
      return this.upsert({ call, contact, agent, reason: 'call_dropped', mode, dueAt: new Date(Date.now() + hours * 3600000), note: 'The call dropped before it was finished' });
    }
  }

  // ---------- campaign retries ----------

  // Called by the campaign worker once a call's final status is known. Retries
  // what the campaign's "Auto retry" asks for, after its interval.
  async scheduleRetry(callRef, campaign) {
    const retry = campaign?.autoRetrySettings;
    if (!retry?.enabled) return null;
    const call = await Call.findById(callRef._id || callRef).lean();
    if (!call || !NOT_REACHED_STATUSES.includes(call.status)) return null;
    if (call.follow_up_id) return this.attemptFailed(call.follow_up_id, call);
    if (!(retry.retryWhen || ['No Answer']).includes(RETRY_LABEL[call.status])) return null;
    const contact = call.contact_id ? await Contact.findById(call.contact_id).lean() : await findContactByPhone(Contact, call.user_id, call.to_number);
    if (isDoNotContact(contact)) return null;
    const maxRetries = Math.max(0, (Number(retry.maxAttempts) || 3) - 1);
    if (!maxRetries) return null;
    return this.upsert({
      call, contact, agent: { _id: campaign.agentId }, campaign, reason: 'retry_not_reached', mode: 'ai_call',
      dueAt: new Date(Date.now() + parseInterval(retry.retryInterval)), maxAttempts: maxRetries,
      note: `Campaign retry (${RETRY_LABEL[call.status]})`
    });
  }

  // ---------- creating and closing ----------

  // Creates the follow-up, or updates the open one of the same kind for this person (or number).
  // separate: always a new follow-up (one added by hand), never merged into an open one.
  async upsert({ call, contact, agent, campaign = null, reason, mode, dueAt, said = '', note = '', maxAttempts, urgent = false, createdBy = null, separate = false }) {
    const userId = call?.user_id || contact?.user_id;
    const phone = contact?.phone_e164 || contact?.phone_number || (call?.direction === 'inbound' ? call?.from_number : call?.to_number);
    if (!userId || !phone) return null;
    const settings = await outcomeService.getSettings(userId);
    const campaignDoc = campaign || (call?.campaign_id ? await Campaign.findById(call.campaign_id).select('callSchedule agentId phoneNumberId').lean() : null);

    let due = new Date(dueAt || Date.now());
    if (mode === 'ai_call') {
      const allowed = nextAllowed(due, { platform: await this.platformWindow(), schedule: campaignDoc?.callSchedule });
      if (allowed) due = allowed;
      else mode = 'team';
    }
    const fromNumber = call?.direction === 'inbound' ? call?.to_number : call?.from_number;
    const fields = {
      user_id: userId,
      contact_id: contact?._id || null,
      phone,
      name: contactName(contact) || (call?.lead_name && call.lead_name !== 'Unknown' ? call.lead_name : ''),
      call_id: call?._id || null,
      agent_id: agent?._id || call?.agent_id || null,
      campaign_id: campaignDoc?._id || call?.campaign_id || null,
      from_number: fromNumber || null,
      due_at: due,
      reason,
      note: String(note || '').slice(0, 500),
      said: String(said || '').slice(0, 300),
      mode,
      max_attempts: maxAttempts || settings.follow_up?.max_attempts || 2,
      created_by: createdBy
    };

    const match = contact?._id ? { contact_id: contact._id } : { user_id: userId, phone: { $in: phoneVariants(phone) } };
    // One open callback per person, and one open team task per reason: a new
    // "interested" never replaces an open complaint.
    const sameKind = CLOSED_BY_REACHING.includes(reason) ? { $in: CLOSED_BY_REACHING } : reason;
    const open = separate ? null : await FollowUp.findOne({ ...match, status: { $in: OPEN }, reason: sameKind }).sort({ created_at: -1 });
    let saved;
    if (open?.status === 'in_progress') return open;
    if (open) {
      Object.assign(open, fields, { attempts: 0, error: null });
      saved = await open.save();
    } else {
      saved = await FollowUp.create(fields);
    }
    if (contact?._id) await this.refreshContact(contact._id);
    if (mode === 'team') await this.notify(saved, urgent).catch(() => {});
    return saved;
  }

  // The person was reached: open callbacks and retries for them are done.
  async closeOpen(contactId, closedReason) {
    await FollowUp.updateMany(
      { contact_id: contactId, status: { $in: OPEN }, $or: [{ mode: 'ai_call' }, { reason: { $in: CLOSED_BY_REACHING } }] },
      { $set: { status: 'done', closed_at: new Date(), closed_reason: closedReason } }
    );
    await this.refreshContact(contactId);
  }

  async cancelOpen(contactId, closedReason) {
    await FollowUp.updateMany({ contact_id: contactId, status: { $in: OPEN } }, { $set: { status: 'cancelled', closed_at: new Date(), closed_reason: closedReason } });
    await this.refreshContact(contactId);
  }

  // The contact's next follow-up time, for the Leads list.
  async refreshContact(contactId) {
    const next = await FollowUp.findOne({ contact_id: contactId, status: { $in: OPEN } }).sort({ due_at: 1 }).select('due_at').lean();
    await Contact.updateOne({ _id: contactId }, { $set: { 'lead.next_follow_up_at': next?.due_at || null } });
  }

  // A follow-up call didn't reach the person: try again later, or give up and hand it to the team.
  async attemptFailed(followUpId, call) {
    const fu = await FollowUp.findOne({ _id: followUpId, status: { $in: OPEN } });
    if (!fu) return null;
    const settings = await outcomeService.getSettings(fu.user_id);
    if (fu.attempts >= fu.max_attempts) {
      fu.status = 'missed';
      fu.closed_at = new Date();
      fu.closed_reason = 'not_reached';
      await fu.save();
      if (fu.contact_id) await this.refreshContact(fu.contact_id);
      // Someone asked to be called back and we couldn't reach them: a person should try.
      if (['callback_requested', 'missed_inbound'].includes(fu.reason)) {
        const contact = fu.contact_id ? await Contact.findById(fu.contact_id).lean() : null;
        await this.upsert({ call, contact, agent: { _id: fu.agent_id }, reason: 'unreachable', mode: 'team', dueAt: new Date(), note: `Couldn't reach after ${fu.attempts} tries (${fu.note || fu.reason})` });
      }
      return fu;
    }
    const campaign = fu.campaign_id ? await Campaign.findById(fu.campaign_id).select('callSchedule autoRetrySettings').lean() : null;
    const wait = campaign?.autoRetrySettings?.retryInterval ? parseInterval(campaign.autoRetrySettings.retryInterval) : (settings.follow_up?.retry_after_hours || 4) * 3600000;
    const due = nextAllowed(new Date(Date.now() + wait), { platform: await this.platformWindow(), schedule: campaign?.callSchedule });
    fu.status = 'pending';
    fu.due_at = due || new Date(Date.now() + wait);
    await fu.save();
    if (fu.contact_id) await this.refreshContact(fu.contact_id);
    return fu;
  }

  async notify(fu, urgent, heading = null) {
    const title = heading || (urgent ? 'Urgent follow-up' : 'New follow-up');
    const who = fu.name || fu.phone;
    const notification = await Notification.create({ user_id: fu.user_id, type: 'FOLLOW_UP', title, message: `${who}: ${fu.note || fu.reason}`.slice(0, 300), data: { follow_up_id: fu._id, contact_id: fu.contact_id, call_id: fu.call_id } });
    require('./outcomeNotifier').pushNotification(notification);
  }

  // ---------- placing due callbacks ----------

  // Every minute (cron/followUpSweeper.js).
  async sweep(now = new Date()) {
    // Calls placed for a follow-up that never reported back.
    const stale = await FollowUp.find({ status: 'in_progress', last_attempt_at: { $lt: new Date(now.getTime() - ATTEMPT_TIMEOUT_MS) } }).limit(50);
    for (const fu of stale) {
      const call = fu.last_call_id ? await Call.findById(fu.last_call_id).lean() : null;
      if (call && call.status === 'completed') {
        fu.status = 'done';
        fu.closed_at = now;
        fu.closed_reason = 'reached';
        await fu.save();
        if (fu.contact_id) await this.refreshContact(fu.contact_id);
      } else {
        await this.attemptFailed(fu._id, call);
      }
    }

    // Team tasks that just became due: an alert and the "Follow-up Due" webhook, once.
    const teamDue = await FollowUp.find({ status: 'pending', mode: 'team', due_at: { $lte: now }, due_notified_at: null }).limit(100);
    for (const fu of teamDue) {
      const claimed = await FollowUp.findOneAndUpdate({ _id: fu._id, due_notified_at: null }, { $set: { due_notified_at: now } });
      if (!claimed) continue;
      // Tasks created already due were announced when they were created.
      if (now - fu.created_at > 60000) await this.notify(fu, false, 'Follow-up due now').catch(() => {});
      require('./webhookDispatcher').dispatchEvent(fu.user_id, 'Follow-up Due', {
        follow_up_id: String(fu._id), contact_id: fu.contact_id ? String(fu.contact_id) : null, name: fu.name, phone: fu.phone,
        due_at: fu.due_at, reason: fu.reason, note: fu.note, said: fu.said, mode: fu.mode, call_id: fu.call_id ? String(fu.call_id) : null
      });
    }

    const due = await FollowUp.find({ status: 'pending', mode: 'ai_call', due_at: { $lte: now } }).sort({ due_at: 1 }).limit(PER_RUN * 3);
    const perClient = {};
    let placed = 0;
    for (const fu of due) {
      if (placed >= PER_RUN) break;
      const key = String(fu.user_id);
      if ((perClient[key] || 0) >= PER_CLIENT) continue;
      const claimed = await FollowUp.findOneAndUpdate({ _id: fu._id, status: 'pending' }, { $set: { status: 'in_progress', last_attempt_at: now } }, { new: true });
      if (!claimed) continue;
      perClient[key] = (perClient[key] || 0) + 1;
      if (await this.place(claimed, now)) placed++;
    }
    return placed;
  }

  // Places one follow-up call, or explains why not (saved on the follow-up).
  async place(fu, now = new Date()) {
    const reschedule = async (due, error) => {
      fu.status = 'pending';
      fu.due_at = due;
      fu.error = error;
      await fu.save();
      return false;
    };
    const close = async (status, closedReason, error) => {
      fu.status = status;
      fu.closed_at = now;
      fu.closed_reason = closedReason;
      fu.error = error || null;
      await fu.save();
      if (fu.contact_id) await this.refreshContact(fu.contact_id);
      return false;
    };

    const contact = fu.contact_id ? await Contact.findById(fu.contact_id).lean() : await findContactByPhone(Contact, fu.user_id, fu.phone);
    if (isDoNotContact(contact)) return close('cancelled', 'do_not_call');

    const campaign = fu.campaign_id ? await Campaign.findById(fu.campaign_id).lean() : null;
    if (campaign && ['Cancelled'].includes(campaign.campaignStatus)) return close('cancelled', 'campaign_cancelled');
    const window = { platform: await this.platformWindow(), schedule: campaign?.callSchedule };
    if (!isAllowed(now, window)) {
      const next = nextAllowed(now, window);
      return next ? reschedule(next, null) : close('missed', 'no_calling_hours', 'The calling hours never allow a call');
    }

    const creditService = require('./creditService');
    if (!(await creditService.hasCredits(fu.user_id))) {
      await this.notify({ ...fu.toObject(), _id: fu._id, note: 'Callback not placed: no credits left' }, true).catch(() => {});
      return close('missed', 'no_credits', 'No credits left');
    }

    const agent = fu.agent_id ? await Agent.findById(fu.agent_id).lean() : null;
    if (!agent || agent.status === 'inactive') {
      fu.mode = 'team';
      fu.status = 'pending';
      fu.error = 'The agent is no longer available; handed to the team';
      await fu.save();
      return false;
    }

    // The business number the person knows: the one used on the original call.
    let from = null;
    if (fu.from_number) from = await PhoneNumber.findOne({ user_id: fu.user_id, phone_number: { $in: phoneVariants(fu.from_number) } }).lean();
    if (!from && campaign?.phoneNumberId) from = await PhoneNumber.findById(campaign.phoneNumberId).lean();
    if (!from) from = await PhoneNumber.findOne({ user_id: fu.user_id, agent_id: agent._id }).lean();
    if (!from) {
      fu.mode = 'team';
      fu.status = 'pending';
      fu.error = 'No phone number to call from; handed to the team';
      await fu.save();
      return false;
    }

    try {
      const { placeCall } = require('./outboundCallService');
      const call = await placeCall({
        userId: fu.user_id,
        agentId: agent._id,
        flowId: agent.flow_id || null,
        phoneNumber: fu.phone,
        fromNumber: from.phone_number,
        callFields: { follow_up_id: fu._id, campaign_id: fu.campaign_id || null, lead_name: fu.name || undefined }
      });
      fu.attempts += 1;
      fu.last_call_id = call._id;
      fu.last_attempt_at = now;
      fu.error = null;
      await fu.save();
      console.log(`[Follow-up] Called ${fu.phone} (${fu.reason}, attempt ${fu.attempts}/${fu.max_attempts})`);
      return true;
    } catch (err) {
      fu.attempts += 1;
      fu.error = String(err.message || err).slice(0, 300);
      await fu.save();
      console.error(`[Follow-up] Could not call ${fu.phone}: ${fu.error}`);
      if (err.status === 403) return close('cancelled', 'blocked', fu.error);
      await this.attemptFailed(fu._id, null);
      return false;
    }
  }

  // ---------- a person's actions ----------

  async create({ userId, contactId, dueAt, mode = 'team', note = '', assignedMemberId = null, actorId = null }) {
    const contact = await Contact.findOne({ _id: contactId, user_id: userId }).lean();
    if (!contact) return { error: 404, message: 'Lead not found' };
    if (mode === 'ai_call' && isDoNotContact(contact)) return { error: 400, message: 'This person asked not to be called' };
    const lastCall = await Call.findOne({ user_id: userId, contact_id: contact._id }).sort({ created_at: -1 }).lean();
    if (mode === 'ai_call' && !lastCall?.agent_id) return { error: 400, message: 'This person has no earlier call to take the agent and number from; choose a team follow-up' };
    const fu = await this.upsert({ call: lastCall, contact, agent: lastCall?.agent_id ? { _id: lastCall.agent_id } : null, reason: 'manual', mode, dueAt: dueAt ? new Date(dueAt) : new Date(), note, createdBy: actorId, separate: true });
    if (fu && assignedMemberId) await FollowUp.updateOne({ _id: fu._id }, { $set: { assigned_member_id: assignedMemberId } });
    return { followUp: fu };
  }
}

module.exports = new FollowUpService();
