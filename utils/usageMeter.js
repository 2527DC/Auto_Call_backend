'use strict';

const { AsyncLocalStorage } = require('async_hooks');

// Collects what one call uses from paid providers (speech-to-text, voice, AI
// model) so its real cost can be reported. Code running for a call records into
// that call's usage without having it passed through every function.
const storage = new AsyncLocalStorage();

const newUsage = () => ({
  telephony_provider: null,
  stt_provider: null,
  stt_seconds: 0,
  tts_provider: null,
  tts_characters: 0,
  llm_input_tokens: 0,
  llm_output_tokens: 0,
});

const runWithUsage = (usage, fn) => storage.run(usage, fn);

// Adds numbers and sets provider names on the usage of the call being handled.
const recordUsage = (fields) => {
  const usage = storage.getStore();
  if (!usage) return;
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'number') usage[key] = (usage[key] || 0) + value;
    else if (value) usage[key] = value;
  }
};

// OpenAI, Anthropic and Gemini each report token counts in their own shape.
const recordLlmResponse = (data) => {
  const u = data?.usage;
  const g = data?.usageMetadata;
  recordUsage({
    llm_input_tokens: u?.prompt_tokens ?? u?.input_tokens ?? g?.promptTokenCount ?? 0,
    llm_output_tokens: u?.completion_tokens ?? u?.output_tokens ?? g?.candidatesTokenCount ?? 0,
  });
};

module.exports = { newUsage, runWithUsage, recordUsage, recordLlmResponse };
