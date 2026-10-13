'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

// Phone audio made by a voice provider (8 kHz mu-law, base64), kept so the same
// words in the same voice are only paid for once. Recent clips stay in memory.
// Lines that come back (greetings, flow script lines, goodbyes, re-asks, short
// replies like "Okay.") are also saved on disk, which survives restarts and
// deploys (uploads/ is shared between releases). One-off AI replies are not
// saved, so the disk only holds lines that repeat.
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
const SEEN_LIMIT = 20000;
const DISK_DIR = path.join(__dirname, '..', '..', 'uploads', 'tts_cache');
// A saved line nobody has used for 30 days is deleted.
const DISK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_EVERY_MS = 24 * 60 * 60 * 1000;

const memory = new Map();
let memoryBytes = 0;
// Lines made or played before but not yet on disk: a second use saves them.
const seen = new Map();
const onDisk = new Set();

const remember = (key, audio) => {
  if (memory.has(key)) memoryBytes -= memory.get(key).length;
  memory.delete(key);
  memory.set(key, audio);
  memoryBytes += audio.length;
  while (memoryBytes > MEMORY_LIMIT_BYTES && memory.size > 1) {
    const [oldKey, oldAudio] = memory.entries().next().value;
    memory.delete(oldKey);
    memoryBytes -= oldAudio.length;
  }
};

const fileFor = (key) => path.join(DISK_DIR, `${key}.ulaw`);

const saveToDisk = (key, audio) => {
  if (onDisk.has(key)) return;
  onDisk.add(key);
  seen.delete(key);
  const file = fileFor(key);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdir(DISK_DIR, { recursive: true })
    .then(() => fs.writeFile(tmp, Buffer.from(audio, 'base64')))
    .then(() => fs.rename(tmp, file))
    .catch((err) => {
      onDisk.delete(key);
      console.warn('[TTS cache] Could not save to disk:', err.message);
    });
};

// Second use of a line: save it, since it is likely to come again.
const noteUse = (key, audio) => {
  if (onDisk.has(key)) return;
  if (seen.has(key)) return saveToDisk(key, audio);
  seen.set(key, true);
  if (seen.size > SEEN_LIMIT) seen.delete(seen.keys().next().value);
};

// variant: whatever else changes the sound (voice model, language).
const keyFor = (provider, voiceId, text, variant = '') =>
  crypto.createHash('sha1').update(JSON.stringify([provider, voiceId || 'default', String(text).trim(), variant || ''])).digest('hex');

const get = async (key) => {
  if (memory.has(key)) {
    const audio = memory.get(key);
    remember(key, audio);
    noteUse(key, audio);
    return audio;
  }
  try {
    const file = fileFor(key);
    const audio = (await fs.readFile(file)).toString('base64');
    remember(key, audio);
    onDisk.add(key);
    // Still in use, so the cleanup keeps it.
    const now = new Date();
    fs.utimes(file, now, now).catch(() => {});
    return audio;
  } catch {
    return null;
  }
};

// persist: save to disk at once (greetings and audio made ahead of a call).
// Anything else is saved on its second use.
const set = (key, audio, { persist = false } = {}) => {
  remember(key, audio);
  if (persist) saveToDisk(key, audio);
  else noteUse(key, audio);
};

const cleanup = async () => {
  let files;
  try {
    files = await fs.readdir(DISK_DIR);
  } catch {
    return;
  }
  const cutoff = Date.now() - DISK_TTL_MS;
  let removed = 0;
  for (const name of files) {
    const file = path.join(DISK_DIR, name);
    try {
      const { mtimeMs } = await fs.stat(file);
      if (mtimeMs < cutoff) {
        await fs.unlink(file);
        onDisk.delete(name.replace(/\.ulaw$/, ''));
        removed++;
      }
    } catch {
      // Removed meanwhile by another process.
    }
  }
  if (removed) console.log(`[TTS cache] Removed ${removed} lines unused for 30 days`);
};

setTimeout(cleanup, 60 * 1000).unref();
setInterval(cleanup, CLEANUP_EVERY_MS).unref();

module.exports = { keyFor, get, set };
