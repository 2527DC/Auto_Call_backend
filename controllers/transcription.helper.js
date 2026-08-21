const { db } = require('../models');
const Call = db.Call;
const UserSettings = db.UserSettings;
const axios = require('axios');
const FormData = require('form-data');
const elevenLabsService = require('../services/elevenlabsService');
const llmService = require('../services/llmService');
const deepgramService = require('../services/deepgramService');

exports.processCallTranscription = async (callId, recordingUrl) => {
  try {
    const call = await Call.findById(callId);
    if (!call || call.transcript?.length > 0 || !recordingUrl) return;

    const fs = require('fs');
    const settings = await UserSettings.findOne({ user: call.user_id }).populate('ai_model');
    const twilioSid = settings?.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = settings?.twilio_auth_token || process.env.TWILIO_AUTH_TOKEN;
    
    if (!settings && !process.env.OPENAI_API_KEY && !process.env.DEEPGRAM_API_KEY && !process.env.GEMINI_API_KEY) {
        return;
    }

    let audioBuffer = null;
    for (let i = 0; i < 4; i++) {
      try {
        const response = await axios({
          method: 'get',
          url: recordingUrl + '.wav',
          responseType: 'arraybuffer',
          auth: twilioSid && twilioAuth ? { username: twilioSid, password: twilioAuth } : undefined
        });
        audioBuffer = Buffer.from(response.data);
        break;
      } catch (err) {
        if (i === 3) throw err;
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    if (!audioBuffer) return;

    let text = "";
    try {
      if (settings?.elevenlabs_api_key) {
        text = await elevenLabsService.transcribeAudio(audioBuffer, settings.elevenlabs_api_key);
      } else {
        throw new Error('No ElevenLabs key');
      }
    } catch (sttError) {
      const openaiKey = settings?.openai_api_key || process.env.OPENAI_API_KEY;
      if (openaiKey) {
        try {
          const form = new FormData();
          form.append('file', audioBuffer, { filename: 'recording.wav', contentType: 'audio/wav' });
          form.append('model', 'whisper-1');
          
          const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
            headers: { ...form.getHeaders(), 'Authorization': `Bearer ${openaiKey}` }
          });
          text = whisperRes.data.text;
        } catch (whisperErr) {
           // whisper failed
        }
      }
    }

    if (!text && process.env.GEMINI_API_KEY) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const payload = {
          contents: [{ parts: [
            { text: "Please transcribe this audio exactly as it is spoken. Output only the raw transcript without any markdown." },
            { inline_data: { mime_type: "audio/wav", data: audioBuffer.toString('base64') } }
          ]}]
        };
        const geminiRes = await axios.post(url, payload);
        if (geminiRes.data.candidates && geminiRes.data.candidates[0].content) {
          text = geminiRes.data.candidates[0].content.parts[0].text;
        }
      } catch (geminiErr) {}
    }

    if (!text && settings?.deepgram_api_key) {
      try { text = await deepgramService.transcribeAudio(audioBuffer, settings.deepgram_api_key); } catch (dgErr) {}
    }
    if (!text && process.env.DEEPGRAM_API_KEY) {
      try { text = await deepgramService.transcribeAudio(audioBuffer, process.env.DEEPGRAM_API_KEY); } catch (dgErr) {}
    }

    if (text && text.trim().length > 0) {
      let parsedTranscript = [];
      try {
        const aiConfig = settings?.ai_model ? {
          provider: settings.ai_model.provider,
          apiKey: settings.ai_api_key || process.env.GEMINI_API_KEY,
          model: settings.ai_model.model_id
        } : {
          provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-2.5-flash'
        };

        const prompt = `You are a helpful assistant. Here is a transcript of a phone conversation between a 'human' (the team member who initiated the call from our virtual phone) and a 'user' (the person who received the call). It was transcribed from a single audio file so the speakers are mixed together. 
Please separate the text into an array of JSON objects with 'role' (either 'human' or 'user') and 'text' (what they said). 
Return ONLY valid JSON array format, no markdown formatting.
Transcript: "${text}"`;

        try {
          const jsonStr = await llmService.generateDiarization(prompt, aiConfig.model, aiConfig);
          const cleanJsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
          parsedTranscript = JSON.parse(cleanJsonStr);
        } catch (e) {
          try {
            const fallbackAiConfig = { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: 'gemini-2.5-flash' };
            const fallbackJsonStr = await llmService.generateDiarization(prompt, fallbackAiConfig.model, fallbackAiConfig);
            const fallbackCleanJsonStr = fallbackJsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
            parsedTranscript = JSON.parse(fallbackCleanJsonStr);
          } catch (fallbackErr) {
            parsedTranscript = [{ role: 'human', text: text }];
          }
        }
      } catch (outerErr) {
        parsedTranscript = [{ role: 'human', text: text }];
      }

      const updatedCall = await Call.findById(call._id);
      if (updatedCall && (!updatedCall.transcript || updatedCall.transcript.length === 0)) {
        if (Array.isArray(parsedTranscript)) {
          parsedTranscript.forEach(t => {
            if (t.role && t.text) {
              updatedCall.transcript.push({
                role: ['agent', 'user', 'human'].includes(t.role) ? t.role : 'human',
                text: t.text
              });
            }
          });
        }
        if (updatedCall.transcript.length === 0) {
            updatedCall.transcript.push({ role: 'human', text: text });
        }
        await updatedCall.save();
      }
    }
  } catch (transcriptionError) {
    console.error('[Recording] Async Transcription Error:', transcriptionError.message);
  }
};
