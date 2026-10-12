'use strict';

const mongoose = require('mongoose');
const { db } = require('../models');
const { Call, Plan, PriceQuote, Setting } = db;

const { callCost, USAGE_PROFILES } = require('../utils/callCost');

const round2 = (n) => Math.round(n * 100) / 100;
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const VOICE_PROVIDERS = ['deepgram', 'sarvam_ai', 'elevenlabs'];
const QUOTE_STATUSES = ['draft', 'sent', 'negotiating', 'won', 'lost'];
// A measured cost per minute is shown once a voice has this many tracked calls.
const MIN_MEASURED_CALLS = 10;
const MEASURE_DAYS = 30;
// Plivo's monthly rent for one Indian number (docs/understanding/calling_cost_and_providers.md).
const NUMBER_RENTAL_PER_MONTH = 200;

// GET /api/price-estimator/rates
// Everything the estimator needs to price a deal: provider rates from Settings → Credits,
// per-minute usage profiles, the real cost per minute from recent calls, and the plans.
exports.getRates = async (req, res) => {
  try {
    // Not lean, so rates missing from the stored document get their schema defaults.
    const settings = (await Setting.findOne()) || new Setting();

    const since = new Date(Date.now() - MEASURE_DAYS * 24 * 60 * 60 * 1000);
    const calls = await Call.find({ created_at: { $gte: since }, duration: { $gt: 0 }, 'usage.telephony_provider': { $ne: null } })
      .select('duration usage agent_id')
      .populate('agent_id', 'voice_provider')
      .lean();
    const measured = {};
    for (const call of calls) {
      const voice = call.agent_id?.voice_provider || call.usage.tts_provider || call.usage.stt_provider;
      if (!VOICE_PROVIDERS.includes(voice)) continue;
      if (!measured[voice]) measured[voice] = { calls: 0, minutes: 0, cost: 0 };
      measured[voice].calls += 1;
      measured[voice].minutes += call.duration / 60;
      measured[voice].cost += sum(callCost(call, settings));
    }

    const plans = await Plan.find({ status: 'active', total_credits: { $gt: 0 } })
      .select('name amount total_credits plan_type billing_cycle visibility')
      .sort({ amount: 1 })
      .lean();

    const perVoice = (prefix) => Object.fromEntries(VOICE_PROVIDERS.map((p) => [p, settings[`${prefix}_${p}`] || 0]));

    res.json({
      success: true,
      rates: {
        telephony_per_minute: settings.cost_telephony_per_minute || 0,
        number_rental_per_month: NUMBER_RENTAL_PER_MONTH,
        stt_per_minute: perVoice('cost_stt_per_minute'),
        tts_per_1k_chars: perVoice('cost_tts_per_1k_chars'),
        llm_input_per_1m_tokens: settings.cost_llm_input_per_1m_tokens || 0,
        llm_output_per_1m_tokens: settings.cost_llm_output_per_1m_tokens || 0,
        sms_per_message: settings.cost_sms_per_message || 0,
        whatsapp_per_message: settings.cost_whatsapp_per_message || 0,
      },
      usage_profiles: USAGE_PROFILES,
      measure_days: MEASURE_DAYS,
      min_measured_calls: MIN_MEASURED_CALLS,
      measured: Object.fromEntries(VOICE_PROVIDERS.map((p) => {
        const m = measured[p];
        return [p, {
          calls: m?.calls || 0,
          cost_per_minute: m && m.calls >= MIN_MEASURED_CALLS && m.minutes > 0 ? round2(m.cost / m.minutes) : null,
        }];
      })),
      credits: {
        deduction_type: settings.credit_deduction_type,
        credits_per_minute: settings.credits_per_minute || 1,
        credits_per_call: settings.credits_per_call || 1,
        credits_per_sms: settings.credits_per_sms || 0,
        credits_per_whatsapp_message: settings.credits_per_whatsapp_message || 0,
        multipliers: perVoice('credit_multiplier'),
      },
      plans: plans.map((plan) => ({
        id: String(plan._id),
        name: plan.name,
        amount: plan.amount || 0,
        total_credits: plan.total_credits,
        plan_type: plan.plan_type,
        billing_cycle: plan.billing_cycle,
        visibility: plan.visibility,
        price_per_credit: round2((plan.amount || 0) / plan.total_credits),
      })),
    });
  } catch (error) {
    console.error('Price estimator rates error:', error);
    res.status(500).json({ success: false, message: 'Failed to load the estimator rates' });
  }
};

const text = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Only the fields a quote has, with numbers and lists cleaned up.
const quoteFields = (body) => {
  const client = body.client || {};
  const summary = body.summary || {};
  return {
    client: {
      name: text(client.name, 200),
      company: text(client.company, 200),
      phone: text(client.phone, 50),
      email: text(client.email, 200),
      industry: text(client.industry, 100),
      city: text(client.city, 100),
    },
    status: QUOTE_STATUSES.includes(body.status) ? body.status : 'draft',
    inputs: body.inputs && typeof body.inputs === 'object' ? body.inputs : {},
    requirements: (Array.isArray(body.requirements) ? body.requirements : [])
      .map((r) => ({ question: text(r?.question, 500), answer: text(r?.answer) }))
      .filter((r) => r.question),
    offers: (Array.isArray(body.offers) ? body.offers : [])
      .filter((o) => ['you', 'client'].includes(o?.party) && num(o.amount) >= 0)
      .map((o) => ({ party: o.party, amount: round2(num(o.amount)), note: text(o.note, 500), at: o.at ? new Date(o.at) : new Date() })),
    summary: {
      minutes: round2(num(summary.minutes)),
      monthly_cost: round2(num(summary.monthly_cost)),
      monthly_price: round2(num(summary.monthly_price)),
      monthly_profit: round2(num(summary.monthly_profit)),
      margin_percent: summary.margin_percent == null ? null : round2(num(summary.margin_percent)),
      setup_fee: round2(num(summary.setup_fee)),
      setup_cost: round2(num(summary.setup_cost)),
    },
    notes: text(body.notes, 5000),
  };
};

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET /api/price-estimator/quotes?search=&status=
exports.listQuotes = async (req, res) => {
  try {
    const filter = {};
    if (QUOTE_STATUSES.includes(req.query.status)) filter.status = req.query.status;
    const search = text(req.query.search, 100);
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ 'client.name': re }, { 'client.company': re }, { 'client.phone': re }, { 'client.email': re }];
    }

    const quotes = await PriceQuote.find(filter)
      .select('-inputs -requirements')
      .populate('created_by', 'name')
      .sort({ updated_at: -1 })
      .limit(200);

    res.json({ success: true, data: quotes });
  } catch (error) {
    console.error('List price quotes error:', error);
    res.status(500).json({ success: false, message: 'Failed to load the quotes' });
  }
};

// GET /api/price-estimator/quotes/:id
exports.getQuote = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ success: false, message: 'Quote not found' });
    const quote = await PriceQuote.findById(req.params.id).populate('created_by', 'name');
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    res.json({ success: true, data: quote });
  } catch (error) {
    console.error('Get price quote error:', error);
    res.status(500).json({ success: false, message: 'Failed to load the quote' });
  }
};

// POST /api/price-estimator/quotes
exports.createQuote = async (req, res) => {
  try {
    const fields = quoteFields(req.body);
    if (!fields.client.name) return res.status(400).json({ success: false, message: 'Client name is required' });
    const quote = await PriceQuote.create({ ...fields, created_by: req.user._id, updated_by: req.user._id });
    res.status(201).json({ success: true, message: 'Quote saved', data: quote });
  } catch (error) {
    console.error('Create price quote error:', error);
    res.status(500).json({ success: false, message: 'Failed to save the quote' });
  }
};

// PUT /api/price-estimator/quotes/:id
exports.updateQuote = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ success: false, message: 'Quote not found' });
    const fields = quoteFields(req.body);
    if (!fields.client.name) return res.status(400).json({ success: false, message: 'Client name is required' });
    const quote = await PriceQuote.findByIdAndUpdate(
      req.params.id,
      { $set: { ...fields, updated_by: req.user._id } },
      { new: true, runValidators: true }
    );
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    res.json({ success: true, message: 'Quote updated', data: quote });
  } catch (error) {
    console.error('Update price quote error:', error);
    res.status(500).json({ success: false, message: 'Failed to update the quote' });
  }
};

// DELETE /api/price-estimator/quotes/:id
exports.deleteQuote = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ success: false, message: 'Quote not found' });
    const quote = await PriceQuote.findByIdAndDelete(req.params.id);
    if (!quote) return res.status(404).json({ success: false, message: 'Quote not found' });
    res.json({ success: true, message: 'Quote deleted' });
  } catch (error) {
    console.error('Delete price quote error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete the quote' });
  }
};
