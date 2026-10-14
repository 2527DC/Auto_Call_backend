'use strict';

// The morning summary a client can turn on: yesterday's calls by outcome, the
// good leads, and today's follow-ups. By email, and/or WhatsApp (an approved
// template with one body variable). Sent once a day at 9 AM India time.

const { db } = require('../models');
const outcomeService = require('./outcomeService');

const { OutcomeSettings, Call, FollowUp, User } = db;
const IST_OFFSET_MS = 330 * 60000;
const istDay = (now) => {
  const d = new Date(now.getTime() + IST_OFFSET_MS);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST_OFFSET_MS);
  return { key: d.toISOString().slice(0, 10), start, end: new Date(start.getTime() + 86400000) };
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function buildSummary(userId, now = new Date()) {
  const today = istDay(now);
  const yesterday = { start: new Date(today.start.getTime() - 86400000), end: today.start };
  const settings = await outcomeService.getSettings(userId);
  const label = (k) => settings.outcomes.find(o => o.key === k)?.label || k;
  const [calls, byOutcome, good, dueToday, overdue] = await Promise.all([
    Call.countDocuments({ user_id: userId, created_at: { $gte: yesterday.start, $lt: yesterday.end } }),
    Call.aggregate([{ $match: { user_id: userId, created_at: { $gte: yesterday.start, $lt: yesterday.end }, 'outcome.key': { $ne: null } } }, { $group: { _id: '$outcome.key', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    Call.find({ user_id: userId, created_at: { $gte: yesterday.start, $lt: yesterday.end }, 'outcome.result': 'good', 'outcome.reached': true }).sort({ created_at: -1 }).limit(5).populate('contact_id', 'first_name last_name phone_number').select('outcome contact_id from_number to_number direction').lean(),
    FollowUp.countDocuments({ user_id: userId, status: { $in: ['pending', 'in_progress'] }, due_at: { $gte: today.start, $lt: today.end } }),
    FollowUp.countDocuments({ user_id: userId, status: { $in: ['pending', 'in_progress'] }, due_at: { $lt: today.start } })
  ]);
  const reached = byOutcome.filter(o => settings.outcomes.find(x => x.key === o._id)?.reached).reduce((s, o) => s + o.n, 0);
  return {
    day: today.key, calls, reached,
    outcomes: byOutcome.slice(0, 6).map(o => ({ label: label(o._id), n: o.n })),
    good: good.map(c => ({ name: [c.contact_id?.first_name, c.contact_id?.last_name].filter(Boolean).join(' ') || c.contact_id?.phone_number || (c.direction === 'inbound' ? c.from_number : c.to_number), label: c.outcome.label, summary: c.outcome.summary })),
    dueToday, overdue
  };
}

function summaryText(s) {
  const lines = [`Yesterday: ${s.calls} call(s), ${s.reached} reached.`];
  if (s.outcomes.length) lines.push(s.outcomes.map(o => `${o.label} ${o.n}`).join(', ') + '.');
  if (s.good.length) lines.push(`Good leads: ${s.good.map(g => `${g.name} (${g.label})`).join('; ')}.`);
  lines.push(`Today: ${s.dueToday} follow-up(s) due${s.overdue ? `, ${s.overdue} overdue` : ''}.`);
  return lines.join(' ');
}

function summaryHtml(s, appName = 'Voxeno') {
  const rows = s.outcomes.map(o => `<tr><td style="padding:4px 12px 4px 0">${escapeHtml(o.label)}</td><td style="padding:4px 0;text-align:right"><b>${o.n}</b></td></tr>`).join('');
  const good = s.good.map(g => `<li><b>${escapeHtml(g.name)}</b>: ${escapeHtml(g.label)}${g.summary ? ` – ${escapeHtml(g.summary)}` : ''}</li>`).join('');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<h2 style="margin:0 0 8px">Your calls yesterday</h2>
<p>${s.calls} call(s), ${s.reached} reached.</p>
${rows ? `<table>${rows}</table>` : ''}
${good ? `<h3 style="margin:16px 0 4px">Good leads</h3><ul>${good}</ul>` : ''}
<h3 style="margin:16px 0 4px">Today</h3>
<p>${s.dueToday} follow-up(s) due${s.overdue ? `, <b>${s.overdue} overdue</b>` : ''}.</p>
<p style="color:#888;font-size:12px">${escapeHtml(appName)} · turn this summary off in Settings → Call outcomes.</p></div>`;
}

// Every few minutes from 9 AM: clients with the summary on who haven't had today's.
async function sendDue(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  if (ist.getUTCHours() < 9) return 0;
  const today = istDay(now).key;
  const due = await OutcomeSettings.find({ 'digest.enabled': true, 'digest.last_sent_on': { $ne: today } }).limit(50).lean();
  let sent = 0;
  for (const s of due) {
    const claimed = await OutcomeSettings.findOneAndUpdate({ _id: s._id, 'digest.last_sent_on': { $ne: today } }, { $set: { 'digest.last_sent_on': today } });
    if (!claimed) continue;
    try {
      const summary = await buildSummary(s.user_id, now);
      if (s.digest.email) {
        const { sendMail } = require('../utils/mail');
        await sendMail(s.digest.email, `Calls summary for ${today}`, summaryHtml(summary));
      }
      if (s.digest.whatsapp_template_id && s.digest.whatsapp_to) {
        const whatsappService = require('./whatsappService');
        await whatsappService.sendTemplateMessage({ userId: s.user_id, to: s.digest.whatsapp_to, templateId: s.digest.whatsapp_template_id, dynamicData: { summary: summaryText(summary) } });
      }
      sent++;
    } catch (err) {
      console.error(`[Outcome digest] Client ${s.user_id}:`, err.message);
    }
  }
  return sent;
}

module.exports = { buildSummary, summaryText, summaryHtml, sendDue };
