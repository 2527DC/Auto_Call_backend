const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');

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
      const validSpeakers = new Set(['anushka', 'abhilash', 'manisha', 'vidya', 'arya', 'karun', 'hitesh', 'aditya', 'ritu', 'priya', 'neha', 'rahul', 'pooja', 'rohan', 'simran', 'kavya', 'amit', 'dev', 'ishita', 'shreya', 'ratan', 'varun', 'manan', 'sumit', 'roopa', 'kabir', 'aayan', 'shubh', 'ashutosh', 'advait', 'anand', 'tanya', 'tarun', 'sunny', 'mani', 'gokul', 'vijay', 'shruti', 'suhani', 'mohit', 'kavitha', 'rehan', 'soham', 'rupali']);
      const speakerMap = {
        'yash': 'rehan',
        'meera': 'manisha',
        'pavithra': 'kavitha',
        'divya': 'vidya',
        'amartya': 'ashutosh'
      };
      let speaker = voiceId || 'shubh';
      if (speakerMap[speaker.toLowerCase()]) {
        speaker = speakerMap[speaker.toLowerCase()];
      } else if (!validSpeakers.has(speaker.toLowerCase())) {
        speaker = 'shubh';
      } else {
        speaker = speaker.toLowerCase();
      }
      const targetLang = voiceSettings.target_language_code || voiceSettings.language || 'hi-IN';

      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/text-to-speech`,
        data: {
          text: text.slice(0, 2500),
          target_language_code: targetLang,
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
    return [
      { name: 'Shubh (Sarvam AI)', voice_id: 'shubh', category: 'Predefined', provider: 'sarvam_ai', preview_url: null, labels: { gender: 'Male', age: 'Young', accent: 'Indian (Hindi/English)', description: 'Clear and natural conversational voice' } },
      { name: 'Roopa (Sarvam AI)', voice_id: 'roopa', category: 'Predefined', provider: 'sarvam_ai', preview_url: null, labels: { gender: 'Female', age: 'Young', accent: 'Indian (Hindi/English)', description: 'Warm and engaging voice' } },
      { name: 'Meera (Sarvam AI)', voice_id: 'meera', category: 'Predefined', provider: 'sarvam_ai', preview_url: null, labels: { gender: 'Female', age: 'Middle-aged', accent: 'Indian (Hindi/English)', description: 'Professional and calm voice' } },
      { name: 'Pavithra (Sarvam AI)', voice_id: 'pavithra', category: 'Predefined', provider: 'sarvam_ai', preview_url: null, labels: { gender: 'Female', age: 'Young', accent: 'Indian (South/English)', description: 'Melodic and expressive voice' } },
      { name: 'Divya (Sarvam AI)', voice_id: 'divya', category: 'Predefined', provider: 'sarvam_ai', preview_url: null, labels: { gender: 'Female', age: 'Young', accent: 'Indian (Hindi/English)', description: 'Upbeat and energetic voice' } },
      { name: 'Amartya (Sarvam AI)', voice_id: 'amartya', category: 'Predefined', provider: 'sarvam_ai', preview_url: null, labels: { gender: 'Male', age: 'Middle-aged', accent: 'Indian (Hindi/English)', description: 'Authoritative and articulate voice' } },
      { name: 'Yash (Sarvam AI)', voice_id: 'yash', category: 'Predefined', provider: 'sarvam_ai', preview_url: null, labels: { gender: 'Male', age: 'Young', accent: 'Indian (Hindi/English)', description: 'Friendly and dynamic voice' } },
      { name: 'Rahul (Sarvam AI)', voice_id: 'rahul', category: 'Predefined', provider: 'sarvam_ai', preview_url: null, labels: { gender: 'Male', age: 'Young', accent: 'Indian (Hindi/English)', description: 'Smooth and modern conversational voice' } },
      { name: 'Anushka (Sarvam AI)', voice_id: 'anushka', category: 'Predefined', provider: 'sarvam_ai', preview_url: null, labels: { gender: 'Female', age: 'Young', accent: 'Indian (Hindi/English)', description: 'Sweet and articulate voice' } },
      { name: 'Priya (Sarvam AI)', voice_id: 'priya', category: 'Predefined', provider: 'sarvam_ai', preview_url: null, labels: { gender: 'Female', age: 'Young', accent: 'Indian (Hindi/English)', description: 'Polite and clear guiding voice' } }
    ];
  }
}

const instance = new SarvamService();
module.exports = instance;
