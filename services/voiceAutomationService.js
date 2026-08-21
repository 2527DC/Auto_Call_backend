'use strict';

const EventEmitter = require('events');
const automationEngine = require('../utils/automationEngine');
const elevenLabsService = require('./elevenlabsService');
const deepgramService = require('./deepgramService');
const sarvamService = require('./sarvamService');
const appointmentService = require('./appointmentService');
const twilio = require('twilio');
const { db } = require('../models');
const Call = db.Call;
const Flow = db.Flow;
const Agent = db.Agent;
const Setting = db.Setting;
const UserSettings = db.UserSettings;
const Appointment = db.Appointment;
const Form = db.Form;
const FormResponse = db.FormResponse;
const AppointmentSetting = db.AppointmentSetting;
const GoogleAccount = db.GoogleAccount;
const ViolenceWord = db.ViolenceWord;
const axios = require('axios');
const whatsappService = require('./whatsappService');
const emailService = require('./emailService');
const llmService = require('./llmService');
const { decrypt } = require('../utils/encryption-utils');

class VoiceAutomationService extends EventEmitter {
  constructor() {
    super();
    this.activeStreams = new Map();
    this.twilioClient = null;
  }

  async getTwilioClient(userId) {
    if (!userId) return null;

    const settings = await UserSettings.findOne({ user: userId });
    const accountSid = settings?.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID;
    const authToken = settings?.twilio_auth_token || process.env.TWILIO_AUTH_TOKEN;

    if (accountSid && authToken) {
      return twilio(accountSid, authToken);
    }
    return null;
  }

  handleMediaStream(ws) {
    let callSid = null;
    let streamSid = null;
    let flowId = null;
    let agentId = null;
    let userId = null;

    ws.on('message', async (message) => {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          const customData = msg.start.customParameters || {};
          flowId = customData.flowId && customData.flowId !== 'undefined' && customData.flowId !== 'null' ? customData.flowId : null;
          agentId = customData.agentId && customData.agentId !== 'undefined' && customData.agentId !== 'null' ? customData.agentId : null;
          userId = customData.userId && customData.userId !== 'undefined' && customData.userId !== 'null' ? customData.userId : null;

          this.activeStreams.set(streamSid, {
            callSid,
            flowId,
            agentId,
            userId,
            audioBuffer: [],
            lastProcessedAt: Date.now(),
            currentNodeId: null,
            isSpeaking: false,
            silenceCount: 0,
            conversationHistory: [],
            callStartTime: Date.now()
          });

          console.log(`Stream started: CallSid=${callSid}, FlowId=${flowId}, AgentId=${agentId}, UserId=${userId}`);
          try {
            const callLog = await Call.findOne({ twilio_call_sid: callSid });
            const userSettings = (userId && db.mongoose.Types.ObjectId.isValid(userId)) ? await UserSettings.findOne({ user: userId }).populate('ai_model') : null;

            if (flowId && db.mongoose.Types.ObjectId.isValid(flowId)) {
              const flow = await Flow.findById(flowId);
              const agent = await Agent.findOne({ flow_id: flowId }).populate('llm_model', 'model_id provider name');

              if (flow && callLog) {
                const aiConfig = userSettings?.ai_model ? {
                  model: userSettings.ai_model.model_id,
                  apiKey: userSettings.ai_api_key,
                  provider: userSettings.ai_model.provider
                } : null;

                const startNodeId = customData.startNodeId || null;
                const isReturningFromSay = customData.isReturningFromSay === 'true';

                if (isReturningFromSay) {
                  const stream = this.activeStreams.get(streamSid);
                  if (stream) {
                    stream.currentNodeId = startNodeId;
                  }
                  console.log(`[Stream] Reconnected after TwiML <Say>. Waiting for user input at node: ${startNodeId}`);
                  return;
                }

                const result = await automationEngine.executeFlowSync(
                  flow,
                  {
                    agent,
                    aiConfig,
                    userId,
                    call: callLog,
                    appointment_details: callLog.extracted_data?.appointment_details || {},
                    form_responses: callLog.extracted_data?.form_responses || {},
                    current_field_index: callLog.extracted_data?.current_field_index || 0,
                    form_id: callLog.extracted_data?.form_id || null,
                    ...(callLog.extracted_data || {})
                  },
                  startNodeId
                );

                const messages = result.logs.filter(l => l.output && l.output.last_message).map(l => l.output.last_message);
                const fullMessage = messages.join(' ');

                const stream = this.activeStreams.get(streamSid);
                if (stream) {
                  stream.currentNodeId = result.currentNodeId;
                }

                callLog.execution_logs.push(...result.logs.map(l => ({
                  node_id: l.node_id,
                  node_type: l.node_type
                })));

                if (agent?.enable_call_transcription) {
                  callLog.transcript.push({ role: 'agent', text: fullMessage });
                }

                if (result.final_data) {
                  const { agent, aiConfig, userId, call, ...cleanFinalData } = result.final_data;
                  callLog.extracted_data = {
                    ...(callLog.extracted_data || {}),
                    ...cleanFinalData
                  };
                }
                await callLog.save();

                const redirectLog = result.logs.find(l => l.node_type === 'redirect_call');
                if (redirectLog && redirectLog.output?.transfer_to) {
                  const transferNum = redirectLog.output.transfer_to;
                  console.log(`[Flow Start] Redirect call triggered to: ${transferNum}`);
                  if (redirectLog.output.transfer_text) {
                    await this.speak(ws, streamSid, redirectLog.output.transfer_text, flow.nodes[0]?.data?.voice_id || null, userSettings?.elevenlabs_api_key);
                  } else {
                    await this.speak(ws, streamSid, "Please hold while I transfer your call.", flow.nodes[0]?.data?.voice_id || null, userSettings?.elevenlabs_api_key);
                  }
                  const actionUrl = process.env.APP_URL ? `${process.env.APP_URL}/api/calls/transfer-status` : '';
                  const recordAttribute = (agent?.enable_call_recording || agent?.enable_call_transcription) ? ' record="record-from-answer-dual"' : '';
                  const client = await this.getTwilioClient(userId);
                  if (client && callSid) {
                    try {
                      if (userSettings?.elevenlabs_api_key) {
                        const streamObj = this.activeStreams.get(streamSid);
                        if (streamObj) {
                          streamObj.pendingTransfer = transferNum;
                          streamObj.pendingTransferRecordAttribute = recordAttribute;
                        }
                      } else {
                        await client.calls(callSid).update({
                          twiml: `<Response><Dial action="${actionUrl}"${recordAttribute}>${transferNum}</Dial></Response>`
                        });
                      }

                      callLog.is_transferred = true;
                      callLog.transfer_details = {
                        ...(callLog.transfer_details || {}),
                        transferred_at: new Date(),
                        human_call_status: 'initiated'
                      };
                      if (redirectLog.output?.member_id) {
                        callLog.transfer_member_id = redirectLog.output.member_id;
                      }
                      await callLog.save();

                      return;
                    } catch (err) {
                      console.error('Error transferring call in flow start:', err.message);
                    }
                  }
                }

                const playAudioUrl = result.logs.filter(l => l.output && l.output.play_audio).map(l => l.output.play_audio)[0];
                const terminateLog = result.logs.find(l => l.node_type === 'terminate_call');
                if (playAudioUrl) {
                  const client = await this.getTwilioClient(userId);
                  if (client) {
                    const appUrl = process.env.APP_URL ? process.env.APP_URL.replace('http', 'ws') : 'wss://domain.com';
                    const httpUrl = process.env.APP_URL || 'https://domain.com';
                    const absoluteAudioUrl = playAudioUrl.startsWith('http') ? playAudioUrl : `${httpUrl}/${playAudioUrl.replace(/^\/+/, '')}`;
                    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Play>${absoluteAudioUrl}</Play>
    <Connect>
        <Stream url="${appUrl}">
            <Parameter name="flowId" value="${flowId}" />
            <Parameter name="userId" value="${userId}" />
            <Parameter name="startNodeId" value="${result.currentNodeId}" />
        </Stream>
    </Connect>
</Response>`;
                    await client.calls(callSid).update({ twiml });
                  }
                } else if (fullMessage && fullMessage.trim()) {
                  if (terminateLog) {
                    const streamObj = this.activeStreams.get(streamSid);
                    if (streamObj) streamObj.pendingTerminate = true;
                  }
                  await this.speak(ws, streamSid, fullMessage, flow.nodes[0]?.data?.voice_id, userSettings?.elevenlabs_api_key);
                } else if (terminateLog) {
                  const client = await this.getTwilioClient(userId);
                  if (client && callSid) {
                    try {
                      await client.calls(callSid).update({ status: 'completed' });
                    } catch (e) {
                      console.error('Error terminating call immediately on start:', e.message);
                    }
                  }
                }
              }
            } else if (agentId && db.mongoose.Types.ObjectId.isValid(agentId)) {
              const agent = await Agent.findById(agentId).populate('llm_model', 'model_id provider name');

              if (agent && callLog) {
                const greeting = agent.first_message || `Hello! I'm ${agent.name}. How can I help you today?`;
                const stream = this.activeStreams.get(streamSid);
                if (stream) {
                  stream.conversationHistory = [
                    { role: 'assistant', text: greeting }
                  ];
                }
                if (agent?.enable_call_transcription) {
                  callLog.transcript.push({ role: 'agent', text: greeting });
                }
                await callLog.save();
                await this.speak(ws, streamSid, greeting, agent.voice_id, userSettings?.elevenlabs_api_key);
              }
            }
          } catch (err) {
            console.error('Error starting stream:', err);
          }
          break;

        case 'media':
          const stream = this.activeStreams.get(streamSid);
          if (stream) {
            const chunk = Buffer.from(msg.media.payload, 'base64');
            const rms = this.calculateUlawRMS(chunk);

            const SPEECH_THRESHOLD = 800;
            const SILENCE_THRESHOLD = 500;

            if (rms > SPEECH_THRESHOLD) {
              stream.isSpeaking = true;
              stream.silenceCount = 0;
            } else if (stream.isSpeaking) {
              stream.silenceCount++;
            }

            stream.audioBuffer.push(chunk);

            if (!stream.isSpeaking && stream.audioBuffer.length > 20) {
              stream.audioBuffer.shift();
            }

            if (stream.isSpeaking && stream.silenceCount >= 60) {
              const fullBuffer = Buffer.concat(stream.audioBuffer);
              stream.audioBuffer = [];
              stream.isSpeaking = false;
              stream.silenceCount = 0;

              this.handleCompleteSpeech(streamSid, ws, fullBuffer).catch(err => console.error(err));
            }

            if (stream.audioBuffer.length >= 750) {
              const fullBuffer = Buffer.concat(stream.audioBuffer);
              stream.audioBuffer = [];
              stream.isSpeaking = false;
              stream.silenceCount = 0;

              this.handleCompleteSpeech(streamSid, ws, fullBuffer).catch(err => console.error(err));
            }
          }
          break;

        case 'mark':
          const streamForMark = this.activeStreams.get(streamSid);
          if (streamForMark && streamForMark.pendingTransfer) {
            console.log(`[Flow] Speech completed, executing pending transfer to: ${streamForMark.pendingTransfer}`);
            const client = await this.getTwilioClient(streamForMark.userId);
            if (client && streamForMark.callSid) {
              try {
                const actionUrl = process.env.APP_URL ? `${process.env.APP_URL}/api/calls/transfer-status` : '';
                await client.calls(streamForMark.callSid).update({
                  twiml: `<Response><Dial action="${actionUrl}"${streamForMark.pendingTransferRecordAttribute || ''}>${streamForMark.pendingTransfer}</Dial></Response>`
                });
                streamForMark.pendingTransfer = null;
              } catch (err) {
                console.error('Error transferring call after mark:', err.message);
              }
            }
          } else if (streamForMark && streamForMark.pendingTerminate) {
            console.log(`[Flow] Speech completed, terminating call gracefully.`);
            const client = await this.getTwilioClient(streamForMark.userId);
            if (client && streamForMark.callSid) {
              try {
                await client.calls(streamForMark.callSid).update({ status: 'completed' });
                streamForMark.pendingTerminate = false;
              } catch (err) {
                console.error('Error terminating call after mark:', err.message);
              }
            }
          }
          break;

        case 'stop':
          const closingStream = this.activeStreams.get(streamSid);
          if (closingStream && closingStream.callSid) {
            this.handlePostCallIntegrations(closingStream.callSid, closingStream.userId);
          }
          this.activeStreams.delete(streamSid);
          console.log(`Stream stopped: ${streamSid}`);
          break;
      }
    });

    ws.on('close', () => {
      console.log('Twilio Media Stream WebSocket closed');
    });

    ws.on('error', (err) => {
      console.error('Twilio Media Stream WebSocket error:', err.message);
    });
  }

  async handleCompleteSpeech(streamSid, ws, audioBuffer) {
    const stream = this.activeStreams.get(streamSid);
    if (!stream) return;

    const text = await this.processSTT(audioBuffer, stream.userId, stream.agentId, stream.flowId);
    if (!text || !text.trim()) return;

    console.log(`Processing complete sentence: "${text}"`);

    let currentAgentForChecks = null;
    if (stream.agentId) {
      currentAgentForChecks = await Agent.findById(stream.agentId);
    } else if (stream.flowId) {
      currentAgentForChecks = await Agent.findOne({ flow_id: stream.flowId });
    }

    let earlyUserSettings = null;

    if (currentAgentForChecks) {
      if (currentAgentForChecks.max_call_duration && stream.callStartTime) {
        const elapsedSeconds = Math.floor((Date.now() - stream.callStartTime) / 1000);
        if (elapsedSeconds >= currentAgentForChecks.max_call_duration) {
          console.log(`Max call duration reached (${currentAgentForChecks.max_call_duration}s). Terminating call.`);

          let goodbyeMessage = "Thank you for your time. Goodbye!";
          if (currentAgentForChecks.goodbye_message) {
            goodbyeMessage = currentAgentForChecks.goodbye_message;
          }

          earlyUserSettings = await UserSettings.findOne({ user: stream.userId });
          await this.speak(ws, streamSid, goodbyeMessage, currentAgentForChecks.voice_id || null, earlyUserSettings?.elevenlabs_api_key);

          const client = await this.getTwilioClient(stream.userId);
          if (client && stream.callSid) {
            try {
              await client.calls(stream.callSid).update({ status: 'completed' });
            } catch (err) {
              console.error('Error terminating call due to max duration:', err.message);
            }
          }
          return;
        }
      }
    }

    const hangupKeywords = ['hang up', 'cut the call', 'goodbye', 'bye', 'end the call', 'stop the call', '[phone hangs up]', '[phone hanging up]', '[phone clicks]', 'cut', 'stop', 'hangup'];
    const isHangup = hangupKeywords.some(k => text.toLowerCase().includes(k.toLowerCase()));

    if (currentAgentForChecks) {
      if (currentAgentForChecks.transfer_to_human?.enabled && currentAgentForChecks.transfer_to_human?.transfer_keywords?.length > 0) {
        const transferKeywords = currentAgentForChecks.transfer_to_human.transfer_keywords.map(k => k.toLowerCase().trim());
        const isTransfer = transferKeywords.some(k => text.toLowerCase().includes(k));

        if (isTransfer && currentAgentForChecks.transfer_to_human?.member_id) {
          console.log('Transfer to human triggered. Transferring call.');

          const member = await db.TeamMember.findById(currentAgentForChecks.transfer_to_human.member_id);
          if (!member || !member.phone_number) {
            console.error('Transfer failed: Invalid team member or no phone number found');
            return;
          }
          const transferNumber = member.phone_number;

          const client = await this.getTwilioClient(stream.userId);
          if (client && stream.callSid) {
            try {
              const actionUrl = process.env.APP_URL ? `${process.env.APP_URL}/api/calls/transfer-status` : '';
              const recordAttribute = (currentAgentForChecks?.enable_call_recording || currentAgentForChecks?.enable_call_transcription) ? ' record="record-from-answer-dual"' : '';
              
              if (earlyUserSettings?.elevenlabs_api_key) {
                await this.speak(ws, streamSid, "Please hold while I transfer you to a human agent.", currentAgentForChecks.voice_id || null, earlyUserSettings.elevenlabs_api_key);
                stream.pendingTransfer = transferNumber;
                stream.pendingTransferRecordAttribute = recordAttribute;
              } else {
                const transferTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">Please hold while I transfer you to a human agent.</Say>
    <Dial action="${actionUrl}"${recordAttribute}>${transferNumber}</Dial>
</Response>`;

                await client.calls(stream.callSid).update({
                  twiml: transferTwiml
                });
              }

              try {
                const callLog = await Call.findOne({ twilio_call_sid: stream.callSid });
                if (callLog) {
                  callLog.is_transferred = true;
                  if (currentAgentForChecks.transfer_to_human.member_id) {
                    callLog.transfer_member_id = currentAgentForChecks.transfer_to_human.member_id;
                  }
                  callLog.transfer_details = {
                    ...(callLog.transfer_details || {}),
                    transferred_at: new Date(),
                    human_call_status: 'initiated'
                  };
                  await callLog.save();
                }
              } catch (e) {
                console.error('Error saving transfer data to call log:', e.message);
              }
              return;
            } catch (err) {
              console.error('Error transferring call:', err.message);
            }
          }
        }
      }
    }

    if (isHangup) {
      console.log('Hangup cue detected. Ending call via Twilio API.');

      let goodbyeMessage = "Goodbye! Thank you for calling.";
      if (currentAgentForChecks?.goodbye_message) {
        goodbyeMessage = currentAgentForChecks.goodbye_message;
      }

      if (!earlyUserSettings) {
        earlyUserSettings = await UserSettings.findOne({ user: stream.userId });
      }
      await this.speak(ws, streamSid, goodbyeMessage, currentAgentForChecks?.voice_id || null, earlyUserSettings?.elevenlabs_api_key);

      const client = await this.getTwilioClient(stream.userId);
      if (client && stream.callSid) {
        try {
          await client.calls(stream.callSid).update({ status: 'completed' });
        } catch (err) {
          console.error('Error hanging up call:', err.message);
        }
      }
      return;
    }

    try {
      const currentCallLog = await Call.findOne({ twilio_call_sid: stream.callSid });
      const userSettings = await UserSettings.findOne({ user: stream.userId }).populate('ai_model');
      const aiConfig = userSettings?.ai_model ? {
        model: userSettings.ai_model.model_id,
        apiKey: userSettings.ai_api_key,
        provider: userSettings.ai_model.provider
      } : null;

      if (!currentCallLog) return;
      
      const violenceWords = await ViolenceWord.find({ is_active: true });
      if (violenceWords.length > 0) {
        const textLower = text.toLowerCase();
        const detectedWords = violenceWords
          .filter(vw => textLower.includes(vw.word.toLowerCase()))
          .map(vw => vw.word);
          
        if (detectedWords.length > 0) {
          currentCallLog.detected_words = [...new Set([...(currentCallLog.detected_words || []), ...detectedWords])];
          if (currentCallLog.transcript_snippet) {
            currentCallLog.transcript_snippet += ` | ${text}`;
          } else {
            currentCallLog.transcript_snippet = text;
          }
          await currentCallLog.save();
        }
      }

      if (stream.agentId) {
        const agent = await Agent.findById(stream.agentId);
        if (agent?.enable_call_transcription !== false) {
          if (currentAgentForChecks?.enable_call_transcription) {
            currentCallLog.transcript.push({ role: 'user', text: text });
          }
        }
      } else if (stream.flowId) {
        const agent = await Agent.findOne({ flow_id: stream.flowId });
        if (!agent || agent?.enable_call_transcription !== false) {
          if (currentAgent?.enable_call_transcription) {
            currentCallLog.transcript.push({ role: 'user', text: text });
          }
        }
      }
      await currentCallLog.save();

      if (stream.flowId) {
        const currentFlow = await Flow.findById(stream.flowId);
        const currentAgent = await Agent.findOne({ flow_id: stream.flowId }).populate('llm_model', 'model_id provider name');

        if (currentFlow) {
          const result = await automationEngine.executeFlowSync(
            currentFlow,
            {
              user_input: text,
              agent: currentAgent,
              aiConfig,
              userId: stream.userId,
              call: currentCallLog,
              appointment_details: currentCallLog.extracted_data?.appointment_details || {},
              form_responses: currentCallLog.extracted_data?.form_responses || {},
              current_field_index: currentCallLog.extracted_data?.current_field_index || 0,
              form_id: currentCallLog.extracted_data?.form_id || null
            },
            stream.currentNodeId
          );

          stream.currentNodeId = result.currentNodeId;

          const messages = result.logs.filter(l => l.output && l.output.last_message).map(l => l.output.last_message);
          const nextResponse = messages.join(' ');

          const redirectLog = result.logs.find(l => l.node_type === 'redirect_call');
          if (redirectLog && redirectLog.output?.transfer_to) {
            const transferNum = redirectLog.output.transfer_to;
            console.log(`[Flow] Redirect call triggered to: ${transferNum}`);
            if (redirectLog.output.transfer_text) {
              await this.speak(ws, streamSid, redirectLog.output.transfer_text, currentAgent?.voice_id || null, userSettings?.elevenlabs_api_key);
            } else {
              await this.speak(ws, streamSid, "Please hold while I transfer your call.", currentAgent?.voice_id || null, userSettings?.elevenlabs_api_key);
            }
            const client = await this.getTwilioClient(stream.userId);
            if (client && stream.callSid) {
              try {
                const actionUrl = process.env.APP_URL ? `${process.env.APP_URL}/api/calls/transfer-status` : '';
                const recordAttribute = (currentAgent?.enable_call_recording || currentAgent?.enable_call_transcription) ? ' record="record-from-answer-dual"' : '';
                
                if (userSettings?.elevenlabs_api_key) {
                  stream.pendingTransfer = transferNum;
                  stream.pendingTransferRecordAttribute = recordAttribute;
                } else {
                  await client.calls(stream.callSid).update({
                    twiml: `<Response><Dial action="${actionUrl}"${recordAttribute}>${transferNum}</Dial></Response>`
                  });
                }

                try {
                  const callLog = await Call.findOne({ twilio_call_sid: stream.callSid });
                  if (callLog) {
                    callLog.is_transferred = true;
                    if (redirectLog.output?.member_id) {
                      callLog.transfer_member_id = redirectLog.output.member_id;
                    } else if (currentAgent?.transfer_to_human?.member_id) {
                      callLog.transfer_member_id = currentAgent.transfer_to_human.member_id;
                    }
                    callLog.transfer_details = {
                      ...(callLog.transfer_details || {}),
                      transferred_at: new Date(),
                      human_call_status: 'initiated'
                    };
                    await callLog.save();
                  }
                } catch (e) {
                  console.error('Error saving transfer data to call log:', e.message);
                }

                return;
              } catch (err) {
                console.error('Error transferring call in flow:', err.message);
              }
            }
          }

          const playAudioUrl = result.logs.filter(l => l.output && l.output.play_audio).map(l => l.output.play_audio)[0];
          const terminateLog = result.logs.find(l => l.node_type === 'terminate_call');

          if (playAudioUrl) {
            const client = await this.getTwilioClient(stream.userId);
            if (client) {
              const appUrl = process.env.APP_URL ? process.env.APP_URL.replace('http', 'ws') : 'wss://domain.com';
              const httpUrl = process.env.APP_URL || 'https://domain.com';
              const absoluteAudioUrl = playAudioUrl.startsWith('http') ? playAudioUrl : `${httpUrl}/${playAudioUrl.replace(/^\/+/, '')}`;
              const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Play>${absoluteAudioUrl}</Play>
    <Connect>
        <Stream url="${appUrl}">
            <Parameter name="flowId" value="${stream.flowId}" />
            <Parameter name="userId" value="${stream.userId}" />
            <Parameter name="startNodeId" value="${result.currentNodeId}" />
        </Stream>
    </Connect>
</Response>`;
              await client.calls(stream.callSid).update({ twiml });
            }
          } else if (nextResponse && nextResponse.trim()) {
            if (terminateLog) {
              stream.pendingTerminate = true;
            }
            await this.speak(ws, streamSid, nextResponse, null, userSettings?.elevenlabs_api_key);
            if (currentAgent?.enable_call_transcription) {
              currentCallLog.transcript.push({ role: 'agent', text: nextResponse });
            }
          } else if (terminateLog) {
            const client = await this.getTwilioClient(stream.userId);
            if (client && stream.callSid) {
              try {
                await client.calls(stream.callSid).update({ status: 'completed' });
              } catch (e) {
                console.error('Error terminating call immediately:', e.message);
              }
            }
          }

          if (result.final_data) {
            const { agent, aiConfig, userId, call, user_input, ...cleanFinalData } = result.final_data;
            currentCallLog.extracted_data = {
              ...(currentCallLog.extracted_data || {}),
              ...cleanFinalData
            };
          }
          await currentCallLog.save();
        }
      } else if (stream.agentId) {
        const currentAgent = await Agent.findById(stream.agentId).populate('llm_model', 'model_id provider name');

        if (currentAgent) {
          if (!stream.conversationHistory) stream.conversationHistory = [];
          stream.conversationHistory.push({ role: 'user', text });

          const conversationContext = stream.conversationHistory
            .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
            .join('\n');

          const fullPrompt = `Conversation so far:\n${conversationContext}\n\nUser: ${text}`;

          let systemPrompt = currentAgent.system_prompt || currentAgent.personality || '';
          if (currentAgent.custom_knowledge_base) {
            systemPrompt += `\n\nADDITIONAL KNOWLEDGE BASE:\n${currentAgent.custom_knowledge_base}`;
          }

          const nextResponse = await llmService.generateResponseWithSystemPrompt(
            fullPrompt,
            systemPrompt,
            aiConfig?.model || currentAgent.llm_model?.model_id,
            aiConfig,
            {
              empathy_level: currentAgent.empathy_level,
              energy_level: currentAgent.energy_level,
              response_length: currentAgent.response_length,
              intelligence_level: currentAgent.intelligence_level
            }
          );

          if (nextResponse && nextResponse.trim()) {
            stream.conversationHistory.push({ role: 'assistant', text: nextResponse });
            await this.speak(ws, streamSid, nextResponse, currentAgent.voice_id, userSettings?.elevenlabs_api_key);

            if (currentAgent.enable_call_transcription !== false) {
              if (currentAgent?.enable_call_transcription) {
                currentCallLog.transcript.push({ role: 'agent', text: nextResponse });
              }
              await currentCallLog.save();
            }
          }
        }
      }
    } catch (err) {
      console.error('Error handling complete speech:', err);
    }
  }

  async processSTT(buffer, userId, agentId = null, flowId = null) {
    try {
      const validUserId = (userId && userId !== 'undefined' && userId !== 'null' && db.mongoose.Types.ObjectId.isValid(userId)) ? userId : null;
      const userSettings = validUserId ? await UserSettings.findOne({ user: validUserId }) : null;
      let agent = null;
      if (agentId && agentId !== 'undefined' && agentId !== 'null' && db.mongoose.Types.ObjectId.isValid(agentId)) agent = await Agent.findById(agentId);
      else if (flowId && flowId !== 'undefined' && flowId !== 'null' && db.mongoose.Types.ObjectId.isValid(flowId)) agent = await Agent.findOne({ flow_id: flowId });

      const provider = agent?.voice_provider || (agent?.telephony_provider?.startsWith('deepgram') ? 'deepgram' : (agent?.telephony_provider?.startsWith('sarvam_ai') ? 'sarvam_ai' : 'elevenlabs'));

      const noiseTokens = ['[background noise]', '[pause]', '[laughs]', '[clicking]', '[phone ringing]', '[phone beeping]', '[outro jingle]', '[silence]', '[phone hangs up]', '[phone hanging up]', '[phone clicks]'];

      if (provider === 'deepgram') {
        const apiKey = userSettings?.deepgram_api_key;
        const wavBuffer = this.createUlawWav(buffer);
        await deepgramService.saveAudio(wavBuffer, `inbound_${Date.now()}.wav`);
        const text = await deepgramService.transcribeAudio(wavBuffer, apiKey);
        const cleanedText = text ? text.trim() : '';
        if (!cleanedText || noiseTokens.some(token => cleanedText.toLowerCase().includes(token))) {
          console.log(`Ignoring noise/silence token: ${cleanedText}`);
          return null;
        }
        return cleanedText;
      } else if (provider === 'sarvam_ai') {
        const apiKey = userSettings?.sarvam_ai_api_key;
        const wavBuffer = this.createUlawWav(buffer);
        await sarvamService.saveAudio(wavBuffer, `inbound_${Date.now()}.wav`);
        const text = await sarvamService.transcribeAudio(wavBuffer, apiKey);
        const cleanedText = text ? text.trim() : '';
        if (!cleanedText || noiseTokens.some(token => cleanedText.toLowerCase().includes(token))) {
          console.log(`Ignoring noise/silence token: ${cleanedText}`);
          return null;
        }
        return cleanedText;
      } else {
        const apiKey = userSettings?.elevenlabs_api_key;
        const wavBuffer = this.createUlawWav(buffer);
        await elevenLabsService.saveAudio(wavBuffer, `inbound_${Date.now()}.mp3`);
        const text = await elevenLabsService.transcribeAudio(wavBuffer, apiKey);
        const cleanedText = text ? text.trim() : '';
        if (!cleanedText || noiseTokens.some(token => cleanedText.toLowerCase().includes(token))) {
          console.log(`Ignoring noise/silence token: ${cleanedText}`);
          return null;
        }
        return cleanedText;
      }
    } catch (err) {
      console.error('STT Error:', err);
      return "";
    }
  }

  async speak(ws, streamSid, text, voiceId, apiKey, provider = 'elevenlabs', deepgramApiKey = null) {
    try {
      console.log(`Speaking: "${text}"`);

      const stream = this.activeStreams.get(streamSid);
      let activeProvider = provider || 'elevenlabs';
      let activeApiKey = apiKey;
      let activeVoiceId = voiceId;

      if (stream && (!provider || provider === 'elevenlabs')) {
        let agent = null;
        if (stream.agentId) agent = await Agent.findById(stream.agentId);
        else if (stream.flowId) agent = await Agent.findOne({ flow_id: stream.flowId });
        if (agent) {
          if (agent.voice_provider === 'deepgram' || agent.telephony_provider?.startsWith('deepgram')) {
            activeProvider = 'deepgram';
            if (!activeVoiceId && agent.voice_id) activeVoiceId = agent.voice_id;
          } else if (agent.voice_provider === 'sarvam_ai' || agent.telephony_provider?.startsWith('sarvam_ai')) {
            activeProvider = 'sarvam_ai';
            if (!activeVoiceId && agent.voice_id) activeVoiceId = agent.voice_id;
          } else if (agent.voice_provider) {
            activeProvider = agent.voice_provider;
            if (!activeVoiceId && agent.voice_id) activeVoiceId = agent.voice_id;
          }
        }
      }

      const settings = stream?.userId ? await UserSettings.findOne({ user: stream.userId }) : null;

      if (activeProvider === 'deepgram') {
        let dgApiKey = deepgramApiKey || settings?.deepgram_api_key || deepgramService.apiKey;
        if (!dgApiKey) {
          console.warn('[TTS] No Deepgram API key found. Falling back to Twilio <Say>.');
          return await this.speakViaTwiml(streamSid, text);
        }

        if (stream) {
          stream.audioBuffer = [];
        }

        const pcmBuffer = await deepgramService.generateSpeech(text, activeVoiceId || 'aura-asteria-en', {}, dgApiKey, 8000);
        const ulawBuffer = this.encodePcmToUlaw(pcmBuffer, 8000);
        const base64Audio = ulawBuffer.toString('base64');
        ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: base64Audio } }));

        const markMessage = {
          event: 'mark',
          streamSid: streamSid,
          mark: { name: 'agent-speech-completed' }
        };
        ws.send(JSON.stringify(markMessage));
        return;
      }

      if (activeProvider === 'sarvam_ai') {
        let sarvamApiKey = settings?.sarvam_ai_api_key || sarvamService.apiKey;
        if (!sarvamApiKey && apiKey && !apiKey.startsWith('sk_75') && !apiKey.startsWith('sk_f1')) {
          sarvamApiKey = apiKey;
        }
        if (!sarvamApiKey) {
          console.warn('[TTS] No Sarvam AI API key found. Falling back to Twilio <Say>.');
          return await this.speakViaTwiml(streamSid, text);
        }

        if (stream) {
          stream.audioBuffer = [];
        }

        const pcmBuffer = await sarvamService.generateSpeech(text, activeVoiceId || 'shubh', {}, sarvamApiKey, 8000);
        const ulawBuffer = this.encodePcmToUlaw(pcmBuffer, pcmBuffer.sampleRate || 8000);
        const base64Audio = ulawBuffer.toString('base64');
        ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: base64Audio } }));

        const markMessage = {
          event: 'mark',
          streamSid: streamSid,
          mark: { name: 'agent-speech-completed' }
        };
        ws.send(JSON.stringify(markMessage));
        return;
      }

      let elApiKey = (activeProvider === provider ? apiKey : null) || settings?.elevenlabs_api_key || elevenLabsService.apiKey;
      if (!elApiKey) {
        console.warn('[TTS] No ElevenLabs API key found. Falling back to Twilio <Say>.');
        return await this.speakViaTwiml(streamSid, text);
      }

      if (stream) {
        stream.audioBuffer = [];
      }

      const pcmBuffer = await elevenLabsService.generateSpeech(text, activeVoiceId || 'JBFqnCBsd6RMkjVDRZzb', {}, elApiKey);
      const ulawBuffer = this.encodePcmToUlaw(pcmBuffer, 16000);
      const base64Audio = ulawBuffer.toString('base64');
      ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: base64Audio } }));
      
      const markMessage = {
        event: 'mark',
        streamSid: streamSid,
        mark: { name: 'agent-speech-completed' }
      };
      ws.send(JSON.stringify(markMessage));
    } catch (err) {
      console.error(`[${provider || activeProvider || 'ElevenLabs'}] TTS failed, falling back to Twilio <Say>:`, err.message);
      await this.speakViaTwiml(streamSid, text);
    }
  }

  async speakViaTwiml(streamSid, text) {
    try {
      const stream = this.activeStreams.get(streamSid);
      if (!stream || !stream.callSid || !stream.userId) {
        console.error('[TwiML Say] Cannot fall back — missing stream state.');
        return;
      }

      const client = await this.getTwilioClient(stream.userId);
      if (!client) {
        console.error('[TwiML Say] No Twilio client available.');
        return;
      }

      const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      let twiml = '';
      if (stream.pendingTerminate) {
        twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">${safeText}</Say>
    <Hangup />
</Response>`;
      } else {
        const wsUrl = process.env.APP_URL ? process.env.APP_URL.replace('http', 'ws') : null;
        if (!wsUrl) {
          console.error('[TwiML Say] APP_URL not set — cannot reconnect stream after Say.');
          return;
        }

        let parametersXml = '';
        if (stream.flowId) parametersXml += `<Parameter name="flowId" value="${stream.flowId}" />\n`;
        if (stream.agentId) parametersXml += `<Parameter name="agentId" value="${stream.agentId}" />\n`;
        parametersXml += `<Parameter name="userId" value="${stream.userId}" />\n`;
        if (stream.currentNodeId) parametersXml += `<Parameter name="startNodeId" value="${stream.currentNodeId}" />\n`;
        parametersXml += `<Parameter name="isReturningFromSay" value="true" />\n`;

        twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">${safeText}</Say>
    <Connect>
        <Stream url="${wsUrl}">
            ${parametersXml}
        </Stream>
    </Connect>
</Response>`;
      }

      console.log(`[TwiML Say] Updating call ${stream.callSid} with <Say> fallback`);
      await client.calls(stream.callSid).update({ twiml });
    } catch (err) {
      console.error('[TwiML Say] Fallback failed:', err.message);
    }
  }

  encodePcmToUlaw(pcmBuffer, srcRate = 8000) {
    let targetPcm = pcmBuffer;
    if (srcRate !== 8000) {
      targetPcm = this.resamplePcm(pcmBuffer, srcRate, 8000);
    }
    const ulaw = Buffer.alloc(targetPcm.length / 2);
    for (let i = 0; i < targetPcm.length; i += 2) {
      const pcm = targetPcm.readInt16LE(i);
      ulaw[i / 2] = this.linearToUlaw(pcm);
    }
    return ulaw;
  }

  resamplePcm(pcmBuffer, srcRate, dstRate) {
    if (srcRate === dstRate) return pcmBuffer;
    const ratio = dstRate / srcRate;
    const inputSamples = pcmBuffer.length / 2;
    const outputSamples = Math.floor(inputSamples * ratio);
    const outputBuffer = Buffer.alloc(outputSamples * 2);

    for (let i = 0; i < outputSamples; i++) {
      const srcIndex = i / ratio;
      const srcFloor = Math.floor(srcIndex);
      const srcCeil = Math.min(srcFloor + 1, inputSamples - 1);
      const t = srcIndex - srcFloor;

      const sampleA = pcmBuffer.readInt16LE(srcFloor * 2);
      const sampleB = pcmBuffer.readInt16LE(srcCeil * 2);
      const interpolated = Math.round(sampleA * (1 - t) + sampleB * t);
      const clamped = Math.max(-32768, Math.min(32767, interpolated));
      outputBuffer.writeInt16LE(clamped, i * 2);
    }
    return outputBuffer;
  }

  linearToUlaw(pcm) {
    const MASK = 0x7F;
    const BIAS = 0x84;
    let mask = 0xFF;
    let seg;

    if (pcm < 0) {
      pcm = BIAS - pcm;
      mask = 0x7F;
    } else {
      pcm += BIAS;
    }

    if (pcm > 32635) pcm = 32635;

    for (seg = 0; seg < 8; seg++) {
      if (pcm <= (160 << (seg + 1))) break;
    }

    const uval = (seg << 4) | ((pcm >> (seg + 3)) & 0x0F);
    return (uval ^ mask) & 0xFF;
  }

  createUlawWav(ulawBuffer) {
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + ulawBuffer.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(7, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(8000, 24);
    header.writeUInt32LE(8000, 28);
    header.writeUInt16LE(1, 32);
    header.writeUInt16LE(8, 34);
    header.write('data', 36);
    header.writeUInt32LE(ulawBuffer.length, 40);

    return Buffer.concat([header, ulawBuffer]);
  }

  ulawToLinear(ulaw) {
    ulaw = ~ulaw;
    let sign = (ulaw & 0x80) ? -1 : 1;
    let exponent = (ulaw >> 4) & 0x07;
    let mantissa = ulaw & 0x0F;
    let linear = ((mantissa << 3) + 0x84) << exponent;
    return sign * (linear - 0x84);
  }

  calculateUlawRMS(ulawBuffer) {
    let sum = 0;
    for (let i = 0; i < ulawBuffer.length; i++) {
      const pcm = this.ulawToLinear(ulawBuffer[i]);
      sum += pcm * pcm;
    }
    return Math.sqrt(sum / ulawBuffer.length);
  }

  async handlePostCallIntegrations(callSid, userId) {
    try {
      const call = await Call.findOne({ twilio_call_sid: callSid });
      if (!call || call.post_call_handled) return;

      call.post_call_handled = true;
      await call.save();

      const appointmentDetails = call.extracted_data?.appointment_details;
      if (appointmentDetails && appointmentDetails.date && appointmentDetails.time) {

        const appointment = await Appointment.create({
          user_id: userId,
          call_id: call._id,
          flow_id: call.flow_id,
          name: appointmentDetails.name || 'Unknown',
          phone: call.direction === 'inbound' ? call.from_number : call.to_number,
          appointment_date: new Date(appointmentDetails.date),
          appointment_time: appointmentDetails.time,
          status: 'confirmed'
        });

        console.log(`[Post-Call] Appointment created: ${appointment._id}`);

        let sendMeetLink = false;
        let googleCalendarId = null;
        let googleSheetId = null;
        let googleSheetName = null;
        let googleSheetRange = null;

        if (call.flow_id) {
          const flow = await Flow.findById(call.flow_id);
          if (flow && flow.nodes) {
            const bookNode = flow.nodes.find(n => n.type === 'book_slot');
            if (bookNode && bookNode.data) {
              sendMeetLink = bookNode.data.send_google_meet_link || false;
              googleCalendarId = bookNode.data.google_calendar_id || null;
              googleSheetId = bookNode.data.google_sheet_id || null;
              googleSheetName = bookNode.data.google_sheet_name || null;
              googleSheetRange = bookNode.data.google_sheet_range || null;
            }
          }
        }

        const updatedAppointment = await appointmentService.syncToGoogleCalendar(userId, appointment, sendMeetLink, googleCalendarId);
        await appointmentService.syncToGoogleSheet(userId, updatedAppointment, googleSheetId, googleSheetName, googleSheetRange);

        let appSettings = await AppointmentSetting.findOne({ user_id: userId });
        if (!appSettings) {
          appSettings = await AppointmentSetting.create({ user_id: userId });
        }
        const channel = appSettings?.confirmation_channel || 'none';

        if (channel !== 'none') {
          let template = appSettings?.confirmation_message_template;
          if (!template) {
            template = `Hi {{name}}, your appointment is confirmed for {{date}} at {{time}}.`;
            if (sendMeetLink) template += `\nGoogle Meet: {{meet_link}}`;
          }

          let messageBody = template
            .replace(/{{name}}/g, updatedAppointment.name)
            .replace(/{{date}}/g, updatedAppointment.appointment_date.toDateString())
            .replace(/{{time}}/g, updatedAppointment.appointment_time)
            .replace(/{{meet_link}}/g, updatedAppointment.meet_link || 'N/A');

          const twilioClient = await this.getTwilioClient(userId);
          const fromNumber = call.direction === 'inbound' ? call.to_number : call.from_number;
          const toNumber = call.direction === 'inbound' ? call.from_number : call.to_number;

          if (twilioClient && fromNumber && toNumber) {
            try {
              const sendOptions = {
                body: messageBody,
                from: channel === 'whatsapp' ? `whatsapp:${fromNumber}` : fromNumber,
                to: channel === 'whatsapp' ? `whatsapp:${toNumber}` : toNumber
              };
              await twilioClient.messages.create(sendOptions);
              console.log(`[Post-Call] Confirmation sent via ${channel} to ${toNumber}`);
            } catch (msgErr) {
              console.error(`[Post-Call] Failed to send confirmation message:`, msgErr.message);
            }
          }
        }
      }

      const formResponses = call.extracted_data?.form_responses;
      const formId = call.extracted_data?.form_id;
      const formCompleted = call.extracted_data?.form_completed;

      if (formResponses && formId && Object.keys(formResponses).length > 0) {
        const formResponse = await FormResponse.create({
          user_id: userId,
          form_id: formId,
          call_id: call._id,
          flow_id: call.flow_id,
          responses: formResponses,
          status: formCompleted ? 'completed' : 'partial'
        });

        console.log(`[Post-Call] Form response saved: ${formResponse._id}`);

        if (call.flow_id) {
          const flow = await Flow.findById(call.flow_id);
          if (flow && flow.nodes) {
            const dataCaptureNode = flow.nodes.find(n => n.type === 'data_capture' && n.data?.form_id?.toString() === formId.toString());
            if (dataCaptureNode && dataCaptureNode.data) {
              const googleSheetId = dataCaptureNode.data.google_sheet_id || null;

              if (googleSheetId) {
                await this.syncFormToGoogleSheet(userId, formResponse, googleSheetId);
              }
            }
          }
        }

        if (formCompleted) {
          let appSettings = await AppointmentSetting.findOne({ user_id: userId });
          if (!appSettings) {
            appSettings = await AppointmentSetting.create({ user_id: userId });
          }
          const channel = appSettings?.confirmation_channel || 'none';

          if (channel !== 'none') {
            const form = await Form.findById(formId);
            const formName = form ? form.name : 'Survey';

            let messageBody = `Hi, thank you for completing the ${formName}. We have received your responses.`;

            const twilioClient = await this.getTwilioClient(userId);
            const fromNumber = call.direction === 'inbound' ? call.to_number : call.from_number;
            const toNumber = call.direction === 'inbound' ? call.from_number : call.to_number;

            if (twilioClient && fromNumber && toNumber) {
              try {
                const sendOptions = {
                  body: messageBody,
                  from: channel === 'whatsapp' ? `whatsapp:${fromNumber}` : fromNumber,
                  to: channel === 'whatsapp' ? `whatsapp:${toNumber}` : toNumber
                };
                await twilioClient.messages.create(sendOptions);
                console.log(`[Post-Call] Form confirmation sent via ${channel} to ${toNumber}`);
              } catch (msgErr) {
                console.error(`[Post-Call] Failed to send form confirmation message:`, msgErr.message);
              }
            }
          }
        }
      }

      const userSettings = await UserSettings.findOne({ user: userId });
      if (userSettings) {
        const channel = userSettings.post_call_channel || 'none';
        const toNumber = call.direction === 'inbound' ? call.from_number : call.to_number;
        const toEmail = call.extracted_data?.email || call.lead_email;

        const dynamicData = {
          contact: {
            first_name: call.lead_name || 'Customer',
            phone_number: toNumber,
            email: toEmail
          },
          call: {
            direction: call.direction,
            started_at: call.started_at,
            ended_at: new Date(),
            ...call.extracted_data
          },
          appointment: appointmentDetails ? {
            date: appointmentDetails.date,
            time: appointmentDetails.time,
            name: appointmentDetails.name
          } : null
        };

        if ((channel === 'whatsapp' || channel === 'both') && userSettings.post_call_whatsapp_template) {
          try {
            await whatsappService.sendTemplateMessage({
              userId,
              to: toNumber,
              templateId: userSettings.post_call_whatsapp_template,
              dynamicData,
              callId: call._id,
              campaignId: call.campaign_id
            });
            console.log(`[Post-Call] WhatsApp message triggered for ${toNumber}`);
          } catch (waErr) {
            console.error(`[Post-Call] WhatsApp send failed:`, waErr.message);
          }
        }

        if ((channel === 'email' || channel === 'both') && userSettings.post_call_email_template && toEmail) {
          try {
            await emailService.sendTemplateEmail({
              userId,
              to: toEmail,
              templateId: userSettings.post_call_email_template,
              dynamicData,
              campaignId: call.campaign_id
            });
            console.log(`[Post-Call] Email triggered for ${toEmail}`);
          } catch (emErr) {
            console.error(`[Post-Call] Email send failed:`, emErr.message);
          }
        }
      }
    } catch (err) {
      console.error('Post-Call Integration Error:', err.message);
    }
  }

  async syncFormToGoogleSheet(userId, formResponse, spreadsheetId) {
    try {
      const googleAccount = await GoogleAccount.findOne({ user_id: userId, status: 'active', deleted_at: null });
      if (!googleAccount) {
        console.log('[Form Google Sheet] No active Google account found, skipping sync');
        return;
      }

      const accessToken = decrypt(googleAccount.access_token);
      const form = await Form.findById(formResponse.form_id);
      if (!form) return;

      const headers = form.fields.map(f => f.label);
      const values = form.fields.map(f => formResponse.responses[f.key] || '');

      await axios.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED`,
        { values: [headers, values] },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[Form Google Sheet] Data appended to ${spreadsheetId}`);
    } catch (error) {
      console.error('[Form Google Sheet] Sync Error:', error.response?.data || error.message);
    }
  }
}

module.exports = new VoiceAutomationService();