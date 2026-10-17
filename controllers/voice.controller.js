const Voice = require('../models/voice.model');
const { db } = require('../models');
const UserSettings = db.UserSettings;
const Setting = db.Setting;
const elevenlabsService = require('../services/elevenlabsService');
const deepgramService = require('../services/deepgramService');
const sarvamService = require('../services/sarvamService');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const voiceCatalog = require('../services/voice/voiceCatalog');

const isAdmin = (user) => ['super_admin', 'admin'].includes(user?.roleId?.name);

exports.getAllVoices = async (req, res) => {
  try {
    const filter = req.query.scope === 'all' && isAdmin(req.user) ? {} : { status: 'active' };
    const voices = await Voice.find(filter).sort({ name: 1 });
    let formattedVoices = voices.map(voice => {
      const v = voice.toObject ? voice.toObject() : { ...voice };
      if (!v.preview_url || v.preview_url.startsWith('/api/') || v.preview_url.includes('127.0.0.1') || v.preview_url.includes('localhost') || v.provider === 'sarvam_ai') {
        v.preview_url = `/api/voices/${v.voice_id}/preview`;
      }
      return v;
    });

    const hasSarvam = formattedVoices.some(v => v.provider === 'sarvam_ai');
    if (!hasSarvam) {
      try {
        const sarvamVoices = await sarvamService.fetchVoices();
        const formattedSarvam = (sarvamVoices || []).map(v => ({
          ...v,
          preview_url: `/api/voices/${v.voice_id}/preview`,
          status: 'active'
        }));
        formattedVoices = [...formattedVoices, ...formattedSarvam];
      } catch (sErr) {
        console.warn('Could not populate Sarvam fallback voices:', sErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      data: formattedVoices
    });
  } catch (error) {
    console.error('Get Voices Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch voices'
    });
  }
};

exports.synthesizeSpeech = async (req, res) => {
  try {
    const { text, voice_id, stability, similarity_boost, provider } = req.body;

    if (!text || !voice_id) {
      return res.status(400).json({
        success: false,
        message: 'Text and voice_id are required'
      });
    }

    if (text.length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Text is too long (max 5000 characters)'
      });
    }

    const voice = await Voice.findOne({ voice_id });
    const activeProvider = provider || voice?.provider || 'elevenlabs';
    const userSettings = await UserSettings.findOne({ user: req.user.id });

    const uploadDir = path.join(__dirname, '../uploads/tts');
    await fs.ensureDir(uploadDir);

    if (activeProvider === 'deepgram') {
      const apiKey = userSettings?.deepgram_api_key;
      const audioBuffer = await deepgramService.generateSpeech(text, voice_id, {}, apiKey);
      const wavBuffer = deepgramService.wrapPcmInWav(audioBuffer);

      const fileName = `tts-${crypto.randomUUID()}.wav`;
      const filePath = path.join(uploadDir, fileName);
      await fs.writeFile(filePath, wavBuffer);

      const fileUrl = `${req.protocol}://${req.get('host')}/uploads/tts/${fileName}`;
      return res.status(200).json({
        success: true,
        data: {
          url: fileUrl,
          fileName: fileName
        }
      });
    }

    if (activeProvider === 'sarvam_ai') {
      const apiKey = userSettings?.sarvam_ai_api_key;
      const pcmBuffer = await sarvamService.generateSpeech(text, voice_id, {}, apiKey);
      const wavBuffer = sarvamService.wrapPcmInWav(pcmBuffer, pcmBuffer.sampleRate || 16000);

      const fileName = `tts-${crypto.randomUUID()}.wav`;
      const filePath = path.join(uploadDir, fileName);
      await fs.writeFile(filePath, wavBuffer);

      const fileUrl = `${req.protocol}://${req.get('host')}/uploads/tts/${fileName}`;
      return res.status(200).json({
        success: true,
        data: {
          url: fileUrl,
          fileName: fileName
        }
      });
    }

    const apiKey = userSettings?.elevenlabs_api_key;
    const audioBuffer = await elevenlabsService.generateSpeech(text, voice_id, {
      stability,
      similarity_boost
    }, apiKey);

    const fileName = `tts-${crypto.randomUUID()}.mp3`;
    const filePath = path.join(uploadDir, fileName);
    await fs.writeFile(filePath, audioBuffer);

    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/tts/${fileName}`;

    return res.status(200).json({
      success: true,
      data: {
        url: fileUrl,
        fileName: fileName
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Speech synthesis failed' });
  }
};

exports.syncVoices = async (req, res) => {
  try {
    // The admin's own keys if they set any, otherwise Voxeno's platform keys.
    const userSettings = req.user ? await UserSettings.findOne({ user: req.user.id }) : null;
    const { synced: syncedCount, errors } = await voiceCatalog.syncVoices({
      elevenlabs: userSettings?.elevenlabs_api_key,
      deepgram: userSettings?.deepgram_api_key,
      sarvam: userSettings?.sarvam_ai_api_key
    });

    if (syncedCount === 0 && errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors.join(' | ')
      });
    }

    const message = errors.length > 0
      ? `Successfully synced ${syncedCount} voices (${errors.join('; ')})`
      : `Successfully synced ${syncedCount} voices`;

    return res.status(200).json({
      success: true,
      message,
      data: { synced_count: syncedCount, errors }
    });
  } catch (error) {
    console.error('Sync Voices Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to sync voices' });
  }
};

// Admin: show or hide a voice for clients.
exports.updateVoiceStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be active or inactive' });
    }
    const voice = await Voice.findOneAndUpdate({ voice_id: req.params.voice_id }, { status }, { new: true });
    if (!voice) return res.status(404).json({ success: false, message: 'Voice not found' });
    return res.status(200).json({ success: true, data: voice });
  } catch (error) {
    console.error('Update Voice Status Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update voice' });
  }
};

// ElevenLabs voice models: all of them for the admin (?scope=all), otherwise
// only the ones the admin allows clients to pick.
exports.getVoiceModels = async (req, res) => {
  try {
    const models = await voiceCatalog.elevenLabsModels({ all: req.query.scope === 'all' && isAdmin(req.user) });
    return res.status(200).json({ success: true, data: { elevenlabs: models } });
  } catch (error) {
    console.error('Get Voice Models Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch voice models' });
  }
};

exports.getVoicePreview = async (req, res) => {
  try {
    const { voice_id } = req.params;
    const requestedLang = (req.query.lang || req.query.language || 'en').toLowerCase().trim();
    const lang = ['en', 'hi', 'kn'].includes(requestedLang) ? requestedLang : 'en';

    if (!voice_id) {
      return res.status(400).json({ success: false, message: 'voice_id is required' });
    }

    const uploadDir = path.join(__dirname, '../uploads/previews');
    await fs.ensureDir(uploadDir);

    const filePathWav = path.join(uploadDir, `${voice_id}_${lang}.wav`);
    const filePathMp3 = path.join(uploadDir, `${voice_id}_${lang}.mp3`);
    const legacyWav = path.join(uploadDir, `${voice_id}.wav`);
    const legacyMp3 = path.join(uploadDir, `${voice_id}.mp3`);

    if (await fs.pathExists(filePathWav)) {
      return res.sendFile(filePathWav);
    }
    if (await fs.pathExists(filePathMp3)) {
      return res.sendFile(filePathMp3);
    }
    if (lang === 'en' && await fs.pathExists(legacyWav)) {
      return res.sendFile(legacyWav);
    }
    if (lang === 'en' && await fs.pathExists(legacyMp3)) {
      return res.sendFile(legacyMp3);
    }

    let voice = await Voice.findOne({ voice_id });
    if (!voice) {
      const allSarvam = await sarvamService.fetchVoices();
      const allDeepgram = await deepgramService.fetchVoices();
      const allEleven = await elevenlabsService.fetchVoices().catch(() => []);
      const match = [...allSarvam, ...allDeepgram, ...allEleven].find(v => v.voice_id === voice_id);
      if (match) {
        voice = match;
      }
    }

    if (!voice) {
      return res.status(404).json({ success: false, message: 'Voice not found' });
    }

    // If English requested and voice has an external static preview URL, redirect to it
    if (lang === 'en' && voice.preview_url && (voice.preview_url.startsWith('http://') || voice.preview_url.startsWith('https://')) && !voice.preview_url.includes('/api/voices/') && voice.provider !== 'sarvam_ai') {
      return res.redirect(voice.preview_url);
    }

    // Previews are made with platform or admin keys, then cached on disk.
    const cleanName = (voice.name || voice_id)
      .replace(/\s*\(.*\)/, '')
      .replace(/[-_]/g, ' ')
      .trim();

    const SAMPLE_TEXTS = {
      en: `Hello, I am ${cleanName}, your AI conversational voice assistant. How can I help you today?`,
      hi: `नमस्ते, मैं ${cleanName} हूँ, आपका AI वॉयಸ असिस्टेंट। मैं आज आपकी क्या मदद कर सकता हूँ?`,
      kn: `ನಮಸ್ಕಾರ, ನಾನು ${cleanName}, ನಿಮ್ಮ AI ಧ್ವನಿ ಸಹಾಯಕ. ನಾನು ಇಂದು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?`,
    };

    const sampleText = SAMPLE_TEXTS[lang] || SAMPLE_TEXTS.en;

    if (voice.provider === 'sarvam_ai') {
      let activeKey = sarvamService.apiKey;
      if (!activeKey) {
        const platformSetting = await Setting.findOne().select('sarvam_ai_api_key').lean();
        activeKey = platformSetting?.sarvam_ai_api_key;
      }
      if (!activeKey) {
        const anyUser = await UserSettings.findOne({ sarvam_ai_api_key: { $ne: null } }).select('sarvam_ai_api_key').lean();
        activeKey = anyUser?.sarvam_ai_api_key;
      }
      if (!activeKey) {
        return res.status(400).json({ success: false, message: 'Sarvam AI API key is not configured. Please add it under System Settings -> AI Configuration.' });
      }

      const sarvamLangMap = {
        kn: 'kn-IN',
        hi: 'hi-IN',
        en: 'en-IN'
      };
      const targetLang = sarvamLangMap[lang] || 'en-IN';
      const pcmBuffer = await sarvamService.generateSpeech(sampleText, voice_id, { target_language_code: targetLang }, activeKey, 16000);
      const wavBuffer = sarvamService.wrapPcmInWav(pcmBuffer, pcmBuffer.sampleRate || 16000);
      await fs.writeFile(filePathWav, wavBuffer);
      return res.sendFile(filePathWav);
    } else if (voice.provider === 'deepgram') {
      let activeKey = deepgramService.apiKey;
      if (!activeKey) {
        const platformSetting = await Setting.findOne().select('deepgram_api_key').lean();
        activeKey = platformSetting?.deepgram_api_key;
      }
      if (!activeKey) {
        const anyUser = await UserSettings.findOne({ deepgram_api_key: { $ne: null } }).select('deepgram_api_key').lean();
        activeKey = anyUser?.deepgram_api_key;
      }
      const audioBuffer = await deepgramService.generateSpeech(SAMPLE_TEXTS.en, voice_id, {}, activeKey, 16000);
      const wavBuffer = deepgramService.wrapPcmInWav(audioBuffer, 16000);
      await fs.writeFile(filePathWav, wavBuffer);
      return res.sendFile(filePathWav);
    } else {
      let activeKey = elevenlabsService.apiKey;
      if (!activeKey) {
        const platformSetting = await Setting.findOne().select('elevenlabs_api_key').lean();
        activeKey = platformSetting?.elevenlabs_api_key;
      }
      if (!activeKey) {
        const anyUser = await UserSettings.findOne({ elevenlabs_api_key: { $ne: null } }).select('elevenlabs_api_key').lean();
        activeKey = anyUser?.elevenlabs_api_key;
      }
      const audioBuffer = await elevenlabsService.generateSpeech(sampleText, voice_id, { language: lang, model: 'eleven_multilingual_v2' }, activeKey);
      const wavBuffer = elevenlabsService.wrapPcmInWav(audioBuffer, 16000);
      await fs.writeFile(filePathWav, wavBuffer);
      return res.sendFile(filePathWav);
    }
  } catch (error) {
    console.error('Get Voice Preview Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to generate voice preview' });
  }
};

