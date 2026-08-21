const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const FormData = require('form-data');

class ElevenLabsService {
  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY;
    this.baseUrl = 'https://api.elevenlabs.io/v1';
  }

  async generateSpeech(text, voiceId, voiceSettings = {}, apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    if (!activeApiKey) {
      throw new Error('ElevenLabs API Key not configured');
    }
    try {

      const outputFormat = 'pcm_16000';
      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/text-to-speech/${voiceId}?output_format=${outputFormat}`,
        data: {
          text,
          model_id: 'eleven_turbo_v2',
          voice_settings: {
            stability: voiceSettings.stability || 0.5,
            similarity_boost: voiceSettings.similarity_boost || 0.5,
            style: voiceSettings.style || 0.0,
            use_speaker_boost: voiceSettings.use_speaker_boost !== undefined ? voiceSettings.use_speaker_boost : true
          }
        },
        headers: {
          'xi-api-key': activeApiKey,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      });

      const audioBuffer = Buffer.from(response.data);

      await this.saveAudio(this.wrapPcmInWav(audioBuffer), `tts_${Date.now()}.mp3`);

      return audioBuffer;
    } catch (error) {
      const errorMessage = error.response ?
        Buffer.from(error.response.data).toString() :
        error.message;
      console.error('ElevenLabs API Error:', errorMessage);
      throw new Error(`ElevenLabs Synthesis Failed: ${errorMessage}`);
    }
  }

  wrapPcmInWav(pcmBuffer) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(8000, 24);
    header.writeUInt32LE(16000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmBuffer.length, 40);
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
      const response = await axios({
        method: 'GET',
        url: `${this.baseUrl}/voices`,
        headers: { 'xi-api-key': activeApiKey }
      });
      return response.data.voices;
    } catch (error) {
      if (error.response?.status === 401 && apiKey && apiKey !== this.apiKey && this.apiKey) {
        console.warn('Custom ElevenLabs API key returned 401 Unauthorized. Retrying with system ELEVENLABS_API_KEY...');
        try {
          const fallbackResponse = await axios({
            method: 'GET',
            url: `${this.baseUrl}/voices`,
            headers: { 'xi-api-key': this.apiKey }
          });
          return fallbackResponse.data.voices;
        } catch (fallbackError) {
          console.error('ElevenLabs Fallback Fetch Voices Error:', fallbackError.message);
          throw fallbackError;
        }
      }
      console.error('ElevenLabs Fetch Voices Error:', error.message);
      throw error;
    }
  }

  async generateVoicePreview(data, apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    try {
      const description = `${data.gender} voice, ${data.age}, with an ${data.accent} accent. ${data.description || ''}`.trim();

      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/text-to-voice/design`,
        data: {
          voice_description: description,
          text: "This is a longer preview text designed to meet the minimum character requirement of the ElevenLabs Voice Design API, ensuring that the generated voice sample is clear and stable for evaluation purposes. It needs to be at least one hundred characters long to be accepted by the system.",
          auto_generate_text: false
        },
        headers: {
          'xi-api-key': activeApiKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.data.previews || response.data.previews.length === 0) {
        throw new Error('No voice previews returned from ElevenLabs');
      }

      const firstPreview = response.data.previews[0];

      return {
        generated_voice_id: firstPreview.generated_voice_id,
        audio: Buffer.from(firstPreview.audio_base64, 'base64')
      };
    } catch (error) {
      console.error('ElevenLabs Generate Voice Error:', JSON.stringify(error.response?.data) || error.message);
      throw error;
    }
  }

  async createVoiceFromPreview(data, apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    try {
      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/text-to-voice`,
        data: {
          voice_name: data.voice_name,
          voice_description: data.voice_description,
          generated_voice_id: data.generated_voice_id,
          labels: data.labels
        },
        headers: {
          'xi-api-key': activeApiKey,
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      console.error('ElevenLabs Create Voice Error:', error.response?.data || error.message);
      throw error;
    }
  }

  async registerPhoneNumber(data, apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    try {
      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/convai/phone-numbers/create`,
        data: {
          phone_number: data.phone_number,
          provider: 'twilio',
          label: data.label || data.phone_number,
          sid: data.twilio_account_sid,
          token: data.twilio_auth_token
        },
        headers: {
          'xi-api-key': activeApiKey,
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      const errorMessage = error.response ?
        JSON.stringify(error.response.data) :
        error.message;
      console.error('ElevenLabs Phone Register Error:', errorMessage);
      throw new Error(`ElevenLabs Phone Registration Failed: ${errorMessage}`);
    }
  }

  async importSipPhoneNumber(data, apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    try {
      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/convai/phone-numbers`,
        data: {
          phone_number: data.phone_number,
          label: data.label || data.phone_number,
          provider: 'sip_trunk',
          inbound_trunk_config: data.inbound_trunk_config,
          outbound_trunk_config: data.outbound_trunk_config
        },
        headers: {
          'xi-api-key': activeApiKey,
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      const errorMessage = error.response ?
        JSON.stringify(error.response.data) :
        error.message;
      console.error('ElevenLabs SIP Phone Import Error:', errorMessage);
      throw new Error(`ElevenLabs SIP Phone Import Failed: ${errorMessage}`);
    }
  }

  async updateElevenLabsPhoneNumber(phone_number_id, data, apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    try {
      const response = await axios({
        method: 'PATCH',
        url: `${this.baseUrl}/convai/phone-numbers/${phone_number_id}`,
        data: {
          agent_id: data.agent_id,
          label: data.label,
          inbound_trunk_config: data.inbound_trunk_config,
          outbound_trunk_config: data.outbound_trunk_config
        },
        headers: {
          'xi-api-key': activeApiKey,
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      const errorMessage = error.response ?
        JSON.stringify(error.response.data) :
        error.message;
      console.error('ElevenLabs Phone Update Error:', errorMessage);
      throw new Error(`ElevenLabs Phone Update Failed: ${errorMessage}`);
    }
  }

  async deleteElevenLabsPhoneNumber(phone_number_id, apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    try {
      const response = await axios({
        method: 'DELETE',
        url: `${this.baseUrl}/convai/phone-numbers/${phone_number_id}`,
        headers: {
          'xi-api-key': activeApiKey
        }
      });
      return response.data;
    } catch (error) {
      const errorMessage = error.response ?
        JSON.stringify(error.response.data) :
        error.message;
      console.error('ElevenLabs Phone Delete Error:', errorMessage);
      throw new Error(`ElevenLabs Phone Delete Failed: ${errorMessage}`);
    }
  }

  async createElevenLabsAgent(agentData, apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    if (!activeApiKey) {
      throw new Error('ElevenLabs API Key not configured');
    }

    try {
      const conversationConfig = {
        agent: {
          prompt: {
            prompt: agentData.system_prompt || 'You are a helpful AI assistant.',
            temperature: agentData.temperature || 0.5,
            max_tokens: 1024
          },
          first_message: agentData.first_message || 'Hello! How can I help you today?',
          language: agentData.language || 'en'
        }
      };

      if (agentData.goodbye_message) {
        conversationConfig.agent.end_call_message = agentData.goodbye_message;
      }

      if (agentData.voice_id) {
        conversationConfig.agent.voice = {
          voice_id: agentData.voice_id
        };
      }

      const requestBody = {
        conversation_config: conversationConfig,
        name: agentData.name || 'AI Agent',
        platform_settings: {
          auth_settings: {
            enable_auth: false
          }
        }
      };

      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/convai/agents/create`,
        data: requestBody,
        headers: {
          'xi-api-key': activeApiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data.agent_id;
    } catch (error) {
      const errorMessage = error.response ?
        JSON.stringify(error.response.data) :
        error.message;
      console.error('ElevenLabs Create Agent Error:', errorMessage);
      throw new Error(`ElevenLabs Agent Creation Failed: ${errorMessage}`);
    }
  }

  async updateElevenLabsAgent(agentId, agentData, apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    if (!activeApiKey) {
      throw new Error('ElevenLabs API Key not configured');
    }

    try {
      const conversationConfig = {
        agent: {
          prompt: {
            prompt: agentData.system_prompt || 'You are a helpful AI assistant.',
            temperature: agentData.temperature || 0.5,
            max_tokens: 1024
          },
          first_message: agentData.first_message || 'Hello! How can I help you today?',
          language: agentData.language || 'en'
        }
      };

      if (agentData.goodbye_message) {
        conversationConfig.agent.end_call_message = agentData.goodbye_message;
      }

      if (agentData.voice_id) {
        conversationConfig.agent.voice = {
          voice_id: agentData.voice_id
        };
      }

      const requestBody = {
        conversation_config: conversationConfig,
        name: agentData.name || 'AI Agent',
        platform_settings: {
          auth_settings: {
            enable_auth: false
          }
        }
      };

      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/convai/agents/${agentId}/save`,
        data: requestBody,
        headers: {
          'xi-api-key': activeApiKey,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (error) {
      const errorMessage = error.response ?
        JSON.stringify(error.response.data) :
        error.message;
      console.error('ElevenLabs Update Agent Error:', errorMessage);
      throw new Error(`ElevenLabs Agent Update Failed: ${errorMessage}`);
    }
  }

  async transcribeAudio(audioBuffer, apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    try {
      const formData = new FormData();
      formData.append('model_id', 'scribe_v2');
      formData.append('file', audioBuffer, { filename: 'speech.wav', contentType: 'audio/wav' });

      const response = await axios.post(
        `${this.baseUrl}/speech-to-text`,
        formData,
        {
          headers: {
            'xi-api-key': activeApiKey,
            ...formData.getHeaders()
          }
        }
      );

      console.log('ElevenLabs STT Response:', response.data.text);
      return response.data.text || '';
    } catch (error) {
      console.error('ElevenLabs STT Error:', error.response?.data || error.message);
      return '';
    }
  }

  async makeSipOutboundCall(agentId, agentPhoneNumberId, toNumber, apiKey = null) {
    const activeApiKey = apiKey || this.apiKey;
    if (!activeApiKey) {
      throw new Error('ElevenLabs API Key not configured');
    }
    try {
      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/convai/sip-trunk/outbound-call`,
        data: {
          agent_id: agentId,
          agent_phone_number_id: agentPhoneNumberId,
          to_number: toNumber
        },
        headers: {
          'xi-api-key': activeApiKey,
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      const errorMessage = error.response ?
        JSON.stringify(error.response.data) :
        error.message;
      console.error('ElevenLabs SIP Outbound Call Error:', errorMessage);
      throw new Error(`ElevenLabs SIP Outbound Call Failed: ${errorMessage}`);
    }
  }
}

module.exports = new ElevenLabsService();