const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

class DeepgramService {
  constructor() {
    this.apiKey = process.env.DEEPGRAM_API_KEY;
    this.baseUrl = 'https://api.deepgram.com/v1';
  }

  async generateSpeech(text, voiceId = 'aura-asteria-en', voiceSettings = {}, apiKey = null, sampleRate = 16000) {
    const activeApiKey = apiKey || this.apiKey;
    if (!activeApiKey) {
      throw new Error('Deepgram API Key not configured');
    }

    try {
      const model = voiceId || 'aura-asteria-en';
      const sr = sampleRate || 16000;
      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/speak?model=${model}&encoding=linear16&sample_rate=${sr}`,
        data: { text },
        headers: {
          'Authorization': `Token ${activeApiKey}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      });

      const audioBuffer = Buffer.from(response.data);

      await this.saveAudio(this.wrapPcmInWav(audioBuffer, sr), `deepgram_tts_${Date.now()}.wav`);

      return audioBuffer;
    } catch (error) {
      const errorMessage = error.response ?
        Buffer.from(error.response.data).toString() :
        error.message;
      console.error('Deepgram TTS API Error:', errorMessage);
      throw new Error(`Deepgram Synthesis Failed: ${errorMessage}`);
    }
  }

  async transcribeAudio(audioBuffer, apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    if (!activeApiKey) {
      console.warn('[Deepgram STT] API Key not configured');
      return '';
    }

    try {
      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/listen?model=nova-2&smart_format=true&punctuate=true`,
        data: audioBuffer,
        headers: {
          'Authorization': `Token ${activeApiKey}`,
          'Content-Type': 'audio/wav'
        }
      });

      const transcript = response.data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
      console.log('Deepgram STT Response:', transcript);
      return transcript;
    } catch (error) {
      const errorMessage = error.response ?
        (typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)) :
        error.message;
      console.error('Deepgram STT Error:', errorMessage);
      return '';
    }
  }

  wrapPcmInWav(pcmBuffer, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
    const dataSize = pcmBuffer.length;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
    header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, pcmBuffer]);
  }

  async saveAudio(buffer, filename) {
    try {
      const uploadDir = path.join(process.cwd(), 'uploads', 'debug_audio');
      await fs.ensureDir(uploadDir);
      await fs.writeFile(path.join(uploadDir, filename), buffer);
    } catch (err) {
      console.error('Error saving debug audio:', err);
    }
  }

  async fetchVoices(apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    try {
      const headers = {};
      if (activeApiKey) {
        headers['Authorization'] = `Token ${activeApiKey}`;
      }
      const response = await axios({
        method: 'GET',
        url: `${this.baseUrl}/models`,
        headers
      });

      const models = response.data.tts || response.data.models?.filter(m => m.canonical_name?.includes('aura') || m.architecture?.includes('aura')) || [];
      const enModels = models.filter(m =>
        m.languages?.some(l => typeof l === 'string' && (l.toLowerCase().includes('en') || l.toLowerCase().includes('english'))) ||
        (m.canonical_name && m.canonical_name.toLowerCase().includes('-en'))
      );

      if (enModels && enModels.length > 0) {
        return enModels.map(model => {
          const meta = model.metadata || {};
          const tags = Array.isArray(meta.tags) ? meta.tags : [];

          let gender = null;
          if (tags.some(t => t.toLowerCase() === 'feminine' || t.toLowerCase() === 'female')) gender = 'Female';
          else if (tags.some(t => t.toLowerCase() === 'masculine' || t.toLowerCase() === 'male')) gender = 'Male';

          let age = meta.age || null;
          if (age && typeof age === 'string') {
            if (age.toLowerCase() === 'adult') age = 'Middle-aged';
            else age = age.charAt(0).toUpperCase() + age.slice(1);
          }

          let accent = meta.accent || null;
          if (accent && typeof accent === 'string') {
            accent = accent.charAt(0).toUpperCase() + accent.slice(1);
          }

          let description = null;
          if (Array.isArray(meta.use_cases) && meta.use_cases.length > 0) {
            description = meta.use_cases.join(', ');
          } else if (tags.length > 0) {
            description = tags.filter(t => !['feminine', 'masculine', 'female', 'male'].includes(t.toLowerCase())).join(', ');
          }

          const displayName = meta.display_name || (model.name ? (model.name.charAt(0).toUpperCase() + model.name.slice(1)) : model.canonical_name);
          const name = `${displayName} (Deepgram)`;

          return {
            name,
            voice_id: model.canonical_name || model.name,
            category: 'Predefined',
            provider: 'deepgram',
            preview_url: meta.sample || null,
            labels: {
              gender: gender || 'Female',
              age: age || 'Young',
              accent: accent || 'American',
              description: description || 'Natural conversational voice'
            }
          };
        });
      }
    } catch (err) {
      console.warn('Failed to dynamically fetch Deepgram models from API, falling back to predefined list:', err.message);
    }

    return [
      { name: 'Asteria (Deepgram)', voice_id: 'aura-asteria-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-asteria.wav', labels: { gender: 'Female', age: 'Young', accent: 'American', description: 'Confident and clear' } },
      { name: 'Luna (Deepgram)', voice_id: 'aura-luna-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-luna.wav', labels: { gender: 'Female', age: 'Young', accent: 'American', description: 'Soft and gentle' } },
      { name: 'Athena (Deepgram)', voice_id: 'aura-athena-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-athena.wav', labels: { gender: 'Female', age: 'Young', accent: 'British', description: 'Polite and professional' } },
      { name: 'Hera (Deepgram)', voice_id: 'aura-hera-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-hera.wav', labels: { gender: 'Female', age: 'Middle-aged', accent: 'American', description: 'Authoritative and warm' } },
      { name: 'Orion (Deepgram)', voice_id: 'aura-orion-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-orion.wav', labels: { gender: 'Male', age: 'Middle-aged', accent: 'American', description: 'Deep and professional' } },
      { name: 'Arcas (Deepgram)', voice_id: 'aura-arcas-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-arcas.wav', labels: { gender: 'Male', age: 'Young', accent: 'American', description: 'Casual and approachable' } },
      { name: 'Orpheus (Deepgram)', voice_id: 'aura-orpheus-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-orpheus.wav', labels: { gender: 'Male', age: 'Old', accent: 'American', description: 'Narrative and mature' } },
      { name: 'Zeus (Deepgram)', voice_id: 'aura-zeus-en', category: 'Predefined', provider: 'deepgram', preview_url: 'https://static.deepgram.com/examples/Aura-2-zeus.wav', labels: { gender: 'Male', age: 'Old', accent: 'American', description: 'Deep and authoritative' } }
    ];
  }
}

module.exports = new DeepgramService();
