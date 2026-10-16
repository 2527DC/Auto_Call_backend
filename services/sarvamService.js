const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');

// Bulbul v3 speakers, from docs.sarvam.ai (text-to-speech API, 13 Oct 2026).
const BULBUL_V3_SPEAKERS = ['shubh', 'aditya', 'ritu', 'priya', 'neha', 'rahul', 'pooja', 'rohan', 'simran', 'kavya', 'amit', 'dev', 'ishita', 'shreya', 'ratan', 'varun', 'manan', 'sumit', 'roopa', 'kabir', 'aayan', 'ashutosh', 'advait', 'anand', 'tanya', 'tarun', 'sunny', 'mani', 'gokul', 'vijay', 'shruti', 'suhani', 'mohit', 'kavitha', 'rehan', 'soham', 'rupali'];

// Older speaker names (Bulbul v1/v2) that agents may still use, each mapped to a
// v3 speaker with a similar name, so those agents keep a voice instead of failing.
const LEGACY_SPEAKERS = {
  meera: 'ritu', divya: 'neha', anushka: 'priya', manisha: 'pooja', vidya: 'kavya', arya: 'shreya',
  pavithra: 'kavitha', abhilash: 'aditya', karun: 'rahul', hitesh: 'rohan', yash: 'rehan', amartya: 'ashutosh'
};

class SarvamService {
  constructor() {
    this.apiKey = process.env.SARVAM_API_KEY || process.env.SERVAM_API_KEY;
    this.baseUrl = 'https://api.sarvam.ai';
  }

  async generateSpeech(text, voiceId = 'shubh', voiceSettings = {}, apiKey = null, sampleRate = 16000) {
    const activeApiKey = apiKey || this.apiKey;
    if (!activeApiKey) {
      throw new Error('Sarvam AI (Servam AI) API Key not configured');
    }

    try {
      const requested = String(voiceId || 'shubh').toLowerCase();
      const speaker = LEGACY_SPEAKERS[requested] || (BULBUL_V3_SPEAKERS.includes(requested) ? requested : 'shubh');
      const targetLang = voiceSettings.target_language_code || voiceSettings.language || (text.match(/[\u0900-\u0D7F]/) ? 'hi-IN' : 'en-IN');

      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/text-to-speech`,
        data: {
          text: text.slice(0, 2500),
          target_language_code: targetLang,
          language_code: targetLang,
          speaker: speaker,
          model: 'bulbul:v3',
          speech_sample_rate: sampleRate || 16000
        },
        headers: {
          'api-subscription-key': activeApiKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.data.audios || response.data.audios.length === 0) {
        throw new Error('No audio returned from Sarvam AI TTS');
      }

      const audioBuffer = Buffer.from(response.data.audios[0], 'base64');
      
      const { pcmBuffer, detectedSampleRate } = this.extractPcmAndRateFromWav(audioBuffer);
      pcmBuffer.sampleRate = detectedSampleRate || sampleRate || 16000;

      await this.saveAudio(this.wrapPcmInWav(pcmBuffer, pcmBuffer.sampleRate), `sarvam_tts_${Date.now()}.wav`);

      return pcmBuffer;
    } catch (error) {
      const errorMessage = error.response ?
        (typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : Buffer.from(error.response.data || '').toString()) :
        error.message;
      console.error('Sarvam AI TTS API Error:', errorMessage);
      throw new Error(`Sarvam AI Synthesis Failed: ${errorMessage}`);
    }
  }

  extractPcmAndRateFromWav(buffer) {
    if (buffer.length > 44 && buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WAVE') {
      const detectedSampleRate = buffer.readUInt32LE(24);
      let dataOffset = 12;
      while (dataOffset + 8 < buffer.length) {
        const chunkId = buffer.slice(dataOffset, dataOffset + 4).toString();
        const chunkSize = buffer.readUInt32LE(dataOffset + 4);
        if (chunkId === 'data') {
          const pcmBuffer = buffer.slice(dataOffset + 8, dataOffset + 8 + chunkSize);
          return { pcmBuffer, detectedSampleRate };
        }
        dataOffset += 8 + chunkSize;
      }
      const pcmBuffer = buffer.slice(44);
      return { pcmBuffer, detectedSampleRate };
    }
    return { pcmBuffer: buffer, detectedSampleRate: null };
  }

  async transcribeAudio(audioBuffer, apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    if (!activeApiKey) {
      console.warn('[Sarvam STT] API Key not configured');
      return '';
    }

    try {
      const formData = new FormData();
      formData.append('file', audioBuffer, { filename: 'speech.wav', contentType: 'audio/wav' });
      formData.append('model', 'saaras:v3');
      formData.append('mode', 'transcribe');

      const response = await axios.post(
        `${this.baseUrl}/speech-to-text`,
        formData,
        {
          headers: {
            'api-subscription-key': activeApiKey,
            ...formData.getHeaders()
          }
        }
      );

      const transcript = response.data.transcript || response.data.text || '';
      console.log('Sarvam STT Response:', transcript);
      return transcript;
    } catch (error) {
      const errorMessage = error.response ?
        (typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)) :
        error.message;
      console.error('Sarvam STT Error:', errorMessage);
      throw new Error(`Sarvam STT Failed: ${errorMessage}`);
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

  // Copies of call audio for debugging, only when SAVE_DEBUG_AUDIO=true: written
  // for every utterance, they slowed replies and filled the disk.
  async saveAudio(buffer, filename) {
    if (process.env.SAVE_DEBUG_AUDIO !== 'true') return;
    try {
      const uploadDir = path.join(process.cwd(), 'uploads', 'debug_audio');
      await fs.ensureDir(uploadDir);
      await fs.writeFile(path.join(uploadDir, filename), buffer);
    } catch (err) {
      console.error('Error saving debug audio:', err);
    }
  }

  // Sarvam has no voice-list API; these are Bulbul v3's speakers. Each speaks
  // all of Bulbul's languages (Indian English, Hindi, Kannada and more).
  async fetchVoices(apiKey = null) {
    const femaleSpeakers = ['ritu', 'priya', 'neha', 'pooja', 'simran', 'kavya', 'ishita', 'shreya', 'roopa', 'tanya', 'shruti', 'suhani', 'kavitha', 'rupali', 'meera', 'divya', 'anushka', 'manisha', 'vidya', 'arya', 'pavithra'];

    return BULBUL_V3_SPEAKERS.map((id) => {
      const isFemale = femaleSpeakers.includes(id.toLowerCase());
      return {
        name: `${id.charAt(0).toUpperCase()}${id.slice(1)} (Sarvam AI)`,
        voice_id: id,
        category: 'Predefined',
        provider: 'sarvam_ai',
        preview_url: null,
        labels: {
          gender: isFemale ? 'Female' : 'Male',
          age: 'Young',
          accent: 'Indian',
          description: 'Bulbul v3 voice'
        }
      };
    });
  }
}

const instance = new SarvamService();
module.exports = instance;
