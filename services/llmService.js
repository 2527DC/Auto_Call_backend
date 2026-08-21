const axios = require('axios');

class LLMService {
  async generateResponse(prompt, personality, model = 'gemini-2.5-flash', aiConfig = null) {
    try {
      const noiseTokens = ['[background noise]', '[pause]', '[laughs]', '[clicking]', '[phone ringing]', '[phone beeping]', '[outro jingle]', '[silence]', '[phone hangs up]', '[phone hanging up]', '[phone clicks]', '[click]'];
      let cleanPrompt = prompt;
      noiseTokens.forEach(token => {
        const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleanPrompt = cleanPrompt.replace(new RegExp(escapedToken, 'gi'), '');
      });
      cleanPrompt = cleanPrompt.trim();

      const skipWords = ['hello', 'hi', 'hey', 'hii', 'hy', 'um', 'uhm', 'ok', 'okay', 'yes', 'no'];
      if (!cleanPrompt || cleanPrompt.length < 2 || (cleanPrompt.split(' ').length === 1 && skipWords.includes(cleanPrompt.toLowerCase()))) {
        return "";
      }

      if (!aiConfig || !aiConfig.provider || !aiConfig.apiKey || !aiConfig.model) {
        console.error('Missing dynamic AI configuration or API Key.');
        return "I'm sorry, your AI model is not properly configured. Please update your settings with a valid API key and model selection.";
      }

      const provider = aiConfig.provider;
      const apiKey = aiConfig.apiKey;
      model = aiConfig.model;

      switch (provider) {
        case 'gemini':
          return await this.callGemini(cleanPrompt, personality, model, apiKey);
        case 'openai':
          return await this.callOpenAI(cleanPrompt, personality, model, apiKey);
        case 'anthropic':
          return await this.callAnthropic(cleanPrompt, personality, model, apiKey);
        default:
          return "I'm sorry, the selected AI provider is not supported.";
      }
    } catch (error) {
      console.error('LLM Service Error:', error.response?.data || error.message);
      return "I'm sorry, I encountered an error while processing your request.";
    }
  }

  async generateResponseWithSystemPrompt(prompt, systemPrompt, model = 'gemini-2.5-flash', aiConfig = null, agentConfig = null) {
    try {
      const noiseTokens = ['[background noise]', '[pause]', '[laughs]', '[clicking]', '[silence]', '[phone hangs up]', '[phone clicking]', '[click]'];
      let cleanPrompt = prompt;
      noiseTokens.forEach(token => {
        const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleanPrompt = cleanPrompt.replace(new RegExp(escapedToken, 'gi'), '');
      });
      cleanPrompt = cleanPrompt.trim();

      if (!cleanPrompt || cleanPrompt.length < 2) return '';

      if (!aiConfig || !aiConfig.provider || !aiConfig.apiKey || !aiConfig.model) {
        console.error('Missing dynamic AI configuration for incoming agent.');
        return "I'm sorry, the AI model is not properly configured.";
      }

      const provider = aiConfig.provider;
      const apiKey = aiConfig.apiKey;
      const resolvedModel = aiConfig.model;

      let enhancedSystemPrompt = systemPrompt || 'You are a helpful and professional AI assistant on a phone call. Keep answers concise.';

      if (agentConfig) {
        const traits = [];

        if (agentConfig.empathy_level) {
          traits.push(`Empathy Level: ${agentConfig.empathy_level === 'high' ? 'Show high empathy and understanding' : agentConfig.empathy_level === 'low' ? 'Keep responses factual and direct' : 'Show moderate empathy'}`);
        }

        if (agentConfig.energy_level) {
          traits.push(`Energy Level: ${agentConfig.energy_level === 'energetic' ? 'Be enthusiastic and energetic' : agentConfig.energy_level === 'calm' ? 'Maintain a calm and soothing tone' : 'Keep a balanced, professional tone'}`);
        }

        if (agentConfig.response_length) {
          traits.push(`Response Length: ${agentConfig.response_length === 'concise' ? 'Keep responses very brief (1-2 sentences)' : agentConfig.response_length === 'verbose' ? 'Provide detailed explanations' : 'Keep responses moderate in length'}`);
        }

        if (agentConfig.intelligence_level !== undefined) {
          const intelLevel = agentConfig.intelligence_level;
          traits.push(`Intelligence Level: ${intelLevel}/10 - ${intelLevel >= 8 ? 'Provide sophisticated, nuanced responses' : intelLevel >= 5 ? 'Provide clear, straightforward responses' : 'Keep responses simple and basic'}`);
        }

        if (traits.length > 0) {
          enhancedSystemPrompt += '\n\nPERSONALITY TRAITS:\n' + traits.join('\n');
        }
      }

      switch (provider) {
        case 'gemini':
          return await this.callGeminiWithSystem(cleanPrompt, enhancedSystemPrompt, resolvedModel, apiKey);
        case 'openai':
          return await this.callOpenAIWithSystem(cleanPrompt, enhancedSystemPrompt, resolvedModel, apiKey);
        case 'anthropic':
          return await this.callAnthropicWithSystem(cleanPrompt, enhancedSystemPrompt, resolvedModel, apiKey);
        default:
          return "I'm sorry, the selected AI provider is not supported.";
      }
    } catch (error) {
      console.error('LLM System Prompt Error:', error.response?.data || error.message);
      return "I'm sorry, I encountered an error while processing your request.";
    }
  }

  async generateDiarization(prompt, model, aiConfig) {
    try {
      const provider = aiConfig.provider.toLowerCase();
      const apiKey = aiConfig.apiKey;
      
      switch (provider) {
        case 'openai':
          return await this.callOpenAIDiarization(prompt, model, apiKey);
        case 'anthropic':
          return await this.callAnthropicDiarization(prompt, model, apiKey);
        case 'gemini':
        default:
          return await this.callGeminiDiarization(prompt, model, apiKey);
      }
    } catch (error) {
      console.error('LLM Diarization Error:', error.response?.data || error.message);
      throw error;
    }
  }

  async callGeminiDiarization(prompt, model, apiKey) {
    const modelId = model.startsWith('models/') ? model : `models/${model}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      system_instruction: {
        parts: [{ text: "You format transcripts into JSON. Output only valid JSON without markdown formatting." }]
      },
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
    };
    let response;
    try {
      response = await axios.post(url, payload);
    } catch (err) {
      if (err.response && err.response.status === 429) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const fallbackUrl = url.replace(model, 'gemini-1.5-flash');
        response = await axios.post(fallbackUrl, payload);
      } else throw err;
    }
    if (response.data.candidates && response.data.candidates[0].content) {
      return response.data.candidates[0].content.parts[0].text;
    }
    throw new Error('No response from Gemini');
  }

  async callOpenAIDiarization(prompt, model, apiKey) {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: "You format transcripts into JSON. Output only valid JSON without markdown formatting." },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 4096
      },
      { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
    );
    return response.data.choices[0].message.content;
  }

  async callAnthropicDiarization(prompt, model, apiKey) {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: model || 'claude-3-haiku-20240307',
        max_tokens: 4096,
        system: "You format transcripts into JSON. Output only valid JSON without markdown formatting.",
        messages: [{ role: 'user', content: prompt }]
      },
      { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } }
    );
    return response.data.content[0].text;
  }

  async callGeminiWithSystem(prompt, systemPrompt, model, apiKey) {
    const modelId = model.startsWith('models/') ? model : `models/${model}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      system_instruction: {
        parts: [{
          text: `${systemPrompt}

CRITICAL INSTRUCTIONS:
1. Keep responses SHORT and CONCISE. Maximum 2-3 sentences. This is a phone call.
2. Speak naturally as if talking on the phone.
3. Be helpful, professional, and follow the system prompt above strictly.`
        }]
      },
      generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
    };
    let response;
    try {
      response = await axios.post(url, payload);
    } catch (err) {
      if (err.response && err.response.status === 429) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const fallbackUrl = url.replace(model, 'gemini-1.5-flash');
        response = await axios.post(fallbackUrl, payload);
      } else throw err;
    }
    if (response.data.candidates && response.data.candidates[0].content) {
      return response.data.candidates[0].content.parts[0].text;
    }
    throw new Error('No response from Gemini');
  }

  async callOpenAIWithSystem(prompt, systemPrompt, model, apiKey) {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `${systemPrompt}\n\nKeep responses very short (2-3 sentences max). This is a phone call.` },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 200
      },
      { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
    );
    return response.data.choices[0].message.content;
  }

  async callAnthropicWithSystem(prompt, systemPrompt, model, apiKey) {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: model || 'claude-3-haiku-20240307',
        max_tokens: 200,
        system: `${systemPrompt}\n\nKeep responses very short (2-3 sentences max). This is a phone call.`,
        messages: [{ role: 'user', content: prompt }]
      },
      { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } }
    );
    return response.data.content[0].text;
  }

  async callGemini(prompt, personality, model, apiKey) {
    const modelId = model.startsWith('models/') ? model : `models/${model}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      system_instruction: {
        parts: [{
          text: `Personality: ${personality || 'Helpful and professional AI assistant.'}
CRITICAL INSTRUCTIONS:
1. RESPONSE LENGTH: Keep responses VERY SHORT and CONCISE. Maximum 2 sentences or 25 words. This is for a phone call.
2. LANGUAGE: You MUST speak ONLY in English. If the user speaks another language, reply politely in English that you only support English for now.
3. TONE: Professional and helpful.` }]
      },
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
      }
    };

    let response;
    try {
      response = await axios.post(url, payload);
    } catch (err) {
      if (err.response && err.response.status === 429) {
        console.warn('[Gemini] Rate limited (429). Retrying with gemini-1.5-flash in 2 seconds...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        const fallbackUrl = url.replace('gemini-2.0-flash', 'gemini-1.5-flash');
        response = await axios.post(fallbackUrl, payload);
      } else {
        throw err;
      }
    }

    if (response.data.candidates && response.data.candidates[0].content) {
      return response.data.candidates[0].content.parts[0].text;
    }
    throw new Error('No response from Gemini');
  }

  async callOpenAI(prompt, personality, model, apiKey) {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `You are an AI assistant. Personality: ${personality || 'Helpful and professional.'}` },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content;
  }

  async callAnthropic(prompt, personality, model, apiKey) {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: model || 'claude-3-haiku-20240307',
        max_tokens: 1024,
        system: `Personality: ${personality || 'Helpful AI.'}`,
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.content[0].text;
  }
  async extractAppointmentDetails(transcript, currentDateTime = new Date(), aiConfig = null) {
    try {
      let apiKey, model, provider;

      if (aiConfig?.apiKey && aiConfig?.model && aiConfig?.provider) {
        apiKey = aiConfig.apiKey;
        model = aiConfig.model;
        provider = aiConfig.provider;
      } else {
        apiKey = process.env.GEMINI_API_KEY;
        model = 'gemini-2.5-flash';
        provider = 'gemini';

        if (!apiKey) {
          console.error('[Extraction] No Gemini API key found in settings or environment.');
          return null;
        }
      }

      if (provider === 'openai') {
        return await this.extractWithOpenAI(transcript, currentDateTime, model, apiKey);
      }

      const modelId = model.startsWith('models/') ? model : `models/${model}`;
      const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{
          parts: [{
            text: `Extract appointment details from the following transcript. Return ONLY a JSON object with keys: "name", "date", "time".
If a field is not found, use null.
The current date and time is: ${currentDateTime.toISOString()}.
Transcript: "${transcript}"`
          }]
        }],
        generationConfig: {
          response_mime_type: "application/json",
        }
      };

      let response;
      try {
        response = await axios.post(url, payload);
      } catch (err) {
        if (err.response && err.response.status === 429) {
          console.warn('[Extraction] Rate limited (429). Retrying with gemini-1.5-flash in 2 seconds...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          const fallbackUrl = url.replace('gemini-2.0-flash', 'gemini-2.5-flash');
          response = await axios.post(fallbackUrl, payload);
        } else {
          throw err;
        }
      }

      if (response.data.candidates && response.data.candidates[0].content) {
        const text = response.data.candidates[0].content.parts[0].text;
        return JSON.parse(text);
      }
      return null;
    } catch (error) {
      console.error('Extraction Error:', error);
      return null;
    }
  }

  async extractWithOpenAI(transcript, currentDateTime, model, apiKey) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: model || 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Extract appointment details from the transcript. Return ONLY a JSON object with keys: "name", "date", "time". If a field is not found, use null. Current date/time: ${currentDateTime.toISOString()}`
            },
            { role: 'user', content: transcript }
          ],
          response_format: { type: "json_object" }
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return JSON.parse(response.data.choices[0].message.content);
    } catch (e) {
      console.error('OpenAI Extraction Error:', e.message);
    }
  }

  async extractFormFieldValue(transcript, fieldLabel, fieldQuestion, aiConfig = null) {
    try {
      let apiKey, model, provider;

      if (aiConfig?.apiKey && aiConfig?.model && aiConfig?.provider) {
        apiKey = aiConfig.apiKey;
        model = aiConfig.model;
        provider = aiConfig.provider;
      } else {
        apiKey = process.env.GEMINI_API_KEY;
        model = 'gemini-2.5-flash';
        provider = 'gemini';
      }

      if (!apiKey) return null;

      const modelId = model.startsWith('models/') ? model : `models/${model}`;
      const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{
          parts: [{
            text: `Extract the answer for the following question from the user's transcript.
Question Label: "${fieldLabel}"
Question Text: "${fieldQuestion}"
Transcript: "${transcript}"

Return ONLY a JSON object with the key "value". If no answer is found or the user is just saying "hello" or irrelevant things, return {"value": null}.`
          }]
        }],
        generationConfig: {
          response_mime_type: "application/json",
        }
      };

      const response = await axios.post(url, payload);
      if (response.data.candidates && response.data.candidates[0].content) {
        const text = response.data.candidates[0].content.parts[0].text;
        const result = JSON.parse(text);
        return result.value;
      }
      return null;
    } catch (error) {
      console.error('Field Extraction Error:', error.message);
      return null;
    }
  }

  async evaluateDecisionSplit(transcript, condition, aiConfig = null) {
    try {
      let apiKey, model, provider;

      if (aiConfig?.apiKey && aiConfig?.model && aiConfig?.provider) {
        apiKey = aiConfig.apiKey;
        model = aiConfig.model;
        provider = aiConfig.provider;
      } else {
        apiKey = process.env.GEMINI_API_KEY;
        model = 'gemini-2.5-flash';
        provider = 'gemini';
      }

      if (!apiKey) return false;

      const modelId = model.startsWith('models/') ? model : `models/${model}`;
      const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{
          parts: [{
            text: `Evaluate if the following transcript matches the condition.
Condition: "${condition}"
Transcript: "${transcript}"

Return ONLY a JSON object with a boolean key "match". Return {"match": true} if the transcript satisfies the condition, or {"match": false} otherwise.`
          }]
        }],
        generationConfig: {
          response_mime_type: "application/json",
        }
      };

      const response = await axios.post(url, payload);
      if (response.data.candidates && response.data.candidates[0].content) {
        const text = response.data.candidates[0].content.parts[0].text;
        const result = JSON.parse(text);
        return result.match === true;
      }
      return false;
    } catch (error) {
      console.error('Decision Split Evaluation Error:', error.message);
      return false;
    }
  }
}

module.exports = new LLMService();