'use strict';

const { db } = require('../models');
const { Call, User, CreditUsage, Setting, SMSLog, SmsMessage, WhatsAppLog } = db;

const { callCost } = require('../utils/callCost');

const round2 = (n) => Math.round(n * 100) / 100;

const emptyRow = () => ({
  calls: 0, minutes: 0, credits_used: 0, sms: 0, whatsapp: 0,
  usage: { stt_minutes: 0, tts_characters: 0, llm_tokens: 0 },
  cost: { telephony: 0, stt: 0, tts: 0, llm: 0, sms: 0, whatsapp: 0 },
});

// GET /api/usage-report?from=YYYY-MM-DD&to=YYYY-MM-DD
// Per client: what they used, what it cost you, what their credits earned you, and the profit.
exports.getUsageReport = async (req, res) => {
  try {
    const role = req.user.roleId?.name;
    if (role !== 'super_admin' && role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can view the cost report' });
    }

    const now = new Date();
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999`) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }
    const inRange = { created_at: { $gte: from, $lte: to } };

    // Not lean, so rates missing from the stored document get their schema defaults.
    const rates = (await Setting.findOne()) || {};
    const rows = new Map();
    const rowFor = (userId) => {
      const key = String(userId);
      if (!rows.has(key)) rows.set(key, emptyRow());
      return rows.get(key);
    };

    const calls = await Call.find({ ...inRange, user_id: { $ne: null } })
      .select('user_id duration usage')
      .lean();
    for (const call of calls) {
      const row = rowFor(call.user_id);
      const cost = callCost(call, rates);
      row.calls += 1;
      row.minutes += (call.duration || 0) / 60;
      row.usage.stt_minutes += (call.usage?.stt_seconds || 0) / 60;
      row.usage.tts_characters += call.usage?.tts_characters || 0;
      row.usage.llm_tokens += (call.usage?.llm_input_tokens || 0) + (call.usage?.llm_output_tokens || 0);
      for (const k of Object.keys(cost)) row.cost[k] += cost[k];
    }

    const credits = await CreditUsage.aggregate([
      { $match: { ...inRange, credits: { $lt: 0 } } },
      { $group: { _id: '$user_id', used: { $sum: { $multiply: ['$credits', -1] } } } },
    ]);
    for (const c of credits) rowFor(c._id).credits_used += c.used;

    const campaignSms = await SMSLog.aggregate([
      { $match: { ...inRange, direction: 'outbound', status: { $in: ['sent', 'delivered'] } } },
      { $group: { _id: '$user_id', n: { $sum: 1 } } },
    ]);
    const aiSms = await SmsMessage.aggregate([
      { $match: { ...inRange, role: 'ai' } },
      { $lookup: { from: 'sms_sessions', localField: 'session_id', foreignField: '_id', as: 'session' } },
      { $unwind: '$session' },
      { $group: { _id: '$session.user_id', n: { $sum: 1 } } },
    ]);
    for (const s of [...campaignSms, ...aiSms]) {
      const row = rowFor(s._id);
      row.sms += s.n;
      row.cost.sms += s.n * (rates.cost_sms_per_message || 0);
    }

    const whatsapp = await WhatsAppLog.aggregate([
      { $match: { ...inRange, direction: { $ne: 'inbound' }, status: { $ne: 'failed' } } },
      { $group: { _id: '$user_id', n: { $sum: 1 } } },
    ]);
    for (const w of whatsapp) {
      const row = rowFor(w._id);
      row.whatsapp += w.n;
      row.cost.whatsapp += w.n * (rates.cost_whatsapp_per_message || 0);
    }

    const users = await User.find({ _id: { $in: [...rows.keys()] } })
      .select('name email plan_id roleId')
      .populate('plan_id', 'name amount total_credits')
      .populate('roleId', 'name')
      .lean();
    const usersById = new Map(users.map((u) => [String(u._id), u]));

    const clients = [];
    const totals = { ...emptyRow(), revenue: 0, profit: 0 };
    for (const [userId, row] of rows) {
      const user = usersById.get(userId);
      const plan = user?.plan_id;
      // Revenue = credits used × what one credit costs on the client's plan.
      const pricePerCredit = plan?.total_credits > 0 ? (plan.amount || 0) / plan.total_credits : 0;
      const revenue = row.credits_used * pricePerCredit;
      const costTotal = Object.values(row.cost).reduce((a, b) => a + b, 0);
      const profit = revenue - costTotal;
      const isAdmin = ['super_admin', 'admin'].includes(user?.roleId?.name);

      clients.push({
        user: { id: userId, name: user?.name || 'Deleted user', email: user?.email || '', is_admin: isAdmin },
        plan: plan ? { name: plan.name, price_per_credit: round2(pricePerCredit) } : null,
        calls: row.calls,
        minutes: round2(row.minutes),
        credits_used: round2(row.credits_used),
        sms: row.sms,
        whatsapp: row.whatsapp,
        usage: {
          stt_minutes: round2(row.usage.stt_minutes),
          tts_characters: row.usage.tts_characters,
          llm_tokens: row.usage.llm_tokens,
        },
        cost: { ...Object.fromEntries(Object.entries(row.cost).map(([k, v]) => [k, round2(v)])), total: round2(costTotal) },
        revenue: round2(revenue),
        profit: round2(profit),
        margin_percent: revenue > 0 ? round2((profit / revenue) * 100) : null,
      });

      totals.calls += row.calls;
      totals.minutes += row.minutes;
      totals.credits_used += row.credits_used;
      totals.sms += row.sms;
      totals.whatsapp += row.whatsapp;
      for (const k of Object.keys(row.cost)) totals.cost[k] += row.cost[k];
      totals.revenue += revenue;
      totals.profit += profit;
    }
    clients.sort((a, b) => a.profit - b.profit);

    const totalCost = Object.values(totals.cost).reduce((a, b) => a + b, 0);
    res.json({
      success: true,
      from,
      to,
      clients,
      totals: {
        calls: totals.calls,
        minutes: round2(totals.minutes),
        credits_used: round2(totals.credits_used),
        sms: totals.sms,
        whatsapp: totals.whatsapp,
        cost: { ...Object.fromEntries(Object.entries(totals.cost).map(([k, v]) => [k, round2(v)])), total: round2(totalCost) },
        revenue: round2(totals.revenue),
        profit: round2(totals.profit),
        margin_percent: totals.revenue > 0 ? round2((totals.profit / totals.revenue) * 100) : null,
      },
    });
  } catch (error) {
    console.error('Usage report error:', error);
    res.status(500).json({ success: false, message: 'Failed to build the usage report' });
  }
};

