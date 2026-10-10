'use strict';

// Minutes the phone provider bills: Plivo charges per 30 seconds, others per minute.
const billedMinutes = (seconds, provider) => {
  if (!seconds || seconds <= 0) return 0;
  return provider === 'plivo' ? Math.ceil(seconds / 30) / 2 : Math.ceil(seconds / 60);
};

// What one call cost in rupees, from its recorded usage and the rates in settings.
const callCost = (call, rates) => {
  const u = call.usage || {};
  return {
    telephony: billedMinutes(call.duration, u.telephony_provider) * (rates.cost_telephony_per_minute || 0),
    stt: ((u.stt_seconds || 0) / 60) * (rates[`cost_stt_per_minute_${u.stt_provider}`] || 0),
    tts: ((u.tts_characters || 0) / 1000) * (rates[`cost_tts_per_1k_chars_${u.tts_provider}`] || 0),
    llm: ((u.llm_input_tokens || 0) / 1e6) * (rates.cost_llm_input_per_1m_tokens || 0)
      + ((u.llm_output_tokens || 0) / 1e6) * (rates.cost_llm_output_per_1m_tokens || 0),
  };
};

// A typical minute of an AI call (docs/understanding/calling_cost_and_providers.md):
// the caller speaks about 30 seconds, the agent about 450 characters, and the AI
// model reads about 10,000 tokens and writes about 240.
const TYPICAL_MINUTE = { stt_seconds: 30, tts_characters: 450, llm_input_tokens: 10000, llm_output_tokens: 240 };

// What a typical one-minute Plivo call costs with this voice. Speech-to-text uses the same provider.
const typicalMinuteCost = (rates, voiceProvider) => {
  const usage = { telephony_provider: 'plivo', stt_provider: voiceProvider, tts_provider: voiceProvider, ...TYPICAL_MINUTE };
  return Object.values(callCost({ duration: 60, usage }, rates)).reduce((a, b) => a + b, 0);
};

module.exports = { billedMinutes, callCost, typicalMinuteCost };
