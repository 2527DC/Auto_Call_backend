'use strict';

const crypto = require('crypto');
const IORedis = require('ioredis');

// Phone audio made by a voice provider (8 kHz mu-law, base64), kept so the same
// words in the same voice are only made once. Recent clips stay in memory;
// greetings are also kept in Redis so they survive restarts and deploys.
const MEMORY_LIMIT = 300;
const REDIS_PREFIX = 'voxeno:tts:v2:';
const REDIS_TTL_SECONDS = 30 * 24 * 60 * 60;
// A slow Redis must never hold up a live call; making the audio again is the fallback.
const REDIS_TIMEOUT_MS = 150;

const memory = new Map();
let redis = null;

const getRedis = () => {
  if (redis || !process.env.REDIS_URL) return redis;
  redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  // ioredis keeps reconnecting; warn once per outage, not on every attempt.
  let warned = false;
  redis.on('error', (err) => {
    if (!warned) console.warn('[TTS cache] Redis unavailable, using memory only:', err.message);
    warned = true;
  });
  redis.on('ready', () => { warned = false; });
  return redis;
};

const remember = (key, audio) => {
  memory.delete(key);
  memory.set(key, audio);
  if (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value);
};

// variant: whatever else changes the sound (voice model, language).
const keyFor = (provider, voiceId, text, variant = '') =>
  crypto.createHash('sha1').update(JSON.stringify([provider, voiceId || 'default', String(text).trim(), variant || ''])).digest('hex');

const get = async (key) => {
  if (memory.has(key)) {
    const audio = memory.get(key);
    remember(key, audio);
    return audio;
  }
  const client = getRedis();
  if (!client) return null;
  let timer;
  try {
    const audio = await Promise.race([
      client.get(REDIS_PREFIX + key),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), REDIS_TIMEOUT_MS); }),
    ]);
    if (audio) remember(key, audio);
    return audio || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// persist: also keep it in Redis (greetings); one-off replies stay in memory only.
const set = (key, audio, { persist = false } = {}) => {
  remember(key, audio);
  const client = persist ? getRedis() : null;
  if (client) {
    client.set(REDIS_PREFIX + key, audio, 'EX', REDIS_TTL_SECONDS)
      .catch((err) => console.warn('[TTS cache] Could not save to Redis:', err.message));
  }
};

// Connect at startup so the first call after a deploy can already read greetings.
getRedis();

module.exports = { keyFor, get, set };
