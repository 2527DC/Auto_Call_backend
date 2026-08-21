'use strict';

const { db } = require('../models');
const Call = db.Call;
const UserSettings = db.UserSettings;
const Agent = db.Agent;
const CampaignHistory = db.CampaignHistory;
const PhoneNumber = db.PhoneNumber;
const Contact = db.Contact;
const twilioService = require('../services/twilioService');
const creditService = require('../services/creditService');
const axios = require('axios');
const elevenLabsService = require('../services/elevenlabsService');
const llmService = require('../services/llmService');
const FormData = require('form-data');
const webhookDispatcher = require('../services/webhookDispatcher');
const plivoService = require('../services/plivoService');
const deepgramService = require('../services/deepgramService');

exports.placeCall = async (req, res) => {
  try {
    const { flowId, phoneNumber, fromNumber, agentId } = req.body;
    console.log("🚀 ~ req.body:", req.body)
    const userId = req.user.id;

    if (!flowId || !phoneNumber || !fromNumber) {
      return res.status(400).json({ success: false, message: 'flowId, phoneNumber, and fromNumber are required' });
    }

    const contact = await Contact.findOne({ user_id: userId, phone_number: phoneNumber });
    if (contact && contact.is_blocked) {
      return res.status(403).json({ success: false, message: 'This contact is blocked due to policy violations.' });
    }

    let agent;
    if (agentId) {
      agent = await Agent.findById(agentId);
      if (!agent) {
        return res.status(404).json({ success: false, message: 'Selected agent not found' });
      }
    } else {
      agent = await Agent.findOne({ flow_id: flowId, type: 'flow', status: 'active' });
    }
    if (!agent) {
      return res.status(400).json({
        success: false,
        message: 'This flow is not assigned to any active AI flow agent. Please assign a flow agent to the flow before placing a call.'
      });
    }

    const settings = await UserSettings.findOne({ user: userId });
    if (!settings) {
      return res.status(400).json({ success: false, message: 'User settings not found' });
    }

    const appUrl = process.env.APP_URL;
    if (!appUrl) {
      return res.status(500).json({ success: false, message: 'APP_URL not configured' });
    }

    const sourceNumber = await PhoneNumber.findOne({ phone_number: fromNumber });
    if (!sourceNumber) {
      return res.status(404).json({ success: false, message: 'Source phone number not found in your account' });
    }
    const isAdmin = req.user.roleId.name === 'super_admin' || req.user.roleId.name === 'admin';
    if (!isAdmin && sourceNumber.user_id && sourceNumber.user_id.toString() !== userId.toString()) {
      return res.status(404).json({ success: false, message: 'Source phone number not found in your account' });
    }

    let callLog;

    if (sourceNumber.type === 'sip' && sourceNumber.elevenlabs_phone_number_id) {
      if (!settings.elevenlabs_api_key) {
        return res.status(400).json({ success: false, message: 'ElevenLabs API key not configured' });
      }
      if (!agent.elevenlabs_agent_id) {
        return res.status(400).json({ success: false, message: 'Selected agent is not configured for ElevenLabs SIP calling' });
      }

      const sipResponse = await elevenLabsService.makeSipOutboundCall(
        agent.elevenlabs_agent_id,
        sourceNumber.elevenlabs_phone_number_id,
        phoneNumber,
        settings.elevenlabs_api_key
      );

      callLog = await Call.create({
        user_id: userId,
        flow_id: flowId,
        agent_id: agent._id,
        twilio_call_sid: sipResponse.sip_call_id || sipResponse.conversation_id || `sip_${Date.now()}`,
        from_number: fromNumber,
        to_number: phoneNumber,
        status: 'queued',
        direction: 'outbound',
        contact_id: contact ? contact._id : null
      });
      webhookDispatcher.dispatchEvent(userId, 'Call Initiated', callLog);
    } else if (sourceNumber.provider === 'plivo') {
      const authId = settings.plivo_auth_id || process.env.PLIVO_AUTH_ID;
      const authToken = settings.plivo_auth_token || process.env.PLIVO_AUTH_TOKEN;
      if (!authId || !authToken) {
        return res.status(400).json({ success: false, message: 'Plivo settings not configured' });
      }

      const xmlUrl = `${appUrl}/api/calls/plivo-xml?flowId=${flowId}&userId=${userId}&agentId=${agent._id.toString()}`;
      const statusCallbackUrl = `${appUrl}/api/calls/plivo-status`;

      const plivoCall = await plivoService.makeCall(
        authId,
        authToken,
        fromNumber,
        phoneNumber,
        xmlUrl,
        statusCallbackUrl
      );

      callLog = await Call.create({
        user_id: userId,
        flow_id: flowId,
        agent_id: agent._id,
        twilio_call_sid: plivoCall.requestUuid,
        from_number: fromNumber,
        to_number: phoneNumber,
        status: 'queued',
        direction: 'outbound',
        contact_id: contact ? contact._id : null
      });
      webhookDispatcher.dispatchEvent(userId, 'Call Initiated', callLog);
    } else {
      if (!settings.twilio_account_sid || !settings.twilio_auth_token) {
        return res.status(400).json({ success: false, message: 'Twilio settings not configured' });
      }

      const twimlUrl = `${appUrl}/api/calls/twiml?flowId=${flowId}&userId=${userId}&agentId=${agent._id.toString()}`;
      const statusCallbackUrl = `${appUrl}/api/calls/status`;

      const twilioCall = await twilioService.makeCall(
        settings.twilio_account_sid,
        settings.twilio_auth_token,
        fromNumber,
        phoneNumber,
        twimlUrl,
        statusCallbackUrl
      );

      callLog = await Call.create({
        user_id: userId,
        flow_id: flowId,
        agent_id: agent._id,
        twilio_call_sid: twilioCall.sid,
        from_number: fromNumber,
        to_number: phoneNumber,
        status: twilioCall.status || 'queued',
        direction: 'outbound',
        contact_id: contact ? contact._id : null
      });
      webhookDispatcher.dispatchEvent(userId, 'Call Initiated', callLog);
    }

    const creditBalance = await creditService.getCreditBalance(userId);

    res.json({
      success: true,
      message: 'Call initiated successfully',
      data: callLog,
      credits: creditBalance
    });
  } catch (error) {
    console.error('Place Call Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to place call' });
  }
};

exports.generateTwiML = async (req, res) => {
  if (req.body?.widgetKey || req.query?.widgetKey) {
    const widgetController = require('./widget.controller');
    return widgetController.handleWidgetVoice(req, res);
  }
  const { flowId, userId, agentId } = req.query;
  const appUrl = process.env.APP_URL.replace('http', 'ws');

  let parametersXml = '';
  if (flowId && flowId !== 'undefined') {
    parametersXml += `<Parameter name="flowId" value="${flowId}" />\n`;
  }
  if (userId && userId !== 'undefined') {
    parametersXml += `<Parameter name="userId" value="${userId}" />\n`;
  }
  if (agentId && agentId !== 'undefined') {
    parametersXml += `<Parameter name="agentId" value="${agentId}" />`;
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${appUrl}">
            ${parametersXml}
        </Stream>
    </Connect>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
};

exports.generatePlivoXML = async (req, res) => {
  const { flowId, userId, agentId } = req.query;
  const appUrl = process.env.APP_URL.replace('http', 'ws');

  let parametersXml = '';
  if (flowId && flowId !== 'undefined') {
    parametersXml += `<Parameter name="flowId" value="${flowId}" />\n`;
  }
  if (userId && userId !== 'undefined') {
    parametersXml += `<Parameter name="userId" value="${userId}" />\n`;
  }
  if (agentId && agentId !== 'undefined') {
    parametersXml += `<Parameter name="agentId" value="${agentId}" />`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream url="${appUrl}" keepCallAlive="true">
        ${parametersXml}
    </Stream>
</Response>`;

  res.type('text/xml');
  res.send(xml);
};

exports.handleStatusCallback = async (req, res) => {
  const { CallSid, ParentCallSid, CallStatus, CallDuration, RecordingUrl } = req.body;
  try {
    let mappedCallStatus = CallStatus;
    if (CallStatus === 'busy') mappedCallStatus = 'declined';
    if (CallStatus === 'no-answer') mappedCallStatus = 'missed';

    const isEnded = ['completed', 'failed', 'busy', 'no-answer', 'canceled', 'declined', 'missed'].includes(CallStatus) || ['declined', 'missed'].includes(mappedCallStatus);

    const updateData = {};
    if (CallStatus) updateData.status = mappedCallStatus;
    if (CallDuration) updateData.duration = Number(CallDuration);
    if (isEnded) updateData.ended_at = new Date();
    if (RecordingUrl) updateData.recording_url = RecordingUrl;

    const queryOptions = [CallSid];
    if (ParentCallSid) queryOptions.push(ParentCallSid);

    let call = await Call.findOneAndUpdate(
      { twilio_call_sid: { $in: queryOptions } },
      updateData,
      { new: true }
    );

    if (call && CallSid && call.twilio_call_sid !== CallSid) {
      call.twilio_call_sid = CallSid;
      await call.save();
    }

    if (call && call.user_id && req.app.get('io')) {
      req.app.get('io').emit(`call-status-update-${call.user_id}`, { 
        callSid: CallSid, 
        status: mappedCallStatus 
      });
    }

    if (call && call.user_id) {
      if (CallStatus === 'completed') {
        webhookDispatcher.dispatchEvent(call.user_id, call.direction === 'inbound' ? 'Inbound Call Finished' : 'Call Finished', call);
      } else if (CallStatus === 'failed' || CallStatus === 'canceled') {
        webhookDispatcher.dispatchEvent(call.user_id, call.direction === 'inbound' ? 'Inbound Call Unanswered' : 'Call Errored', call);
      } else if (CallStatus === 'busy') {
        webhookDispatcher.dispatchEvent(call.user_id, 'Number Busy', call);
      } else if (CallStatus === 'no-answer') {
        webhookDispatcher.dispatchEvent(call.user_id, call.direction === 'inbound' ? 'Inbound Call Unanswered' : 'Unanswered', call);
      } else if (CallStatus === 'ringing') {
        webhookDispatcher.dispatchEvent(call.user_id, 'Call Ringing', call);
      } else if (CallStatus === 'in-progress') {
        webhookDispatcher.dispatchEvent(call.user_id, call.direction === 'inbound' ? 'Inbound Call Handled' : 'Call Picked Up', call);
      }

      if (req.body.AnsweredBy && req.body.AnsweredBy.includes('machine_')) {
        webhookDispatcher.dispatchEvent(call.user_id, 'Left Voicemail', call);
      }
    }

    if (call && RecordingUrl && (!call.transcript || call.transcript.length === 0)) {
      const { processCallTranscription } = require('./transcription.helper');
      processCallTranscription(call._id, RecordingUrl);
    }

    if (call && isEnded && call.duration === 0 && call.started_at && call.ended_at) {
      call.duration = Math.max(0, Math.round((call.ended_at.getTime() - call.started_at.getTime()) / 1000));
      await call.save();
    }

    if (call && CallStatus === 'completed' && call.user_id) {
      try {
        const callDuration = call.duration || 0;
        const creditResult = await creditService.processCallCreditDeduction(
          call.user_id,
          call._id,
          callDuration
        );
        call.credits_used = creditResult.credits_deducted;
        await call.save();
        console.log(`Credits deducted for call ${CallSid}: ${creditResult.credits_deducted}`);
      } catch (creditError) {
        console.error('Credit deduction error:', creditError.message);
      }
    }

    if (call && call.campaign_id && isEnded) {
      let executionStatus = 'PENDING';
      if (CallStatus === 'completed') executionStatus = 'CONTACT SUCCESSFUL';
      else if (CallStatus === 'failed' || CallStatus === 'no-answer') executionStatus = 'CALL FAILED';
      else if (CallStatus === 'busy') executionStatus = 'LINE BUSY';
      else if (CallStatus === 'canceled') executionStatus = 'CANCELED';

      if (CampaignHistory) {
        await CampaignHistory.findOneAndUpdate(
          { campaignId: call.campaign_id, leadPhone: call.to_number },
          {
            callStatus: executionStatus,
            callDuration: call.duration || 0,
            recordingUrl: call.recording_url || null
          },
          { new: true }
        );
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Status Callback Error:', error);
    res.sendStatus(500);
  }
};

exports.handlePlivoStatusCallback = async (req, res) => {
  const { CallUUID, RequestUUID, CallStatus, Duration, RecordUrl } = req.body;
  try {
    let mappedCallStatus = CallStatus;
    if (CallStatus === 'busy') mappedCallStatus = 'declined';
    if (CallStatus === 'no-answer') mappedCallStatus = 'missed';

    const isEnded = ['completed', 'failed', 'busy', 'no-answer', 'canceled', 'declined', 'missed'].includes(CallStatus) || ['declined', 'missed'].includes(mappedCallStatus);

    const updateData = {};
    if (CallStatus) updateData.status = mappedCallStatus;
    if (Duration) updateData.duration = Number(Duration);
    if (isEnded) updateData.ended_at = new Date();
    if (RecordUrl) updateData.recording_url = RecordUrl;

    let call = await Call.findOneAndUpdate(
      { twilio_call_sid: { $in: [CallUUID, RequestUUID] } },
      updateData,
      { new: true }
    );
    
    if (call && CallUUID && call.twilio_call_sid !== CallUUID) {
      call.twilio_call_sid = CallUUID;
      await call.save();
    }

    if (call && call.user_id) {
      if (CallStatus === 'completed') {
        webhookDispatcher.dispatchEvent(call.user_id, call.direction === 'inbound' ? 'Inbound Call Finished' : 'Call Finished', call);
      } else if (CallStatus === 'failed' || CallStatus === 'canceled') {
        webhookDispatcher.dispatchEvent(call.user_id, call.direction === 'inbound' ? 'Inbound Call Unanswered' : 'Call Errored', call);
      } else if (CallStatus === 'busy') {
        webhookDispatcher.dispatchEvent(call.user_id, 'Number Busy', call);
      } else if (CallStatus === 'no-answer') {
        webhookDispatcher.dispatchEvent(call.user_id, call.direction === 'inbound' ? 'Inbound Call Unanswered' : 'Unanswered', call);
      } else if (CallStatus === 'ringing') {
        webhookDispatcher.dispatchEvent(call.user_id, 'Call Ringing', call);
      } else if (CallStatus === 'in-progress') {
        webhookDispatcher.dispatchEvent(call.user_id, call.direction === 'inbound' ? 'Inbound Call Handled' : 'Call Picked Up', call);
      }
    }

    if (call && isEnded && call.duration === 0 && call.started_at && call.ended_at) {
      call.duration = Math.max(0, Math.round((call.ended_at.getTime() - call.started_at.getTime()) / 1000));
      await call.save();
    }

    if (call && CallStatus === 'completed' && call.user_id) {
      try {
        const callDuration = call.duration || 0;
        const creditResult = await creditService.processCallCreditDeduction(
          call.user_id,
          call._id,
          callDuration
        );
        call.credits_used = creditResult.credits_deducted;
        await call.save();
      } catch (creditError) {
        console.error('Credit deduction error:', creditError.message);
      }
    }

    if (call && call.campaign_id && isEnded) {
      let executionStatus = 'PENDING';
      if (CallStatus === 'completed') executionStatus = 'CONTACT SUCCESSFUL';
      else if (CallStatus === 'failed' || CallStatus === 'no-answer') executionStatus = 'CALL FAILED';
      else if (CallStatus === 'busy') executionStatus = 'LINE BUSY';
      else if (CallStatus === 'canceled') executionStatus = 'CANCELED';

      if (CampaignHistory) {
        await CampaignHistory.findOneAndUpdate(
          { campaignId: call.campaign_id, leadPhone: call.to_number },
          {
            callStatus: executionStatus,
            callDuration: call.duration || 0,
            recordingUrl: call.recording_url || null
          },
          { new: true }
        );
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Plivo Status Callback Error:', error);
    res.sendStatus(500);
  }
};

exports.handleTransferStatusCallback = async (req, res) => {
  const { CallSid, DialCallStatus, DialCallDuration, RecordingUrl, TranscriptionText } = req.body;
  try {
    if (!CallSid) return res.sendStatus(200);

    const call = await Call.findOne({ twilio_call_sid: CallSid });
    if (!call) return res.sendStatus(200);

    if (call.is_transferred && call.transfer_details) {
      let mappedStatus = DialCallStatus || call.transfer_details.human_call_status;
      if (DialCallStatus === 'no-answer') mappedStatus = 'missed';
      if (DialCallStatus === 'busy') mappedStatus = 'declined';
      if (DialCallStatus === 'failed' || DialCallStatus === 'canceled') mappedStatus = 'failed';
      if (DialCallStatus === 'completed' || DialCallStatus === 'answered') mappedStatus = 'completed';

      call.transfer_details.human_call_status = mappedStatus;

      if (DialCallDuration) {
        call.transfer_details.human_duration = Number(DialCallDuration);
      }

      let agent = null;
      if (call.agent_id) {
        agent = await Agent.findById(call.agent_id);
      } else if (call.flow_id) {
        agent = await Agent.findOne({ flow_id: call.flow_id });
      }

      const enableRecording = agent ? agent.enable_call_recording : false;
      const enableTranscription = agent ? agent.enable_call_transcription : true;

      if (RecordingUrl && enableRecording) {
        call.transfer_details.human_recording_url = RecordingUrl;
      }

      if (TranscriptionText && enableTranscription) {
        call.transfer_details.human_transcript.push({
          role: 'human',
          text: TranscriptionText
        });
      }

      if (['completed', 'answered'].includes(DialCallStatus)) {
        call.transfer_details.answered_at = call.transfer_details.transferred_at || new Date();
      }
      call.transfer_details.ended_at = new Date();

      await call.save();
      webhookDispatcher.dispatchEvent(call.user_id, 'Call Redirected', call);

      if (RecordingUrl && enableTranscription) {
        (async () => {
          try {
            const settings = await UserSettings.findOne({ user: call.user_id }).populate('ai_model');
            if (settings && settings.twilio_account_sid && settings.twilio_auth_token) {

              await new Promise(resolve => setTimeout(resolve, 10000));

              let audioBuffer = null;
              for (let i = 0; i < 3; i++) {
                try {
                  const response = await axios({
                    method: 'get',
                    url: RecordingUrl + '.wav',
                    responseType: 'arraybuffer',
                    auth: {
                      username: settings.twilio_account_sid,
                      password: settings.twilio_auth_token
                    }
                  });
                  audioBuffer = Buffer.from(response.data);
                  break;
                } catch (err) {
                  console.warn(`[Transfer] Recording not ready yet (attempt ${i + 1}/3)... Retrying in 5s`);
                  await new Promise(resolve => setTimeout(resolve, 5000));
                }
              }

              if (!audioBuffer) {
                throw new Error('Failed to download recording from Twilio after 3 attempts.');
              }

              let text = "";
              try {
                if (settings.elevenlabs_api_key) {
                  text = await elevenLabsService.transcribeAudio(audioBuffer, settings.elevenlabs_api_key);
                } else {
                  throw new Error('No ElevenLabs key');
                }
              } catch (sttError) {
                console.warn('[Transfer] ElevenLabs STT failed (possibly quota). Falling back to OpenAI Whisper:', sttError.message);
                const openaiKey = process.env.OPENAI_API_KEY;
                if (openaiKey) {
                  try {
                    const form = new FormData();
                    form.append('file', audioBuffer, { filename: 'transfer.wav', contentType: 'audio/wav' });
                    form.append('model', 'whisper-1');

                    const whisperResponse = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
                      headers: {
                        ...form.getHeaders(),
                        'Authorization': `Bearer ${openaiKey}`
                      }
                    });
                    text = whisperResponse.data.text;
                  } catch (whisperErr) {
                    console.error('[Transfer] OpenAI Whisper fallback failed:', whisperErr.response?.data || whisperErr.message);
                  }
                } else {
                  console.warn('[Transfer] No OpenAI API key available for fallback.');
                }
              }

              if (text && text.trim().length > 0) {
                let parsedTranscript = [];
                try {
                  const aiConfig = settings.ai_model ? {
                    provider: settings.ai_model.provider,
                    apiKey: settings.ai_api_key || process.env.GEMINI_API_KEY,
                    model: settings.ai_model.model_id
                  } : {
                    provider: 'gemini',
                    apiKey: process.env.GEMINI_API_KEY,
                    model: 'gemini-2.5-flash'
                  };

                  const prompt = `You are a helpful assistant. Here is a transcript of a phone conversation between a 'human' (a business agent / team member) and a 'user' (the customer calling). It was transcribed from a single audio file so the speakers are mixed together. 
Please separate the text into an array of JSON objects with 'role' (either 'human' or 'user') and 'text' (what they said). 
Return ONLY valid JSON array format, no markdown formatting.
Transcript: "${text}"`;

                  const jsonStr = await llmService.generateDiarization(prompt, aiConfig.model, aiConfig);
                  const cleanJsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
                  parsedTranscript = JSON.parse(cleanJsonStr);
                } catch (e) {
                  console.error('[Transfer] LLM Diarization error:', e.message);
                  parsedTranscript = [{ role: 'human', text: text }];
                }

                const updatedCall = await Call.findById(call._id);
                if (updatedCall) {
                  if (Array.isArray(parsedTranscript)) {
                    parsedTranscript.forEach(t => {
                      updatedCall.transfer_details.human_transcript.push({
                        role: ['human', 'user'].includes(t.role) ? t.role : 'human',
                        text: t.text
                      });
                    });
                  } else {
                    updatedCall.transfer_details.human_transcript.push({ role: 'human', text });
                  }
                  await updatedCall.save();
                }
              }
            } else {
              console.log('[Transfer] Missing required API keys in UserSettings to perform transcription.');
            }
          } catch (transcriptionError) {
            console.error('[Transfer] Async Transfer Transcription Error:', transcriptionError.message);
          }
        })();
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Transfer Status Callback Error:', error);
    res.sendStatus(500);
  }
};

exports.handleTranscriptionCallback = async (req, res) => {
  try {
    const { CallSid, TranscriptionEvent, TranscriptionText, Track } = req.body;

    if (CallSid && TranscriptionText && TranscriptionText.trim()) {
      const call = await Call.findOne({ twilio_call_sid: CallSid });

      if (call && call.is_transferred) {
        const role = Track === 'outbound_track' ? 'human' : 'user';

        call.transfer_details.human_transcript.push({
          role: role,
          text: TranscriptionText
        });

        await call.save();
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Transcription Callback Error:', error);
    res.sendStatus(500);
  }
};

exports.handleRecordingCallback = async (req, res) => {
  try {
    const { CallSid, ParentCallSid, RecordingUrl, RecordingSid, RecordingDuration } = req.body;

    if (CallSid && RecordingUrl) {
      const queryOptions = [CallSid];
      if (ParentCallSid) queryOptions.push(ParentCallSid);

      const call = await Call.findOneAndUpdate(
        { twilio_call_sid: { $in: queryOptions } },
        {
          recording_url: RecordingUrl,
          recording_sid: RecordingSid,
          recording_duration: RecordingDuration ? parseInt(RecordingDuration) : null
        },
        { new: true }
      );

      if (call && RecordingUrl && (!call.transcript || call.transcript.length === 0)) {
        const { processCallTranscription } = require('./transcription.helper');
        processCallTranscription(call._id, RecordingUrl);
      }

      if (call && call.campaign_id) {
        if (CampaignHistory) {
          await CampaignHistory.findOneAndUpdate(
            { campaignId: call.campaign_id, leadPhone: call.to_number },
            { recordingUrl: RecordingUrl },
            { new: true }
          );
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Recording Callback Error:', error);
    res.sendStatus(500);
  }
};

exports.getCallLogs = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 100, search = '', status, direction, sortColumn, sortOrder, prioritizeRestricted } = req.query;

    const query = { user_id: userId };

    if (search) {
      query.$or = [
        { from_number: { $regex: search, $options: 'i' } },
        { to_number: { $regex: search, $options: 'i' } },
        { status: { $regex: search, $options: 'i' } },
        { direction: { $regex: search, $options: 'i' } },
        { lead_name: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) {
      query.status = status;
    }

    if (direction) {
      query.direction = direction;
    }

    let sortObj = {};
    if (prioritizeRestricted === 'true') {
      sortObj.has_restricted_words = -1;
    }
    if (sortColumn) {
      sortObj[sortColumn] = sortOrder === 'asc' ? 1 : -1;
    } else {
      sortObj.created_at = -1;
    }

    const skip = (page - 1) * limit;

    const logs = await Call.find(query)
      .populate('flow_id', 'name')
      .populate('agent_id', 'name')
      .populate('campaign_id', 'name')
      .populate('contact_id', 'first_name last_name phone_number email is_blocked')
      .sort(sortObj)
      .skip(skip)
      .limit(Number(limit));

    const total = await Call.countDocuments(query);

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get Call Logs Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

exports.handleInboundCall = async (req, res) => {
  try {
    if (req.body?.widgetKey || req.query?.widgetKey) {
      const widgetController = require('./widget.controller');
      return widgetController.handleWidgetVoice(req, res);
    }
    const { To, From, CallSid } = req.body;

    const numberRecord = await PhoneNumber.findOne({ phone_number: To }).populate('agent_id');
    if (!numberRecord || !numberRecord.agent_id) {
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this number is not configured for AI assistance.</Say></Response>`;
      res.type('text/xml');
      return res.send(errorTwiml);
    }

    const agent = numberRecord.agent_id;
    const flowId = agent.flow_id || null;
    const agentId = agent._id;
    const userId = agent.user_id;

    const contact = await Contact.findOne({ user_id: userId, phone_number: From });
    if (contact && contact.is_blocked) {
      const blockTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/></Response>`;
      res.type('text/xml');
      return res.send(blockTwiml);
    }

    const callLog = await Call.create({
      user_id: userId,
      flow_id: flowId,
      agent_id: agentId,
      twilio_call_sid: CallSid,
      from_number: From,
      to_number: To,
      status: 'in-progress',
      direction: 'inbound',
      contact_id: contact ? contact._id : null
    });
    webhookDispatcher.dispatchEvent(userId, 'Inbound Call Arrived', callLog);

    const appUrl = process.env.APP_URL.replace('http', 'ws');

    let parametersXml = '';
    if (flowId && flowId !== 'undefined') {
      parametersXml += `<Parameter name="flowId" value="${flowId}" />\n`;
    }
    if (agentId && agentId !== 'undefined') {
      parametersXml += `<Parameter name="agentId" value="${agentId}" />\n`;
    }
    if (userId && userId !== 'undefined') {
      parametersXml += `<Parameter name="userId" value="${userId}" />`;
    }

    if (agent.enable_call_recording) {
      try {
        const userSettings = await UserSettings.findOne({ user: userId });
        if (userSettings && userSettings.twilio_account_sid && userSettings.twilio_auth_token) {
          const client = require('twilio')(userSettings.twilio_account_sid, userSettings.twilio_auth_token);
          client.calls(CallSid).recordings.create({
            recordingStatusCallback: `${process.env.APP_URL}/api/calls/recording-callback`,
            recordingStatusCallbackEvent: ['completed']
          }).catch(err => console.error('Failed to start inbound recording:', err.message));
        }
      } catch (err) {
        console.error('Error initiating inbound recording:', err.message);
      }
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${appUrl}">
            ${parametersXml}
        </Stream>
    </Connect>
</Response>`;

    res.type('text/xml');
    res.send(twiml);
  } catch (error) {
    console.error('Inbound Call Error:', error);
    res.status(500).send('Internal Server Error');
  }
};

exports.getCallRecording = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const call = await Call.findOne({ _id: id, user_id: userId });
    if (!call || !call.recording_url) {
      return res.status(404).json({ success: false, message: 'Recording not found' });
    }

    const settings = await UserSettings.findOne({ user: userId });
    if (!settings || !settings.twilio_account_sid || !settings.twilio_auth_token) {
      return res.status(400).json({ success: false, message: 'Twilio credentials not configured' });
    }

    const recordingUrlMp3 = call.recording_url.endsWith('.mp3') ? call.recording_url : `${call.recording_url}.mp3`;

    const response = await axios({
      method: 'get',
      url: recordingUrlMp3,
      responseType: 'stream',
      auth: {
        username: settings.twilio_account_sid,
        password: settings.twilio_auth_token
      }
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    response.data.pipe(res);
  } catch (error) {
    console.error('Proxy Recording Error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to stream recording' });
  }
};

exports.handlePlivoInboundCall = async (req, res) => {
  try {
    const { To, From, CallUUID } = req.body;

    const numberRecord = await PhoneNumber.findOne({ phone_number: To }).populate('agent_id');
    if (!numberRecord || !numberRecord.agent_id) {
      const errorXml = `<?xml version="1.0" encoding="UTF-8"?><Response><Speak>Sorry, this number is not configured for AI assistance.</Speak></Response>`;
      res.type('text/xml');
      return res.send(errorXml);
    }

    const agent = numberRecord.agent_id;
    const flowId = agent.flow_id || null;
    const agentId = agent._id;
    const userId = agent.user_id;

    const contact = await Contact.findOne({ user_id: userId, phone_number: From });
    if (contact && contact.is_blocked) {
      const blockXml = `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup reason="busy"/></Response>`;
      res.type('text/xml');
      return res.send(blockXml);
    }

    const callLog = await Call.create({
      user_id: userId,
      flow_id: flowId,
      agent_id: agentId,
      twilio_call_sid: CallUUID,
      from_number: From,
      to_number: To,
      status: 'in-progress',
      direction: 'inbound',
      contact_id: contact ? contact._id : null
    });
    webhookDispatcher.dispatchEvent(userId, 'Inbound Call Arrived', callLog);

    const appUrl = process.env.APP_URL.replace('http', 'ws');

    let parametersXml = '';
    if (flowId && flowId !== 'undefined') {
      parametersXml += `<Parameter name="flowId" value="${flowId}" />\n`;
    }
    if (agentId && agentId !== 'undefined') {
      parametersXml += `<Parameter name="agentId" value="${agentId}" />\n`;
    }
    if (userId && userId !== 'undefined') {
      parametersXml += `<Parameter name="userId" value="${userId}" />`;
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream url="${appUrl}" keepCallAlive="true">
        ${parametersXml}
    </Stream>
</Response>`;

    res.type('text/xml');
    res.send(xml);
  } catch (error) {
    console.error('Plivo Inbound Call Error:', error);
    res.status(500).send('Internal Server Error');
  }
};

