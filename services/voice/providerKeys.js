'use strict';

const { db } = require('../../models');
const elevenLabsService = require('../elevenlabsService');
const deepgramService = require('../deepgramService');
const sarvamService = require('../sarvamService');

// Voxeno's own voice-provider keys: admin Settings first, then the server .env.
// A call uses the key the admin gave its client (UserSettings) when there is
// one; otherwise each service falls back to its apiKey, set here.
const PLATFORM_FIELDS = 'elevenlabs_api_key deepgram_api_key sarvam_ai_api_key elevenlabs_allowed_models elevenlabs_default_model';

const apply = (setting = {}) => {
  elevenLabsService.apiKey = setting.elevenlabs_api_key || process.env.ELEVENLABS_API_KEY;
  deepgramService.apiKey = setting.deepgram_api_key || process.env.DEEPGRAM_API_KEY;
  sarvamService.apiKey = setting.sarvam_ai_api_key || process.env.SARVAM_API_KEY || process.env.SERVAM_API_KEY;
  elevenLabsService.setModelChoices(setting.elevenlabs_allowed_models, setting.elevenlabs_default_model);
};

// At startup and after the admin saves settings.
const load = async () => {
  const setting = await db.Setting.findOne().select(PLATFORM_FIELDS).lean();
  apply(setting || {});
};

module.exports = { apply, load, PLATFORM_FIELDS };
