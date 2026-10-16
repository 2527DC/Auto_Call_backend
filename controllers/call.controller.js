'use strict';

const { db } = require('../models');
const Call = db.Call;
const UserSettings = db.UserSettings;
const Agent = db.Agent;
const PhoneNumber = db.PhoneNumber;
const Contact = db.Contact;
const Setting = db.Setting;
const { billedMinutes, getModelPricing } = require('../utils/callCost');
const { findContactByPhone, findOrCreateContact } = require('../utils/phone');
const outcomeService = require('../services/outcomeService');
const twilioService = require('../services/twilioService');
const creditService = require('../services/creditService');
const axios = require('axios');
const elevenLabsService = require('../services/elevenlabsService');
const llmService = require('../services/llmService');
const FormData = require('form-data');
const webhookDispatcher = require('../services/webhookDispatcher');
const plivoService = require('../services/plivoService');
const deepgramService = require('../services/deepgramService');
const outboundCallService = require('../services/outboundCallService');

// Starts making the greeting audio while the call is being connected. Loaded
// on first use: the voice service pulls in much of the app.
const prepareGreeting = (args) => require('../services/voiceAutomationService').prepareGreeting(args);

exports.placeCall = async (req, res) => {
  try {
    const { flowId, phoneNumber, fromNumber, agentId } = req.body;
    console.log("🚀 ~ req.body:", req.body)
    const userId = req.user.id;

    if (!flowId || !phoneNumber || !fromNumber) {
      return res.status(400).json({ success: false, message: 'flowId, phoneNumber, and fromNumber are required' });
    }

    const isAdmin = req.user.roleId.name === 'super_admin' || req.user.roleId.name === 'admin';
    let callLog;
    try {
      callLog = await outboundCallService.placeCall({ userId, isAdmin, flowId, agentId, phoneNumber, fromNumber });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, message: err.message });
      throw err;
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
  const { flowId, userId, agentId, dir } = req.query;
  const appUrl = process.env.APP_URL.replace('http', 'ws');

  let parametersXml = '';
  if (dir === 'out') {
    parametersXml += `<Parameter name="direction" value="outbound" />\n`;
  }
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

// Plivo's <Stream> takes the WebSocket URL as its text and passes context as
// "key=value;key=value" extraHeaders (it has no Twilio-style <Parameter> children).
const buildPlivoStreamXml = ({ flowId, agentId, userId, direction = null, record = false, requestUuid = null, callUuid = null }) => {
  const appUrl = process.env.APP_URL.replace('http', 'ws');
  const headers = Object.entries({ flowId, agentId, userId, direction, requestUuid, callUuid })
    .filter(([, value]) => value && value !== 'undefined' && value !== 'null')
    .map(([key, value]) => `${key}=${value}`)
    .join(';');

  // recordSession records the whole call in the background and moves straight
  // on to the stream; Plivo posts RecordUrl to plivo-status when it is ready.
  const recordXml = record
    ? `<Record recordSession="true" redirect="false" maxLength="3600" fileFormat="mp3" callbackUrl="${process.env.APP_URL}/api/calls/plivo-status" callbackMethod="POST" />\n    `
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    ${recordXml}<Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000" extraHeaders="${headers}">${appUrl}</Stream>
</Response>`;
};

exports.generatePlivoXML = async (req, res) => {
  const { flowId, userId, agentId, dir, rec } = req.query;
  const payload = { ...req.query, ...req.body };
  const callUuid = payload.CallUUID || payload.call_uuid;
  const requestUuid = payload.RequestUUID || payload.request_uuid;

  if (requestUuid && callUuid) {
    await Call.updateOne(
      { twilio_call_sid: requestUuid },
      { $set: { twilio_call_sid: callUuid, started_at: new Date(), status: 'in-progress' } }
    ).catch(err => console.error('[Plivo XML] Failed to map CallUUID:', err.message));
  }

  // Calls placed by Voxeno carry the recording choice in the URL, so the answer
  // needs no database round trip; older URLs still look it up.
  let record = rec === '1';
  if (rec === undefined && agentId && db.mongoose.Types.ObjectId.isValid(agentId)) {
    const agent = await Agent.findById(agentId).select('enable_call_recording').lean();
    record = !!agent?.enable_call_recording;
  }

  res.type('text/xml');
  res.send(buildPlivoStreamXml({
    flowId,
    agentId,
    userId,
    record,
    direction: dir === 'out' ? 'outbound' : null,
    requestUuid,
    callUuid
  }));
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

    // What happened on the call (no answer, busy... or the AI's reading of it).
    if (call && isEnded) outcomeService.request(call._id).catch(() => {});

    res.sendStatus(200);
  } catch (error) {
    console.error('Status Callback Error:', error);
    res.sendStatus(500);
  }
};

exports.handlePlivoStatusCallback = async (req, res) => {
  const payload = { ...req.query, ...req.body };
  const CallUUID = payload.CallUUID || payload.call_uuid;
  const RequestUUID = payload.RequestUUID || payload.request_uuid;
  const CallStatus = payload.CallStatus || payload.call_status || payload.status;
  const rawDuration = payload.Duration || payload.duration || payload.CallDuration || payload.call_duration || payload.TotalCallDuration || payload.total_call_duration || payload.BillDuration || payload.bill_duration;
  const RecordUrl = payload.RecordUrl || payload.record_url || payload.RecordingUrl || payload.recording_url;
  const Event = payload.Event || payload.event;
  const HangupCause = payload.HangupCause || payload.hangup_cause;

  try {
    let mappedCallStatus = CallStatus;
    if (CallStatus === 'busy') mappedCallStatus = 'declined';
    if (CallStatus === 'no-answer') mappedCallStatus = 'missed';

    // Handle Plivo Hangup event or cause if CallStatus is in-progress or missing
    if (Event?.toLowerCase() === 'hangup' || HangupCause) {
      if (!mappedCallStatus || mappedCallStatus === 'in-progress') {
        if (HangupCause === 'USER_BUSY' || HangupCause === 'REJECTED') {
          mappedCallStatus = 'declined';
        } else if (HangupCause === 'NO_ANSWER') {
          mappedCallStatus = 'missed';
        } else {
          mappedCallStatus = 'completed';
        }
      }
    }

    const isEnded = ['completed', 'failed', 'busy', 'no-answer', 'canceled', 'declined', 'missed'].includes(mappedCallStatus) ||
      ['completed', 'failed', 'busy', 'no-answer', 'canceled', 'declined', 'missed'].includes(CallStatus) ||
      Event?.toLowerCase() === 'hangup' ||
      Boolean(HangupCause);

    const updateData = {};
    if (mappedCallStatus) updateData.status = mappedCallStatus;
    if (rawDuration !== undefined && rawDuration !== null && rawDuration !== '') {
      updateData.duration = Number(rawDuration);
    }
    if (isEnded) {
      updateData.ended_at = new Date();
      if (!updateData.status || updateData.status === 'in-progress') {
        updateData.status = 'completed';
      }
    }
    if (RecordUrl) updateData.recording_url = RecordUrl;

    let skipStatusEvents = false;
    // Plivo's recording callback arrives after hangup still reporting
    // CallStatus=in-progress; never move a finished call back to a live status.
    const query = {
      $or: [
        ...(CallUUID ? [{ twilio_call_sid: CallUUID }] : []),
        ...(RequestUUID ? [{ twilio_call_sid: RequestUUID }] : [])
      ]
    };

    if (query.$or.length === 0) {
      return res.sendStatus(200);
    }

    if (updateData.status && !isEnded) {
      const existing = await Call.findOne(query).select('status').lean();
      const finalStatuses = ['completed', 'failed', 'busy', 'no-answer', 'canceled', 'declined', 'missed'];
      if (existing && finalStatuses.includes(existing.status)) {
        delete updateData.status;
        skipStatusEvents = true;
      }
    }

    let call = await Call.findOneAndUpdate(
      query,
      updateData,
      { new: true }
    );
    
    if (call && CallUUID && call.twilio_call_sid !== CallUUID) {
      call.twilio_call_sid = CallUUID;
      await call.save();
    }

    if (call && isEnded && (!call.duration || call.duration === 0) && call.started_at) {
      const endTime = call.ended_at ? new Date(call.ended_at).getTime() : Date.now();
      call.duration = Math.max(1, Math.round((endTime - new Date(call.started_at).getTime()) / 1000));
      await call.save();
    }

    if (call && call.user_id && req.app.get('io')) {
      const io = req.app.get('io');
      const statusPayload = {
        callSid: call.twilio_call_sid || CallUUID || RequestUUID,
        callId: String(call._id),
        status: call.status,
        duration: call.duration
      };
      io.emit(`call-status-update-${call.user_id}`, statusPayload);
      io.emit('call-status-update', statusPayload);
    }

    if (call && call.user_id && !skipStatusEvents) {
      const effectiveStatus = call.status || mappedCallStatus || CallStatus;
      if (effectiveStatus === 'completed') {
        webhookDispatcher.dispatchEvent(call.user_id, call.direction === 'inbound' ? 'Inbound Call Finished' : 'Call Finished', call);
      } else if (effectiveStatus === 'failed' || effectiveStatus === 'canceled') {
        webhookDispatcher.dispatchEvent(call.user_id, call.direction === 'inbound' ? 'Inbound Call Unanswered' : 'Call Errored', call);
      } else if (effectiveStatus === 'busy' || effectiveStatus === 'declined') {
        webhookDispatcher.dispatchEvent(call.user_id, 'Number Busy', call);
      } else if (effectiveStatus === 'no-answer' || effectiveStatus === 'missed') {
        webhookDispatcher.dispatchEvent(call.user_id, call.direction === 'inbound' ? 'Inbound Call Unanswered' : 'Unanswered', call);
      } else if (effectiveStatus === 'ringing') {
        webhookDispatcher.dispatchEvent(call.user_id, 'Call Ringing', call);
      } else if (effectiveStatus === 'in-progress') {
        webhookDispatcher.dispatchEvent(call.user_id, call.direction === 'inbound' ? 'Inbound Call Handled' : 'Call Picked Up', call);
      }
    }

    if (call && (CallStatus === 'completed' || mappedCallStatus === 'completed' || call.status === 'completed') && call.user_id) {
      try {
        const callDuration = call.duration || 0;
        const creditResult = await creditService.processCallCreditDeduction(
          call.user_id,
          call._id,
          callDuration
        );
        if (creditResult?.credits_deducted !== undefined) {
          call.credits_used = creditResult.credits_deducted;
          await call.save();
        }
      } catch (creditError) {
        console.error('Credit deduction error:', creditError.message);
      }
    }

    // What happened on the call (no answer, busy... or the AI's reading of it).
    if (call && isEnded) {
      outcomeService.request(call._id).catch((err) => console.error('[Outcome] Request error:', err.message));
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
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Recording Callback Error:', error);
    res.sendStatus(500);
  }
};

const isUserAdmin = (user) => {
  const roleName = user?.roleId?.name || (typeof user?.roleId === 'string' ? user.roleId : null) || user?.role;
  return roleName === 'admin' || roleName === 'super_admin';
};

// Filters shared by the Call Activity list and its export.
const callLogQuery = (req) => {
  const { search = '', status, direction, outcome, reached, sentiment, agent_id, campaign_id, from, to, user_id, client_id } = req.query;
  const isAdmin = isUserAdmin(req.user);
  const query = {};

  if (!isAdmin) {
    query.user_id = req.user.id;
  } else {
    const filterUser = user_id || client_id;
    if (filterUser && filterUser !== 'all') {
      const isOid = db.mongoose.Types.ObjectId.isValid(filterUser);
      query.user_id = isOid ? { $in: [filterUser, new db.mongoose.Types.ObjectId(filterUser)] } : filterUser;
    }
  }

  const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    query.$or = [{ from_number: rx }, { to_number: rx }, { status: rx }, { direction: rx }, { lead_name: rx }, { 'outcome.summary': rx }];
  }
  if (status) {
    // Status callbacks save busy as 'declined' and no-answer as 'missed'.
    const sameAs = { busy: ['busy', 'declined'], 'no-answer': ['no-answer', 'missed'] };
    query.status = sameAs[status] ? { $in: sameAs[status] } : status;
  }
  if (direction) query.direction = direction;
  if (outcome) query['outcome.key'] = outcome === 'none' ? null : outcome;
  if (reached === 'true' || reached === 'false') query['outcome.reached'] = reached === 'true';
  if (sentiment) query['outcome.sentiment'] = sentiment;
  if (agent_id && db.mongoose.Types.ObjectId.isValid(agent_id)) query.agent_id = agent_id;
  if (campaign_id && db.mongoose.Types.ObjectId.isValid(campaign_id)) query.campaign_id = campaign_id;
  if (from || to) {
    query.created_at = {};
    if (from && !Number.isNaN(new Date(from).getTime())) query.created_at.$gte = new Date(from);
    if (to && !Number.isNaN(new Date(to).getTime())) query.created_at.$lte = new Date(to);
  }
  return query;
};

exports.getCallLogs = async (req, res) => {
  try {
    const { page = 1, limit = 100, sortColumn, sortOrder, prioritizeRestricted } = req.query;

    const query = callLogQuery(req);

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
      .populate('user_id', 'name email company phone_number')
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

const contactName = (contact) => [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || undefined;

// A caller who isn't a contact yet is saved as one once the call is answered,
// off the answer path, so their calls, outcome and follow-ups belong to a person.
const linkNewCaller = (callLog, userId, from) => {
  findOrCreateContact(Contact, userId, from, { source: 'inbound_call' })
    .then(contact => contact && Call.updateOne({ _id: callLog._id }, { $set: { contact_id: contact._id } }))
    .catch(err => console.error('Could not save the caller as a contact:', err.message));
};

// Call Activity as a CSV (same filters as the list), with each call's outcome.
exports.exportCallLogs = async (req, res) => {
  try {
    const { toCsv, istDateTime } = require('../utils/csv');
    const isAdmin = isUserAdmin(req.user);
    const calls = await Call.find(callLogQuery(req))
      .sort({ created_at: -1 })
      .limit(10000)
      .populate('user_id', 'name email company')
      .populate('agent_id', 'name')
      .populate('campaign_id', 'name')
      .populate('contact_id', 'first_name last_name')
      .select('-transcript -execution_logs')
      .lean();
    const detailKeys = [...new Set(calls.flatMap(c => Object.keys(c.outcome?.details || {})))];
    const headers = ['Date (IST)'];
    if (isAdmin) headers.push('Client');
    headers.push('Direction', 'Number', 'Name', 'Agent', 'Campaign', 'Status', 'Duration (s)', 'Outcome', 'Summary', 'Sentiment', 'Follow-up', 'Recording', ...detailKeys);
    const rows = [headers];
    for (const c of calls) {
      const name = [c.contact_id?.first_name, c.contact_id?.last_name].filter(Boolean).join(' ') || c.lead_name || '';
      const clientName = c.user_id?.name || c.user_id?.email || '';
      const row = [istDateTime(c.created_at)];
      if (isAdmin) row.push(clientName);
      row.push(
        c.direction, c.direction === 'inbound' ? c.from_number : c.to_number, name,
        c.agent_id?.name || '', c.campaign_id?.name || '', c.status, c.duration || 0,
        c.outcome?.label || '', c.outcome?.summary || '', c.outcome?.sentiment || '', istDateTime(c.outcome?.follow_up?.at),
        c.recording_url || '', ...detailKeys.map(k => c.outcome?.details?.[k])
      );
      rows.push(row);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="calls-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(toCsv(rows));
  } catch (error) {
    console.error('Export Call Logs Error:', error);
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
    prepareGreeting({ agent, flowId, userId });

    const contact = await findContactByPhone(Contact, userId, From);
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
      contact_id: contact ? contact._id : null,
      lead_name: contactName(contact)
    });
    if (!contact) linkNewCaller(callLog, userId, From);
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
    const isAdmin = isUserAdmin(req.user);

    const call = await Call.findOne(isAdmin ? { _id: id } : { _id: id, user_id: userId });
    if (!call || !call.recording_url) {
      return res.status(404).json({ success: false, message: 'Recording not found' });
    }

    // Direct streaming for non-Twilio recordings (Plivo / S3 / public media URLs)
    if (!call.recording_url.includes('api.twilio.com')) {
      try {
        const response = await axios({
          method: 'get',
          url: call.recording_url,
          responseType: 'stream'
        });
        res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');
        return response.data.pipe(res);
      } catch (streamErr) {
        console.warn('Direct stream failed, redirecting to recording_url:', streamErr.message);
        return res.redirect(call.recording_url);
      }
    }

    // Twilio recordings requiring HTTP Basic Auth
    const targetUserId = call.user_id || userId;
    let settings = await UserSettings.findOne({ user: targetUserId });
    if (!settings || !settings.twilio_account_sid || !settings.twilio_auth_token) {
      settings = await UserSettings.findOne({ user: userId });
    }
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

    // Plivo sends numbers without the leading "+", while numbers are stored in E.164.
    const numberVariants = (value) => {
      const digits = String(value || '').replace(/^\+/, '');
      return [digits, `+${digits}`];
    };

    const numberRecord = await PhoneNumber.findOne({ phone_number: { $in: numberVariants(To) } }).populate('agent_id');
    if (!numberRecord || !numberRecord.agent_id) {
      const errorXml = `<?xml version="1.0" encoding="UTF-8"?><Response><Speak>Sorry, this number is not configured for AI assistance.</Speak></Response>`;
      res.type('text/xml');
      return res.send(errorXml);
    }

    const agent = numberRecord.agent_id;
    const flowId = agent.flow_id || null;
    const agentId = agent._id;
    const userId = agent.user_id;
    prepareGreeting({ agent, flowId, userId });

    const contact = await findContactByPhone(Contact, userId, From);
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
      contact_id: contact ? contact._id : null,
      lead_name: contactName(contact)
    });
    if (!contact) linkNewCaller(callLog, userId, From);
    webhookDispatcher.dispatchEvent(userId, 'Inbound Call Arrived', callLog);

    res.type('text/xml');
    res.send(buildPlivoStreamXml({ flowId, agentId, userId, record: !!agent.enable_call_recording }));
  } catch (error) {
    console.error('Plivo Inbound Call Error:', error);
    res.status(500).send('Internal Server Error');
  }
};

exports.generatePlivoTransferXML = async (req, res) => {
  try {
    const to = req.query.to || req.body?.to;
    const from = req.query.from || req.body?.from;
    const actionUrl = `${process.env.APP_URL}/api/calls/plivo-status`;
    const callerIdAttr = from ? ` callerId="${from}"` : '';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial action="${actionUrl}" method="POST"${callerIdAttr}>
        <Number>${to}</Number>
    </Dial>
</Response>`;
    res.type('text/xml');
    res.send(xml);
  } catch (err) {
    console.error('Error generating Plivo transfer XML:', err);
    res.status(500).send('Internal Server Error');
  }
};

// GET /api/calls/logs/:id/cost
// Admin-only breakdown of total cost, telephony charges, STT, TTS, and LLM reasoning.
exports.getCallCostBreakdown = async (req, res) => {
  try {
    const isAdmin = req.user?.roleId?.name === 'super_admin' || req.user?.roleId?.name === 'admin';
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Only administrators can view per-call cost breakdown' });
    }

    const { id } = req.params;
    const call = await Call.findById(id)
      .populate('user_id', 'name email')
      .populate({
        path: 'agent_id',
        select: 'name voice_provider llm_model telephony_provider',
        populate: { path: 'llm_model', select: 'name display_name provider model_id' }
      })
      .populate('campaign_id', 'name')
      .lean();

    if (!call) {
      return res.status(404).json({ success: false, message: 'Call not found' });
    }

    const rates = (await Setting.findOne()) || {};

    const callDuration = call.duration || 0;
    const rawModel = call.usage?.llm_model || call.agent_id?.llm_model?.model_id || 'gpt-4o-mini';
    const llmProvider = call.usage?.llm_provider || call.agent_id?.llm_model?.provider || 'openai';
    const sttProvider = call.usage?.stt_provider || call.agent_id?.voice_provider || 'deepgram';
    const ttsProvider = call.usage?.tts_provider || call.agent_id?.voice_provider || 'deepgram';

    const rawTelProv = (call.usage?.telephony_provider || call.agent_id?.telephony_provider || 'plivo').toLowerCase();
    let normTelProv = 'plivo';
    if (rawTelProv.includes('twilio')) {
      normTelProv = 'twilio';
    } else if (rawTelProv.includes('sip')) {
      normTelProv = 'sip';
    } else if (rawTelProv.includes('whatsapp')) {
      normTelProv = 'meta_whatsapp';
    } else {
      normTelProv = 'plivo';
    }

    const inTokens = call.usage?.llm_input_tokens || 0;
    const outTokens = call.usage?.llm_output_tokens || 0;
    const totalTokens = inTokens + outTokens;
    const sttSec = call.usage?.stt_seconds || 0;
    const ttsChars = call.usage?.tts_characters || 0;

    // Pricing rates
    const pricing = getModelPricing(rawModel, rates);
    const costLlmInput = (inTokens / 1e6) * pricing.inputPer1M;
    const costLlmOutput = (outTokens / 1e6) * pricing.outputPer1M;
    const costLlm = costLlmInput + costLlmOutput;

    const sttRatePerMin = rates[`cost_stt_per_minute_${sttProvider}`] || (sttProvider === 'sarvam_ai' ? 0.5 : 0.42);
    const costStt = (sttSec / 60) * sttRatePerMin;

    const ttsRatePer1k = rates[`cost_tts_per_1k_chars_${ttsProvider}`] || (ttsProvider === 'elevenlabs' ? 3.88 : (ttsProvider === 'sarvam_ai' ? 3.0 : 1.46));
    const costTts = (ttsChars / 1000) * ttsRatePer1k;

    const telBilledMins = billedMinutes(callDuration, normTelProv);
    const telRatePerMin = normTelProv === 'twilio'
      ? (rates.cost_telephony_per_minute_twilio || 1.10)
      : (normTelProv === 'sip'
        ? (rates.cost_telephony_per_minute_sip || 0.20)
        : (normTelProv === 'meta_whatsapp'
          ? (rates.cost_whatsapp_per_minute || 0.30)
          : (rates.cost_telephony_per_minute || 0.38)));
    const costTelephony = telBilledMins * telRatePerMin;

    const totalCost = costTelephony + costLlm + costStt + costTts;

    // Determine the phone numbers
    const inbound = call.direction === 'inbound';
    const clientNumber = inbound ? call.from_number : call.to_number;
    const appNumber = inbound ? call.to_number : call.from_number;

    res.json({
      success: true,
      data: {
        call_id: String(call._id),
        created_at: call.created_at,
        client: {
          id: call.user_id ? String(call.user_id._id || call.user_id) : null,
          name: call.user_id?.name || 'Unknown Client',
          email: call.user_id?.email || '',
        },
        agent: {
          id: call.agent_id ? String(call.agent_id._id || call.agent_id) : null,
          name: call.agent_id?.name || 'Direct / Flow Call',
        },
        routing: {
          direction: call.direction || 'outbound',
          client_number: clientNumber,
          app_number: appNumber,
          telephony_provider: normTelProv === 'plivo' ? 'Plivo' : (normTelProv === 'twilio' ? 'Twilio' : (normTelProv === 'sip' ? 'SIP Trunk' : 'Meta WhatsApp')),
        },
        duration: {
          seconds: callDuration,
          formatted: `${Math.floor(callDuration / 60)}m ${callDuration % 60}s`,
          billed_minutes: telBilledMins,
          billing_increment: normTelProv === 'plivo' ? '30-second increment' : '60-second increment',
        },
        credits_used: call.credits_used || 0,
        total_cost: Math.round(totalCost * 100) / 100,
        total_ai_cost: Math.round((costLlm + costStt + costTts) * 100) / 100,
        currency: 'INR (₹)',
        breakdown: {
          telephony: {
            provider: normTelProv === 'plivo' ? 'Plivo' : (normTelProv === 'twilio' ? 'Twilio' : (normTelProv === 'sip' ? 'SIP Trunk' : 'Meta WhatsApp')),
            billed_minutes: telBilledMins,
            rate_per_minute: telRatePerMin,
            cost: Math.round(costTelephony * 100) / 100,
            percent: totalCost > 0 ? Math.round((costTelephony / totalCost) * 100) : 0,
          },
          llm: {
            provider: llmProvider,
            model: rawModel,
            input_tokens: inTokens,
            output_tokens: outTokens,
            total_tokens: totalTokens,
            rate_input_1m: pricing.inputPer1M,
            rate_output_1m: pricing.outputPer1M,
            cost: Math.round(costLlm * 100) / 100,
            percent: totalCost > 0 ? Math.round((costLlm / totalCost) * 100) : 0,
          },
          stt: {
            provider: sttProvider,
            seconds: Math.round(sttSec * 100) / 100,
            rate_per_minute: sttRatePerMin,
            cost: Math.round(costStt * 100) / 100,
            percent: totalCost > 0 ? Math.round((costStt / totalCost) * 100) : 0,
          },
          tts: {
            provider: ttsProvider,
            characters: ttsChars,
            rate_per_1k: ttsRatePer1k,
            cost: Math.round(costTts * 100) / 100,
            percent: totalCost > 0 ? Math.round((costTts / totalCost) * 100) : 0,
          },
        },
      },
    });
  } catch (error) {
    console.error('Get call cost breakdown error:', error);
    res.status(500).json({ success: false, message: 'Failed to calculate call cost breakdown' });
  }
};

