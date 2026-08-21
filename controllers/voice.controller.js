const Voice = require('../models/voice.model');
const { db } = require('../models');
const UserSettings = db.UserSettings;
const elevenlabsService = require('../services/elevenlabsService');
const deepgramService = require('../services/deepgramService');
const sarvamService = require('../services/sarvamService');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

exports.getAllVoices = async (req, res) => {
  try {
    const voices = await Voice.find({ status: 'active' }).sort({ name: 1 });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const formattedVoices = voices.map(voice => {
      const v = voice.toObject ? voice.toObject() : { ...voice };
      if (!v.preview_url || v.preview_url.startsWith('/api/') || v.provider === 'sarvam_ai') {
        v.preview_url = `${baseUrl}/api/voices/${v.voice_id}/preview`;
      }
      return v;
    });
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
    const userSettings = req.user ? await UserSettings.findOne({ user: req.user.id }) : null;
    let syncedCount = 0;
    const errors = [];

    try {
      const elevenLabsVoices = await elevenlabsService.fetchVoices(userSettings?.elevenlabs_api_key);
      if (elevenLabsVoices && Array.isArray(elevenLabsVoices)) {
        for (const ev of elevenLabsVoices) {
          const voiceData = {
            name: ev.name,
            voice_id: ev.voice_id,
            category: (ev.category && ev.category.toLowerCase() === 'premade') ? 'Predefined' : (ev.category || 'Predefined'),
            preview_url: ev.preview_url || null,
            labels: {
              gender: ev.labels?.gender || null,
              age: ev.labels?.age || null,
              accent: ev.labels?.accent || null,
              description: ev.labels?.description || null
            },
            provider: 'elevenlabs',
            status: 'active'
          };

          await Voice.findOneAndUpdate(
            { voice_id: voiceData.voice_id },
            voiceData,
            { upsert: true, new: true }
          );
          syncedCount++;
        }
      }
    } catch (elevenError) {
      console.error('ElevenLabs Sync Error:', elevenError.response?.status || elevenError.message);
      const msg = elevenError.response?.status === 401
        ? 'ElevenLabs API Key is invalid or unauthorized (401)'
        : (elevenError.message || 'Failed to sync ElevenLabs voices');
      errors.push(`ElevenLabs: ${msg}`);
    }

    try {
      const deepgramVoices = await deepgramService.fetchVoices(userSettings?.deepgram_api_key);
      if (deepgramVoices && Array.isArray(deepgramVoices)) {
        for (const dv of deepgramVoices) {
          const voiceData = {
            name: dv.name,
            voice_id: dv.voice_id,
            category: (dv.category && dv.category.toLowerCase() === 'premade') ? 'Predefined' : (dv.category || 'Predefined'),
            preview_url: dv.preview_url || null,
            labels: {
              gender: dv.labels?.gender || null,
              age: dv.labels?.age || null,
              accent: dv.labels?.accent || null,
              description: dv.labels?.description || null
            },
            provider: 'deepgram',
            status: 'active'
          };

          await Voice.findOneAndUpdate({ voice_id: voiceData.voice_id }, voiceData, { upsert: true, new: true });
          syncedCount++;
        }
      }
    } catch (deepgramError) {
      console.error('Deepgram Sync Error:', deepgramError.response?.status || deepgramError.message);
      const msg = deepgramError.response?.status === 401
        ? 'Deepgram API Key is invalid or unauthorized (401)'
        : (deepgramError.message || 'Failed to sync Deepgram voices');
      errors.push(`Deepgram: ${msg}`);
    }

    try {
      const sarvamVoices = await sarvamService.fetchVoices(userSettings?.sarvam_ai_api_key);
      if (sarvamVoices && Array.isArray(sarvamVoices)) {
        for (const sv of sarvamVoices) {
          const voiceData = {
            name: sv.name,
            voice_id: sv.voice_id,
            category: (sv.category && sv.category.toLowerCase() === 'premade') ? 'Predefined' : (sv.category || 'Predefined'),
            preview_url: sv.preview_url || null,
            labels: {
              gender: sv.labels?.gender || null,
              age: sv.labels?.age || null,
              accent: sv.labels?.accent || null,
              description: sv.labels?.description || null
            },
            provider: 'sarvam_ai',
            status: 'active'
          };

          await Voice.findOneAndUpdate({ voice_id: voiceData.voice_id }, voiceData, { upsert: true, new: true });
          syncedCount++;
        }
      }
    } catch (sarvamError) {
      console.error('Sarvam Sync Error:', sarvamError.response?.status || sarvamError.message);
      const msg = sarvamError.response?.status === 401
        ? 'Sarvam AI API Key is invalid or unauthorized (401)'
        : (sarvamError.message || 'Failed to sync Sarvam AI voices');
      errors.push(`Sarvam AI: ${msg}`);
    }

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

exports.getVoicePreview = async (req, res) => {
  try {
    const { voice_id } = req.params;
    if (!voice_id) {
      return res.status(400).json({ success: false, message: 'voice_id is required' });
    }

    const uploadDir = path.join(__dirname, '../uploads/previews');
    await fs.ensureDir(uploadDir);

    const filePathWav = path.join(uploadDir, `${voice_id}.wav`);
    const filePathMp3 = path.join(uploadDir, `${voice_id}.mp3`);

    if (await fs.pathExists(filePathWav)) {
      return res.sendFile(filePathWav);
    }
    if (await fs.pathExists(filePathMp3)) {
      return res.sendFile(filePathMp3);
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

    if (voice.preview_url && (voice.preview_url.startsWith('http://') || voice.preview_url.startsWith('https://')) && !voice.preview_url.includes('/api/voices/') && voice.provider !== 'sarvam_ai') {
      return res.redirect(voice.preview_url);
    }

    const userSettings = await UserSettings.findOne().sort({ updated_at: -1 });
    const cleanName = (voice.name || voice_id).replace(/\s*\(.*\)/, '').trim();
    const sampleText = `Hello, I am ${cleanName}, your AI conversational voice assistant.`;

    if (voice.provider === 'sarvam_ai') {
      const apiKey = userSettings?.sarvam_ai_api_key || sarvamService.apiKey;
      const pcmBuffer = await sarvamService.generateSpeech(sampleText, voice_id, {}, apiKey, 16000);
      const wavBuffer = sarvamService.wrapPcmInWav(pcmBuffer, pcmBuffer.sampleRate || 16000);
      await fs.writeFile(filePathWav, wavBuffer);
      return res.sendFile(filePathWav);
    } else if (voice.provider === 'deepgram') {
      const apiKey = userSettings?.deepgram_api_key || deepgramService.apiKey;
      const audioBuffer = await deepgramService.generateSpeech(sampleText, voice_id, {}, apiKey, 16000);
      const wavBuffer = deepgramService.wrapPcmInWav(audioBuffer, 16000);
      await fs.writeFile(filePathWav, wavBuffer);
      return res.sendFile(filePathWav);
    } else {
      const apiKey = userSettings?.elevenlabs_api_key || elevenlabsService.apiKey;
      const audioBuffer = await elevenlabsService.generateSpeech(sampleText, voice_id, {}, apiKey);
      const wavBuffer = elevenlabsService.wrapPcmInWav(audioBuffer);
      await fs.writeFile(filePathWav, wavBuffer);
      return res.sendFile(filePathWav);
    }
  } catch (error) {
    console.error('Get Voice Preview Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to generate voice preview' });
  }
};

