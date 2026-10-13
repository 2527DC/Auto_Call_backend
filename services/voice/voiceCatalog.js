'use strict';

const Voice = require('../../models/voice.model');
const elevenLabsService = require('../elevenlabsService');
const deepgramService = require('../deepgramService');
const sarvamService = require('../sarvamService');

// What ElevenLabs charges per model and whether it suits live calls, from
// elevenlabs.io/docs/overview/models and elevenlabs.io/pricing/api (13 Oct 2026).
// Models missing here are still listed, without a price.
const ELEVENLABS_MODEL_INFO = {
  eleven_v4_turbo: { price_per_1k_chars_usd: 0.04, realtime: true },
  eleven_v4: { price_per_1k_chars_usd: 0.08, realtime: false },
  eleven_v3_conversational: { price_per_1k_chars_usd: 0.04, realtime: true },
  eleven_v3: { price_per_1k_chars_usd: 0.08, realtime: false },
  eleven_flash_v2_5: { price_per_1k_chars_usd: 0.04, realtime: true },
  eleven_flash_v2: { price_per_1k_chars_usd: 0.04, realtime: true },
  eleven_multilingual_v2: { price_per_1k_chars_usd: 0.08, realtime: false },
  eleven_turbo_v2_5: { price_per_1k_chars_usd: 0.04, realtime: true, deprecated: true },
  eleven_turbo_v2: { price_per_1k_chars_usd: 0.04, realtime: true, deprecated: true },
};

const MODEL_LIST_TTL_MS = 10 * 60 * 1000;
let modelCache = { at: 0, models: null };

// ElevenLabs voice models for the admin (all) or for an agent form (allowed
// only). Falls back to the table above when ElevenLabs can't be reached.
const elevenLabsModels = async ({ all = false } = {}) => {
  if (!modelCache.models || Date.now() - modelCache.at > MODEL_LIST_TTL_MS) {
    try {
      const live = await elevenLabsService.fetchModels();
      modelCache = { at: Date.now(), models: live };
    } catch (err) {
      console.warn('[Voices] Could not list ElevenLabs models:', err.response?.status || err.message);
    }
  }
  const source = modelCache.models
    || Object.keys(ELEVENLABS_MODEL_INFO).map(model_id => ({ model_id, name: model_id, languages: [] }));

  const models = source.map(m => ({
    model_id: m.model_id,
    name: m.name || m.model_id,
    description: m.description || null,
    languages: (m.languages || []).map(l => ({ id: l.language_id, name: l.name })),
    deprecated: false,
    realtime: null,
    price_per_1k_chars_usd: null,
    ...ELEVENLABS_MODEL_INFO[m.model_id],
    allowed: elevenLabsService.allowedModels.includes(m.model_id),
    is_default: elevenLabsService.defaultModel === m.model_id,
  }));
  return all ? models : models.filter(m => m.allowed);
};

const FIELDS = (v, provider) => ({
  name: v.name,
  category: (v.category && v.category.toLowerCase() === 'premade') ? 'Predefined' : (v.category || 'Predefined'),
  preview_url: v.preview_url || null,
  labels: {
    gender: v.labels?.gender || null,
    age: v.labels?.age || null,
    accent: v.labels?.accent || null,
    description: v.labels?.description || null
  },
  provider
});

// Copies every provider's voices into the shared list. Voices seen for the
// first time stay hidden from clients until the admin switches them on, so
// clients only pick voices that were priced for them; a re-sync never changes
// that choice. keys: provider keys to use; missing ones fall back to Voxeno's.
const syncVoices = async (keys = {}) => {
  let synced = 0;
  const errors = [];
  const providers = [
    ['elevenlabs', 'ElevenLabs', () => elevenLabsService.fetchVoices(keys.elevenlabs)],
    ['deepgram', 'Deepgram', () => deepgramService.fetchVoices(keys.deepgram)],
    ['sarvam_ai', 'Sarvam AI', () => sarvamService.fetchVoices(keys.sarvam)],
  ];

  for (const [provider, label, fetch] of providers) {
    try {
      const voices = await fetch();
      for (const v of voices || []) {
        await Voice.updateOne(
          { voice_id: v.voice_id },
          { $set: FIELDS(v, provider), $setOnInsert: { status: 'inactive' } },
          { upsert: true }
        );
        synced++;
      }
    } catch (err) {
      console.error(`${label} Sync Error:`, err.response?.status || err.message);
      errors.push(`${label}: ${err.response?.status === 401 ? `${label} API Key is invalid or unauthorized (401)` : (err.message || `Failed to sync ${label} voices`)}`);
    }
  }

  return { synced, errors };
};

module.exports = { elevenLabsModels, syncVoices, ELEVENLABS_MODEL_INFO };
