'use strict';

const { db } = require('../models');
const { Call, User, CreditUsage, PaymentHistory, Plan, Role, Setting, SMSLog, SmsMessage, WhatsAppLog, AIModel } = db;

const { billedMinutes, callCost, typicalMinuteCost } = require('../utils/callCost');
const creditService = require('../services/creditService');

const round2 = (n) => Math.round(n * 100) / 100;
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
const isAdminRequest = (req) => ['super_admin', 'admin'].includes(req.user.roleId?.name);

const VOICE_PROVIDERS = ['deepgram', 'sarvam_ai', 'elevenlabs'];
// Real calls replace the estimate once a voice has this many tracked calls in the window.
const MIN_MEASURED_CALLS = 10;
const MEASURE_DAYS = 30;

const emptyRow = () => ({
  calls: 0, minutes: 0, credits_used: 0, sms: 0, whatsapp: 0, paid: 0,
  usage: { stt_minutes: 0, tts_characters: 0, llm_tokens: 0 },
  cost: { telephony: 0, stt: 0, tts: 0, llm: 0, sms: 0, whatsapp: 0 },
});

// GET /api/usage-report?from=YYYY-MM-DD&to=YYYY-MM-DD
// Per client: what they used, what it cost you, what their credits earned you, and the profit.
// Every client with a plan is listed, even with no usage in the range.
exports.getUsageReport = async (req, res) => {
  try {
    if (!isAdminRequest(req)) {
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

    // Money actually received in the range (plan purchases and top-ups).
    const payments = await PaymentHistory.aggregate([
      { $match: { ...inRange, payment_status: 'success', deleted_at: null } },
      { $group: { _id: '$user_id', paid: { $sum: '$amount' } } },
    ]);
    for (const p of payments) rowFor(p._id).paid += p.paid || 0;

    const adminRoles = await Role.find({ name: { $in: ['super_admin', 'admin'] } }).select('_id').lean();
    const subscribers = await User.find({ plan_id: { $ne: null }, roleId: { $nin: adminRoles.map((r) => r._id) } }).select('_id').lean();
    for (const u of subscribers) rowFor(u._id);

    const users = await User.find({ _id: { $in: [...rows.keys()] } })
      .select('name email plan_id roleId total_credits used_credits')
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
        credits_left: user && !isAdmin ? round2((user.total_credits || 0) - (user.used_credits || 0)) : null,
        paid: round2(row.paid),
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
      totals.paid += row.paid;
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
        paid: round2(totals.paid),
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

// GET /api/usage-report/credit-cost
// What one credit costs you for each voice and message type, and what each plan charges for one.
// Plans priced above cost_per_credit (the highest of these) never run at a loss.
exports.getCreditCost = async (req, res) => {
  try {
    if (!isAdminRequest(req)) {
      return res.status(403).json({ success: false, message: 'Only admins can view credit costs' });
    }

    // Not lean, so rates missing from the stored document get their schema defaults.
    const settings = (await Setting.findOne()) || new Setting();

    // Real cost per credit from the last 30 days of calls with recorded usage.
    const since = new Date(Date.now() - MEASURE_DAYS * 24 * 60 * 60 * 1000);
    const calls = await Call.find({ created_at: { $gte: since }, duration: { $gt: 0 }, 'usage.telephony_provider': { $ne: null } })
      .select('duration usage agent_id')
      .populate('agent_id', 'voice_provider')
      .lean();
    const measured = {};
    for (const call of calls) {
      const voice = call.agent_id?.voice_provider || call.usage.tts_provider || call.usage.stt_provider;
      if (!VOICE_PROVIDERS.includes(voice)) continue;
      if (!measured[voice]) measured[voice] = { calls: 0, cost: 0, credits: 0 };
      measured[voice].calls += 1;
      measured[voice].cost += sum(callCost(call, settings));
      measured[voice].credits += creditService.creditsForCall(settings, call.duration, voice);
    }

    const voices = VOICE_PROVIDERS.map((provider) => {
      // Credits a one-minute call uses; in per-call mode, the credits for one call.
      const creditsPerMinute = creditService.creditsForCall(settings, 60, provider);
      const estimated = typicalMinuteCost(settings, provider) / creditsPerMinute;
      const m = measured[provider];
      const real = m && m.calls >= MIN_MEASURED_CALLS && m.credits > 0 ? m.cost / m.credits : null;
      return {
        provider,
        credits_per_minute: creditsPerMinute,
        estimated_cost_per_credit: round2(estimated),
        measured_calls: m?.calls || 0,
        measured_cost_per_credit: real === null ? null : round2(real),
        cost_per_credit: round2(real ?? estimated),
      };
    });

    // Messages charged in credits: the provider's price spread over the credits each one uses.
    const messageCost = (creditsKey, costKey) => {
      const credits = settings[creditsKey] || 0;
      if (credits <= 0) return null;
      const cost = settings[costKey] || 0;
      return { credits_per_message: credits, cost_per_message: cost, cost_per_credit: round2(cost / credits) };
    };
    const sms = messageCost('credits_per_sms', 'cost_sms_per_message');
    const whatsapp = messageCost('credits_per_whatsapp_message', 'cost_whatsapp_per_message');

    const costPerCredit = Math.max(...voices.map((v) => v.cost_per_credit), sms?.cost_per_credit || 0, whatsapp?.cost_per_credit || 0);

    const plans = await Plan.find({ status: 'active', total_credits: { $gt: 0 } })
      .select('name amount total_credits plan_type billing_cycle visibility')
      .sort({ amount: 1 })
      .lean();

    res.json({
      success: true,
      deduction_type: settings.credit_deduction_type,
      measure_days: MEASURE_DAYS,
      min_measured_calls: MIN_MEASURED_CALLS,
      voices,
      sms,
      whatsapp,
      cost_per_credit: costPerCredit,
      plans: plans.map((plan) => {
        const price = (plan.amount || 0) / plan.total_credits;
        return {
          id: String(plan._id),
          name: plan.name,
          amount: plan.amount || 0,
          total_credits: plan.total_credits,
          plan_type: plan.plan_type,
          billing_cycle: plan.billing_cycle,
          visibility: plan.visibility,
          price_per_credit: round2(price),
          margin_percent: price > 0 ? round2(((price - costPerCredit) / price) * 100) : null,
        };
      }),
    });
  } catch (error) {
    console.error('Credit cost error:', error);
    res.status(500).json({ success: false, message: 'Failed to work out the credit cost' });
  }
};

const getModelPricing = (modelId, rates) => {
  const baseIn = rates?.cost_llm_input_per_1m_tokens || 14.55;
  const baseOut = rates?.cost_llm_output_per_1m_tokens || 58.2;
  const id = (modelId || '').toLowerCase();
  if (id.includes('gpt-4o-mini')) return { inputPer1M: baseIn, outputPer1M: baseOut };
  if (id.includes('gpt-4o') || id.includes('gpt-4-turbo')) return { inputPer1M: 215, outputPer1M: 860 };
  if (id.includes('claude-3-5-sonnet')) return { inputPer1M: 260, outputPer1M: 1300 };
  if (id.includes('claude-3-haiku')) return { inputPer1M: 22, outputPer1M: 110 };
  return { inputPer1M: baseIn, outputPer1M: baseOut };
};

// GET /api/usage-report/ai-insights?from=YYYY-MM-DD&to=YYYY-MM-DD&user_id=...&model=...
exports.getAiInsights = async (req, res) => {
  try {
    if (!isAdminRequest(req)) {
      return res.status(403).json({ success: false, message: 'Only admins can view AI insights' });
    }

    const now = new Date();
    // Default to last 30 days if from is not passed
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00`) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999`) : now;

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }

    const filter = {
      created_at: { $gte: from, $lte: to }
    };

    if (req.query.user_id && req.query.user_id !== 'all') {
      filter.user_id = req.query.user_id;
    }

    const rates = (await Setting.findOne()) || {};
    const calls = await Call.find(filter)
      .select('user_id agent_id campaign_id from_number to_number direction duration status usage telephony_provider credits_used created_at')
      .populate('user_id', 'name email')
      .populate({
        path: 'agent_id',
        select: 'name voice_provider llm_model telephony_provider',
        populate: { path: 'llm_model', select: 'name display_name provider model_id' }
      })
      .sort({ created_at: -1 })
      .lean();

    const selectedModel = req.query.model && req.query.model !== 'all' ? req.query.model : null;

    let totalCost = 0;
    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalSttSeconds = 0;
    let totalTtsChars = 0;
    let totalAiCalls = 0;
    let totalTelephonySeconds = 0;
    let totalTelephonyMinutes = 0;
    let costTelephony = 0;
    let costLlm = 0;
    let costStt = 0;
    let costTts = 0;

    const modelsMap = new Map();
    const phoneNumbersMap = new Map();
    const providersMap = {
      openai: { provider: 'OpenAI', service: 'LLM (Intelligence)', usage_label: 'Tokens', usage_value: 0, cost: 0 },
      deepgram: { provider: 'Deepgram', service: 'STT & TTS (Voice Engine)', usage_label: 'Minutes / Chars', usage_value: 0, cost: 0 },
      sarvam_ai: { provider: 'Sarvam AI', service: 'Indic STT / TTS', usage_label: 'Minutes / Chars', usage_value: 0, cost: 0 },
      elevenlabs: { provider: 'ElevenLabs', service: 'High-Fidelity TTS', usage_label: 'Characters', usage_value: 0, cost: 0 },
      plivo: { provider: 'Plivo', service: 'Telephony Carrier (Voice Calls)', usage_label: 'Minutes', usage_value: 0, cost: 0 },
      twilio: { provider: 'Twilio', service: 'Telephony Carrier (Voice Calls)', usage_label: 'Minutes', usage_value: 0, cost: 0 },
    };
    const clientsMap = new Map();
    const timelineMap = new Map();
    const recentCalls = [];

    // Pre-populate timeline with all days in range for smooth charts
    const dayMs = 24 * 60 * 60 * 1000;
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + dayMs)) {
      const dayKey = d.toISOString().slice(0, 10);
      timelineMap.set(dayKey, { date: dayKey, tokens: 0, input_tokens: 0, output_tokens: 0, cost: 0, calls: 0, ai_cost: 0, telephony_cost: 0 });
    }

    const discoveredModels = new Set();

    for (const call of calls) {
      const rawModel = call.usage?.llm_model || call.agent_id?.llm_model?.model_id || 'gpt-4o-mini';
      discoveredModels.add(rawModel);

      // Model filter
      if (selectedModel && rawModel !== selectedModel) {
        continue;
      }

      const llmProvider = call.usage?.llm_provider || call.agent_id?.llm_model?.provider || 'openai';
      const sttProvider = call.usage?.stt_provider || call.agent_id?.voice_provider || 'deepgram';
      const ttsProvider = call.usage?.tts_provider || call.agent_id?.voice_provider || 'deepgram';

      // Telephony Provider identification (handles BYO provider credentials & defaults)
      const rawTelProv = (call.usage?.telephony_provider || call.agent_id?.telephony_provider || 'plivo').toLowerCase();
      let normTelProv = 'plivo';
      if (rawTelProv.includes('twilio')) {
        normTelProv = 'twilio';
      } else if (rawTelProv.includes('sip')) {
        normTelProv = 'sip';
      } else if (rawTelProv.includes('whatsapp')) {
        normTelProv = 'meta_whatsapp';
      } else {
        normTelProv = 'plivo';
      }

      const inTokens = call.usage?.llm_input_tokens || 0;
      const outTokens = call.usage?.llm_output_tokens || 0;
      const callTokens = inTokens + outTokens;
      const sttSec = call.usage?.stt_seconds || 0;
      const ttsChars = call.usage?.tts_characters || 0;
      const callDuration = call.duration || 0;

      const pricing = getModelPricing(rawModel, rates);
      const callLlmCost = (inTokens / 1e6) * pricing.inputPer1M + (outTokens / 1e6) * pricing.outputPer1M;

      const sttRate = rates[`cost_stt_per_minute_${sttProvider}`] || (sttProvider === 'sarvam_ai' ? 0.5 : 0.42);
      const callSttCost = (sttSec / 60) * sttRate;

      const ttsRate = (rates[`cost_tts_per_1k_chars_${ttsProvider}`] || (ttsProvider === 'elevenlabs' ? 3.88 : (ttsProvider === 'sarvam_ai' ? 3.0 : 1.46))) / 1000;
      const callTtsCost = ttsChars * ttsRate;

      // Telephony billing logic: Plivo charges per 30s increments, others per minute
      const telBilledMins = billedMinutes(callDuration, normTelProv);
      const telRate = normTelProv === 'twilio'
        ? (rates.cost_telephony_per_minute_twilio || 1.10)
        : (normTelProv === 'sip'
          ? (rates.cost_telephony_per_minute_sip || 0.20)
          : (normTelProv === 'meta_whatsapp'
            ? (rates.cost_whatsapp_per_minute || 0.30)
            : (rates.cost_telephony_per_minute || 0.38)));
      const callTelephonyCost = telBilledMins * telRate;

      const callTotalAiCost = callLlmCost + callSttCost + callTtsCost;
      const callTotalCost = callTotalAiCost + callTelephonyCost;

      totalCost += callTotalCost;
      costTelephony += callTelephonyCost;
      totalTelephonySeconds += callDuration;
      totalTelephonyMinutes += telBilledMins;
      totalTokens += callTokens;
      totalInputTokens += inTokens;
      totalOutputTokens += outTokens;
      totalSttSeconds += sttSec;
      totalTtsChars += ttsChars;
      totalAiCalls += 1;
      costLlm += callLlmCost;
      costStt += callSttCost;
      costTts += callTtsCost;

      // Model breakdown
      if (!modelsMap.has(rawModel)) {
        modelsMap.set(rawModel, {
          model_id: rawModel,
          provider: llmProvider,
          calls_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          cost: 0,
        });
      }
      const mRow = modelsMap.get(rawModel);
      mRow.calls_count += 1;
      mRow.input_tokens += inTokens;
      mRow.output_tokens += outTokens;
      mRow.total_tokens += callTokens;
      mRow.cost += callLlmCost;

      // Provider breakdown
      const normLlmProv = (llmProvider || 'openai').toLowerCase();
      if (!providersMap[normLlmProv]) {
        providersMap[normLlmProv] = { provider: llmProvider, service: 'LLM', usage_label: 'Tokens', usage_value: 0, cost: 0 };
      }
      providersMap[normLlmProv].usage_value += callTokens;
      providersMap[normLlmProv].cost += callLlmCost;

      const normSttProv = (sttProvider || 'deepgram').toLowerCase();
      if (providersMap[normSttProv]) {
        providersMap[normSttProv].cost += callSttCost;
      }
      const normTtsProv = (ttsProvider || 'deepgram').toLowerCase();
      if (providersMap[normTtsProv]) {
        providersMap[normTtsProv].cost += callTtsCost;
        if (normTtsProv === 'elevenlabs') {
          providersMap[normTtsProv].usage_value += ttsChars;
        }
      }

      // Telephony provider breakdown (Plivo, Twilio, SIP)
      if (!providersMap[normTelProv]) {
        providersMap[normTelProv] = {
          provider: normTelProv === 'sip' ? 'SIP Trunk' : (normTelProv === 'meta_whatsapp' ? 'Meta WhatsApp' : normTelProv.toUpperCase()),
          service: 'Telephony Carrier (Voice Calls)',
          usage_label: 'Minutes',
          usage_value: 0,
          cost: 0,
        };
      }
      providersMap[normTelProv].usage_value += telBilledMins;
      providersMap[normTelProv].cost += callTelephonyCost;

      // Phone Number breakdown
      let rawPhone = null;
      if (call.direction === 'inbound') {
        rawPhone = call.to_number || call.from_number;
      } else {
        rawPhone = call.from_number || call.to_number;
      }
      if (!rawPhone || rawPhone === 'unknown') {
        rawPhone = 'Direct / WebRTC';
      }
      let cleanPhone = String(rawPhone).trim();
      if (/^\d{10,15}$/.test(cleanPhone)) {
        cleanPhone = `+${cleanPhone}`;
      }

      const telProviderLabel = normTelProv === 'plivo' ? 'Plivo' : (normTelProv === 'twilio' ? 'Twilio' : (normTelProv === 'sip' ? 'SIP Trunk' : 'Meta WhatsApp'));
      if (!phoneNumbersMap.has(cleanPhone)) {
        phoneNumbersMap.set(cleanPhone, {
          phone_number: cleanPhone,
          provider: telProviderLabel,
          calls_count: 0,
          inbound_calls: 0,
          outbound_calls: 0,
          duration_seconds: 0,
          billed_minutes: 0,
          telephony_cost: 0,
          ai_cost: 0,
          total_cost: 0,
          agent_names: new Set(),
          client_names: new Set(),
        });
      }
      const pRow = phoneNumbersMap.get(cleanPhone);
      pRow.calls_count += 1;
      if (call.direction === 'inbound') {
        pRow.inbound_calls += 1;
      } else {
        pRow.outbound_calls += 1;
      }
      pRow.duration_seconds += callDuration;
      pRow.billed_minutes += telBilledMins;
      pRow.telephony_cost += callTelephonyCost;
      pRow.ai_cost += callTotalAiCost;
      pRow.total_cost += callTotalCost;
      if (call.agent_id?.name) {
        pRow.agent_names.add(call.agent_id.name);
      }
      if (call.user_id?.name) {
        pRow.client_names.add(call.user_id.name);
      }

      // Timeline breakdown
      const callDay = (call.created_at ? new Date(call.created_at) : new Date()).toISOString().slice(0, 10);
      if (!timelineMap.has(callDay)) {
        timelineMap.set(callDay, { date: callDay, tokens: 0, input_tokens: 0, output_tokens: 0, cost: 0, calls: 0, ai_cost: 0, telephony_cost: 0 });
      }
      const tRow = timelineMap.get(callDay);
      tRow.tokens += callTokens;
      tRow.input_tokens += inTokens;
      tRow.output_tokens += outTokens;
      tRow.cost += callTotalCost;
      tRow.ai_cost = (tRow.ai_cost || 0) + callTotalAiCost;
      tRow.telephony_cost = (tRow.telephony_cost || 0) + callTelephonyCost;
      tRow.calls += 1;

      // Client breakdown
      const userId = call.user_id ? String(call.user_id._id || call.user_id) : 'unknown';
      if (!clientsMap.has(userId)) {
        clientsMap.set(userId, {
          user_id: userId,
          name: call.user_id?.name || 'Unknown Client',
          email: call.user_id?.email || '',
          calls_count: 0,
          total_tokens: 0,
          input_tokens: 0,
          output_tokens: 0,
          stt_minutes: 0,
          tts_characters: 0,
          telephony_minutes: 0,
          telephony_cost: 0,
          ai_cost: 0,
          cost: 0,
        });
      }
      const cRow = clientsMap.get(userId);
      cRow.calls_count += 1;
      cRow.total_tokens += callTokens;
      cRow.input_tokens += inTokens;
      cRow.output_tokens += outTokens;
      cRow.stt_minutes += sttSec / 60;
      cRow.tts_characters += ttsChars;
      cRow.telephony_minutes += telBilledMins;
      cRow.telephony_cost += callTelephonyCost;
      cRow.ai_cost += callTotalAiCost;
      cRow.cost += callTotalCost;

      // Recent calls (up to 50)
      if (recentCalls.length < 50) {
        recentCalls.push({
          id: String(call._id),
          created_at: call.created_at,
          user: {
            id: userId,
            name: call.user_id?.name || 'Unknown Client',
            email: call.user_id?.email || '',
          },
          agent: {
            id: call.agent_id ? String(call.agent_id._id || call.agent_id) : null,
            name: call.agent_id?.name || 'Direct / Flow Call',
          },
          phone_number: cleanPhone,
          direction: call.direction || 'outbound',
          telephony_provider: telProviderLabel,
          duration: callDuration,
          telephony_cost: round2(callTelephonyCost),
          ai_cost: round2(callTotalAiCost),
          cost: round2(callTotalCost),
          model: rawModel,
          provider: llmProvider,
          input_tokens: inTokens,
          output_tokens: outTokens,
          total_tokens: callTokens,
          stt_provider: sttProvider,
          tts_provider: ttsProvider,
          stt_seconds: round2(sttSec),
          tts_characters: ttsChars,
        });
      }
    }

    // Format models array with percentages
    const models = Array.from(modelsMap.values()).map((m) => ({
      ...m,
      cost: round2(m.cost),
      tokens_percentage: totalTokens > 0 ? round2((m.total_tokens / totalTokens) * 100) : 0,
      cost_percentage: totalCost > 0 ? round2((m.cost / totalCost) * 100) : 0,
    })).sort((a, b) => b.total_tokens - a.total_tokens);

    // Format phone numbers array
    const phoneNumbers = Array.from(phoneNumbersMap.values()).map((p) => ({
      phone_number: p.phone_number,
      provider: p.provider,
      calls_count: p.calls_count,
      inbound_calls: p.inbound_calls,
      outbound_calls: p.outbound_calls,
      duration_seconds: p.duration_seconds,
      billed_minutes: round2(p.billed_minutes),
      telephony_cost: round2(p.telephony_cost),
      ai_cost: round2(p.ai_cost),
      total_cost: round2(p.total_cost),
      cost_percentage: totalCost > 0 ? round2((p.total_cost / totalCost) * 100) : 0,
      agents: Array.from(p.agent_names).join(', ') || 'Direct Call',
      clients: Array.from(p.client_names).join(', ') || 'N/A',
    })).sort((a, b) => b.total_cost - a.total_cost);

    // Format providers array
    const providers = Object.values(providersMap).map((p) => ({
      ...p,
      usage_value: round2(p.usage_value),
      cost: round2(p.cost),
      percentage: totalCost > 0 ? round2((p.cost / totalCost) * 100) : 0,
    })).sort((a, b) => b.cost - a.cost);

    // Format clients array
    const clients = Array.from(clientsMap.values()).map((c) => ({
      ...c,
      stt_minutes: round2(c.stt_minutes),
      telephony_minutes: round2(c.telephony_minutes || 0),
      telephony_cost: round2(c.telephony_cost || 0),
      ai_cost: round2(c.ai_cost || 0),
      cost: round2(c.cost),
      tokens_percentage: totalTokens > 0 ? round2((c.total_tokens / totalTokens) * 100) : 0,
      cost_percentage: totalCost > 0 ? round2((c.cost / totalCost) * 100) : 0,
    })).sort((a, b) => b.cost - a.cost);

    // Format timeline array sorted by date
    const timeline = Array.from(timelineMap.values())
      .map((t) => ({
        ...t,
        cost: round2(t.cost),
        ai_cost: round2(t.ai_cost || 0),
        telephony_cost: round2(t.telephony_cost || 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Also get active AI models from database to offer in filters
    const registeredModels = await AIModel.find({ status: 'active' }).select('name display_name provider model_id').lean();
    const filterOptionsModels = Array.from(
      new Set([
        ...registeredModels.map((m) => m.model_id),
        ...Array.from(discoveredModels)
      ])
    ).filter(Boolean);

    res.json({
      success: true,
      from,
      to,
      filter: {
        user_id: req.query.user_id || 'all',
        model: selectedModel || 'all',
        available_models: filterOptionsModels,
      },
      summary: {
        total_cost: round2(totalCost),
        total_ai_cost: round2(costLlm + costStt + costTts),
        total_telephony_cost: round2(costTelephony),
        total_telephony_minutes: round2(totalTelephonyMinutes),
        cost_breakdown: {
          llm: round2(costLlm),
          stt: round2(costStt),
          tts: round2(costTts),
          telephony: round2(costTelephony),
        },
        total_tokens: totalTokens,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        total_calls: totalAiCalls,
        total_audio_minutes: round2(totalSttSeconds / 60),
        total_tts_chars: totalTtsChars,
        top_model: models[0]?.model_id || 'N/A',
        top_provider: providers[0]?.provider || 'N/A',
        top_phone_number: phoneNumbers[0]?.phone_number || 'N/A',
        avg_tokens_per_call: totalAiCalls > 0 ? Math.round(totalTokens / totalAiCalls) : 0,
        avg_cost_per_call: totalAiCalls > 0 ? round2(totalCost / totalAiCalls) : 0,
      },
      models,
      providers,
      phone_numbers: phoneNumbers,
      timeline,
      clients,
      recent_calls: recentCalls,
    });
  } catch (error) {
    console.error('AI insights error:', error);
    res.status(500).json({ success: false, message: 'Failed to build AI insights report' });
  }
};

