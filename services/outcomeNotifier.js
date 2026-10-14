'use strict';

// Tells the outside world about outcomes: the "Call Analyzed" and "Lead Status
// Changed" webhooks, an in-app alert for good leads and complaints, and a row
// in the agent's Google Sheet. Runs after the outcome is saved; failures here
// never affect the outcome.

const { db } = require('../models');
const outcomeService = require('./outcomeService');
const webhookDispatcher = require('./webhookDispatcher');

const { Agent, Contact, Campaign, Notification, GoogleSheet } = db;
const contactName = (c) => [c?.first_name, c?.last_name].filter(Boolean).join(' ');
// Shown at once in the open app (the same event utils/notificationHelper sends).
const pushNotification = (notification) => {
  const io = require('../utils/realtime').getIo();
  if (io && notification) io.to(`user_${notification.user_id}`).emit('new-notification', notification);
};
// Sheets already given their header row (per process).
const sheetsWithHeader = new Set();

class OutcomeNotifier {
  constructor() {
    outcomeService.onOutcome((call, def, settings, contact, change) => this.onOutcome(call, def, settings, contact, change));
  }

  async onOutcome(call, def, settings, contactRef, change) {
    const [contact, agent, campaign] = await Promise.all([
      contactRef?._id ? Contact.findById(contactRef._id).select('first_name last_name phone_number email lead.status lead.details').lean() : null,
      call.agent_id ? Agent.findById(call.agent_id).select('name analysis').lean() : null,
      call.campaign_id ? Campaign.findById(call.campaign_id).select('name').lean() : null
    ]);
    const statusLabel = (key) => settings.lead_statuses.find(s => s.key === key)?.label || key;
    const payload = this.callPayload(call, def, contact, agent, campaign, statusLabel);
    const transcript = (call.transcript || []).map(t => ({ role: t.role, text: t.text }));

    await webhookDispatcher.dispatchEvent(call.user_id, 'Call Analyzed', payload, { transcript });
    if (change && change.from !== change.to) {
      await this.leadStatusChanged(call.user_id, contact, change.from, change.to, change.source, call._id, statusLabel);
    }
    await this.alert(call, def, contact).catch(err => console.error('[Outcome] Alert failed:', err.message));
    if (agent?.analysis?.google_sheet_id) {
      await this.appendToSheet(agent.analysis.google_sheet_id, call.user_id, payload).catch(err => console.error('[Outcome] Google Sheet row failed:', err.response?.data?.error?.message || err.message));
    }
  }

  callPayload(call, def, contact, agent, campaign, statusLabel) {
    const o = call.outcome || {};
    return {
      call_id: String(call._id),
      direction: call.direction,
      from: call.from_number,
      to: call.to_number,
      duration: call.duration,
      started_at: call.started_at,
      ended_at: call.ended_at,
      recording_url: call.recording_url || null,
      agent: agent ? { id: String(agent._id), name: agent.name } : null,
      campaign: campaign ? { id: String(campaign._id), name: campaign.name } : null,
      contact: contact ? { id: String(contact._id), name: contactName(contact), phone: contact.phone_number, email: contact.email || null } : null,
      outcome: {
        key: def.key, label: def.label, reached: def.reached, result: def.result,
        summary: o.summary || null, sentiment: o.sentiment || null, confidence: o.confidence ?? null,
        reasons: o.reasons || [], details: o.details || {}, follow_up: o.follow_up || null, source: o.source
      },
      lead: contact ? { status: contact.lead?.status || 'new', status_label: statusLabel(contact.lead?.status || 'new') } : null
    };
  }

  async leadStatusChanged(userId, contact, from, to, source, callId, statusLabel = (k) => k) {
    if (!contact || from === to) return;
    await webhookDispatcher.dispatchEvent(userId, 'Lead Status Changed', {
      contact: { id: String(contact._id), name: contactName(contact), phone: contact.phone_number },
      from: { key: from, label: statusLabel(from) },
      to: { key: to, label: statusLabel(to) },
      source,
      call_id: callId ? String(callId) : null
    });
  }

  // Good leads and complaints show up in the bell icon at once.
  async alert(call, def, contact) {
    const good = def.reached && def.result === 'good' && def.key !== 'query_answered';
    if (!good && def.key !== 'complaint') return;
    const who = contactName(contact) || contact?.phone_number || (call.direction === 'inbound' ? call.from_number : call.to_number);
    const notification = await Notification.create({
      user_id: call.user_id,
      type: def.key === 'complaint' ? 'COMPLAINT' : 'HOT_LEAD',
      title: def.key === 'complaint' ? 'Complaint on a call' : `${def.label}`,
      message: `${who}: ${call.outcome?.summary || def.label}`.slice(0, 300),
      data: { call_id: call._id, contact_id: contact?._id || null, outcome: def.key }
    });
    pushNotification(notification);
  }

  // One row per analysed call in the agent's chosen sheet.
  async appendToSheet(googleSheetId, userId, p) {
    const sheet = await GoogleSheet.findOne({ _id: googleSheetId, user_id: userId, deleted_at: null }).lean();
    if (!sheet?.spreadsheet_id || !sheet.google_account_id) return;
    const { getSheetsClient } = require('../utils/google-api-helper');
    const sheets = await getSheetsClient(sheet.google_account_id);
    const tab = sheet.sheet_name || 'Sheet1';
    const detailKeys = Object.keys(p.outcome.details || {});
    const key = `${sheet.spreadsheet_id}|${tab}`;
    if (!sheetsWithHeader.has(key)) {
      const first = await sheets.spreadsheets.values.get({ spreadsheetId: sheet.spreadsheet_id, range: `${tab}!A1:A1` });
      if (!first.data.values?.length) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: sheet.spreadsheet_id, range: `${tab}!A1`, valueInputOption: 'RAW',
          requestBody: { values: [['Date (IST)', 'Name', 'Phone', 'Direction', 'Agent', 'Campaign', 'Outcome', 'Lead status', 'Summary', 'Follow-up', 'Details', 'Call ID']] }
        });
      }
      sheetsWithHeader.add(key);
    }
    const when = p.ended_at || p.started_at;
    const row = [
      when ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(when)) : '',
      p.contact?.name || '', p.contact?.phone || (p.direction === 'inbound' ? p.from : p.to), p.direction, p.agent?.name || '', p.campaign?.name || '',
      p.outcome.label, p.lead?.status_label || '', p.outcome.summary || '',
      p.outcome.follow_up?.at ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(p.outcome.follow_up.at)) : '',
      detailKeys.map(k => `${k}: ${p.outcome.details[k]}`).join('; '),
      p.call_id
    ];
    // RAW: a value like "=1+1" said on a call stays text, never a formula.
    await sheets.spreadsheets.values.append({ spreadsheetId: sheet.spreadsheet_id, range: `${tab}!A1`, valueInputOption: 'RAW', requestBody: { values: [row] } });
  }
}

module.exports = new OutcomeNotifier();
module.exports.pushNotification = pushNotification;
