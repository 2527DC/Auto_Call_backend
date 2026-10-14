const { db } = require('../models');
const Call = db.Call;
const Agent = db.Agent;
const Contact = db.Contact;
const UserSettings = db.UserSettings;
const WhatsappPhoneNumber = db.WhatsappPhoneNumber;
const Flow = db.Flow;
const whatsappCallingService = require('./whatsappCallingService');
const webrtcService = require('./whatsappWebrtcService');
const elevenLabsService = require('./elevenlabsService');
const deepgramService = require('./deepgramService');
const sarvamService = require('./sarvamService');
const automationEngine = require('../utils/automationEngine');
const llmService = require('./llmService');
const webhookDispatcher = require('./webhookDispatcher');
const { findContactByPhone, findOrCreateContact } = require('../utils/phone');

const aiProcessingLocks = new Map();

// Answer time, so the duration doesn't include ringing.
const answered = (callLog) => { if (!callLog.answered_at) callLog.answered_at = new Date(); };

class WhatsappCallAutomationService {
    async handleCallWebhook(callData, phoneNumberId) {
        const { id: waCallId, from: contactNumber, event, session } = callData;

        try {
            const callbackData = JSON.parse(callData.biz_opaque_callback_data || '{}');
            const activeCallId = callbackData.internal_call_id || waCallId;
            let callLog = await Call.findOne({ twilio_call_sid: activeCallId });

            switch (event) {
                case 'connect':
                    if (session?.sdp_type === 'offer') {
                        if (callLog && callLog.status !== 'ringing') {
                            console.log(`[CallWebhook] Call ${activeCallId} already answered (status: ${callLog.status}), ignoring duplicate.`);
                            return;
                        }

                        const { contact, agent } = await this.resolveContactAndAgent(contactNumber, phoneNumberId, { createContact: true });

                        if (!agent) {
                            console.error(`No agent found for call ${waCallId}`);
                            await whatsappCallingService.terminateCall(phoneNumberId, waCallId);
                            return;
                        }

                        if (!callLog) {
                            callLog = await Call.create({
                                user_id: agent.user_id,
                                agent_id: agent._id,
                                flow_id: agent.flow_id,
                                twilio_call_sid: waCallId,
                                from_number: contactNumber,
                                to_number: phoneNumberId,
                                status: 'ringing',
                                direction: 'inbound',
                                contact_id: contact?._id || null,
                                lead_name: [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || 'Unknown'
                            });
                        }

                        console.log(`Answering call ${waCallId} from ${contactNumber}`);
                        await whatsappCallingService.answerCall(phoneNumberId, waCallId, session.sdp, agent, contact, callLog);

                        callLog.status = 'in-progress';
                        answered(callLog);
                        await callLog.save();

                        const userSettings = await UserSettings.findOne({ user: agent.user_id });
                        if (agent.flow_id) {
                            const flow = await Flow.findById(agent.flow_id);
                            if (flow) {
                                const result = await automationEngine.executeFlowSync(flow, {
                                    agent,
                                    userId: agent.user_id,
                                    call: callLog,
                                }, null);

                                callLog.extracted_data = {
                                    ...(callLog.extracted_data || {}),
                                    ...automationEngine.savedFlowData(result.final_data),
                                    currentNodeId: result.currentNodeId
                                };
                                if (result.callState) callLog.conversation_state = result.callState;
                                if (result.signals?.length) callLog.live_signals.push(...result.signals);
                                await callLog.save();

                                const messages = result.logs.filter(l => l.output && l.output.last_message).map(l => l.output.last_message);
                                const fullMessage = messages.join(' ');

                                if (fullMessage && fullMessage.trim()) {
                                    const pcmBuffer = await this.generateSpeech(agent, userSettings, fullMessage);
                                    await webrtcService.playAudio(waCallId, pcmBuffer);
                                    if (agent.enable_call_transcription) {
                                        callLog.transcript.push({ role: 'agent', text: fullMessage });
                                        await callLog.save();
                                    }
                                }
                            }
                        } else if (agent.first_message) {
                            console.log(`[Welcome] Playing welcome message: ${agent.first_message}`);
                            const pcmBuffer = await this.generateSpeech(agent, userSettings, agent.first_message);
                            await webrtcService.playAudio(activeCallId, pcmBuffer);

                            if (agent.enable_call_transcription) {
                                callLog.transcript.push({ role: 'agent', text: agent.first_message });
                                await callLog.save();
                            }
                        }
                    } else if (session?.sdp_type === 'answer') {
                        const { agent, contact } = await this.resolveContactAndAgent(contactNumber, phoneNumberId);
                        await webrtcService.connectOutboundCall(activeCallId, session.sdp, agent, contact, callLog);
                        if (callLog) {
                            callLog.status = 'in-progress';
                            answered(callLog);
                            await callLog.save();

                            const userSettings = await UserSettings.findOne({ user: agent.user_id });
                            if (agent.flow_id) {
                                const flow = await Flow.findById(agent.flow_id);
                                if (flow) {
                                    const result = await automationEngine.executeFlowSync(flow, {
                                        agent,
                                        userId: agent.user_id,
                                        call: callLog,
                                    }, null);

                                    callLog.extracted_data = {
                                        ...(callLog.extracted_data || {}),
                                        ...automationEngine.savedFlowData(result.final_data),
                                        currentNodeId: result.currentNodeId
                                    };
                                    if (result.callState) callLog.conversation_state = result.callState;
                                    if (result.signals?.length) callLog.live_signals.push(...result.signals);
                                    await callLog.save();

                                    const messages = result.logs.filter(l => l.output && l.output.last_message).map(l => l.output.last_message);
                                    const fullMessage = messages.join(' ');

                                    if (fullMessage && fullMessage.trim()) {
                                        const pcmBuffer = await this.generateSpeech(agent, userSettings, fullMessage);
                                        await webrtcService.playAudio(activeCallId, pcmBuffer);
                                        if (agent.enable_call_transcription) {
                                            callLog.transcript.push({ role: 'agent', text: fullMessage });
                                            await callLog.save();
                                        }
                                    }
                                }
                            } else if (agent.first_message) {
                                const pcmBuffer = await this.generateSpeech(agent, userSettings, agent.first_message);
                                await webrtcService.playAudio(activeCallId, pcmBuffer);

                                if (agent.enable_call_transcription) {
                                    callLog.transcript.push({ role: 'agent', text: agent.first_message });
                                    await callLog.save();
                                }
                            }
                        }
                    }
                    break;

                case 'connected':
                    break;

                case 'terminate':
                    if (callLog) {
                        console.log(`[CallAutomation] Call ${activeCallId} ended.`);
                        try {
                            webrtcService.cleanup(activeCallId);
                        } catch (err) {
                            console.error('[CallAutomation] Error cleaning up WebRTC on terminate:', err.message);
                        }
                        await this.finishCall(callLog);
                    }
                    break;
            }
        } catch (error) {
            console.error('Error handling call webhook:', error);
        }
    }

    // createContact: only for incoming calls, where the number is the caller's.
    async resolveContactAndAgent(contactNumber, phoneNumberId, { createContact = false } = {}) {
        const phone = await WhatsappPhoneNumber.findOne({ whatsapp_phone_number_id: phoneNumberId });
        if (!phone) return { contact: null, agent: null };
        const agent = await Agent.findOne({ user_id: phone.user_id, telephony_provider: 'meta_whatsapp', status: 'active' });
        const lookup = createContact
            ? findOrCreateContact(Contact, phone.user_id, contactNumber, { source: 'whatsapp_call' })
            : findContactByPhone(Contact, phone.user_id, contactNumber);
        const contact = await lookup.catch(err => { console.error('[CallAutomation] Contact lookup failed:', err.message); return null; });
        return { contact, agent };
    }

    // The call is over: duration, webhook and the same after-call steps as phone
    // calls (form response, appointment, follow-up message). Not charged while
    // WhatsApp calling is in beta. Safe to call twice (hang-up webhook + end step).
    async finishCall(callLog) {
        const fresh = await Call.findById(callLog._id);
        if (!fresh || fresh.status === 'completed') return;
        const endedAt = new Date();
        const from = fresh.answered_at || fresh.started_at;
        fresh.status = 'completed';
        fresh.ended_at = endedAt;
        fresh.duration = from ? Math.max(1, Math.round((endedAt - new Date(from)) / 1000)) : 0;
        await fresh.save();
        webhookDispatcher.dispatchEvent(fresh.user_id, fresh.direction === 'inbound' ? 'Inbound Call Finished' : 'Call Finished', fresh);
        require('./voiceAutomationService').handlePostCallIntegrations(fresh.twilio_call_sid, fresh.user_id)
            .catch(err => console.error('[CallAutomation] Post-call step failed:', err.message));
    }

    async generateSpeech(agent, userSettings, text) {
        const provider = agent?.voice_provider || (agent?.telephony_provider?.startsWith('deepgram') ? 'deepgram' : (agent?.telephony_provider?.startsWith('sarvam_ai') ? 'sarvam_ai' : 'elevenlabs'));
        if (provider === 'deepgram') {
            const apiKey = userSettings?.deepgram_api_key;
            return await deepgramService.generateSpeech(text, agent.voice_id || 'aura-asteria-en', {}, apiKey);
        } else if (provider === 'sarvam_ai') {
            const apiKey = userSettings?.sarvam_ai_api_key;
            return await sarvamService.generateSpeech(text, agent.voice_id || 'shubh', {}, apiKey, 8000);
        } else {
            const apiKey = userSettings?.elevenlabs_api_key;
            return await elevenLabsService.generateSpeech(text, agent.voice_id || 'JBFqnCBsd6RMkjVDRZzb', { language: agent.language, model: agent.tts_model }, apiKey);
        }
    }

    async processSTT(agent, opusFrames, waCallId) {
        if (!Array.isArray(opusFrames) || opusFrames.length === 0) return '';
        try {
            const userSettings = await UserSettings.findOne({ user: agent.user_id });
            const provider = agent?.voice_provider || (agent?.telephony_provider?.startsWith('deepgram') ? 'deepgram' : (agent?.telephony_provider?.startsWith('sarvam_ai') ? 'sarvam_ai' : 'elevenlabs'));

            const pcmBuffer = Buffer.concat(opusFrames.map(frame => {
                const buf = Buffer.alloc(frame.length * 2);
                for (let i = 0; i < frame.length; i++) {
                    buf.writeInt16LE(frame[i], i * 2);
                }
                return buf;
            }));

            const wavBuffer = this.generateWavBuffer(pcmBuffer, 8000, 1, 16);

            if (provider === 'deepgram') {
                const apiKey = userSettings?.deepgram_api_key;
                if (!apiKey) {
                    console.warn('[STT] No Deepgram API key configured');
                    return '';
                }
                const text = await deepgramService.transcribeAudio(wavBuffer, apiKey);
                return text ? text.trim() : '';
            } else if (provider === 'sarvam_ai') {
                const apiKey = userSettings?.sarvam_ai_api_key;
                if (!apiKey) {
                    console.warn('[STT] No Sarvam AI API key configured');
                    return '';
                }
                const text = await sarvamService.transcribeAudio(wavBuffer, apiKey);
                return text ? text.trim() : '';
            } else {
                const apiKey = userSettings?.elevenlabs_api_key;
                if (!apiKey) {
                    console.warn('[STT] No ElevenLabs API key configured');
                    return '';
                }
                const text = await elevenLabsService.transcribeAudio(wavBuffer, apiKey);
                return text ? text.trim() : '';
            }
        } catch (err) {
            console.error('STT Error:', err);
            return '';
        }
    }

    generateWavBuffer(pcmBuffer, sampleRate = 8000, channels = 1, bitsPerSample = 16) {
        const dataSize = pcmBuffer.length;
        const buffer = Buffer.alloc(44 + dataSize);
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + dataSize, 4);
        buffer.write('WAVE', 8);
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16);
        buffer.writeUInt16LE(1, 20);
        buffer.writeUInt16LE(channels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
        buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
        buffer.writeUInt16LE(bitsPerSample, 34);
        buffer.write('data', 36);
        buffer.writeUInt32LE(dataSize, 40);
        pcmBuffer.copy(buffer, 44);
        return buffer;
    }

    async handleUserSpeech(waCallId, userText) {
        if (!userText || userText.trim().length === 0) return;

        if (aiProcessingLocks.get(waCallId)) return;
        aiProcessingLocks.set(waCallId, true);

        try {
            const callLog = await Call.findOne({ twilio_call_sid: waCallId });
            if (!callLog || callLog.status === 'completed') return;

            const agent = await Agent.findById(callLog.agent_id).populate('llm_model', 'model_id provider name');
            if (!agent) return;

            const userSettings = await UserSettings.findOne({ user: agent.user_id }).populate('ai_model');

            if (agent.enable_call_transcription) {
                callLog.transcript.push({ role: 'user', text: userText });
                await callLog.save();
            }

            if (agent.flow_id) {
                const flow = await Flow.findById(agent.flow_id);
                if (flow) {
                    const aiConfig = userSettings?.ai_model ? {
                        model: userSettings.ai_model.model_id,
                        apiKey: userSettings.ai_api_key,
                        provider: userSettings.ai_model.provider
                    } : null;

                    const result = await automationEngine.executeFlowSync(flow, {
                        user_input: userText,
                        agent,
                        aiConfig,
                        userId: agent.user_id,
                        call: callLog,
                        appointment_details: callLog.extracted_data?.appointment_details || {},
                        form_responses: callLog.extracted_data?.form_responses || {},
                        current_field_index: callLog.extracted_data?.current_field_index || 0,
                        form_id: callLog.extracted_data?.form_id || null,
                        call_state: callLog.conversation_state || {},
                        can_transfer: false
                    }, callLog.extracted_data?.currentNodeId || null);

                    callLog.extracted_data = {
                        ...(callLog.extracted_data || {}),
                        ...automationEngine.savedFlowData(result.final_data),
                        currentNodeId: result.currentNodeId
                    };
                    if (result.callState) callLog.conversation_state = result.callState;
                    if (result.signals?.length) callLog.live_signals.push(...result.signals);
                    await callLog.save();

                    const messages = result.logs.filter(l => l.output && l.output.last_message).map(l => l.output.last_message);
                    const nextResponse = messages.join(' ');

                    const terminateLog = result.logs.find(l => l.node_type === 'terminate_call');

                    if (nextResponse && nextResponse.trim()) {
                        const pcmBuffer = await this.generateSpeech(agent, userSettings, nextResponse);
                        await webrtcService.playAudio(waCallId, pcmBuffer);

                        if (agent.enable_call_transcription) {
                            callLog.transcript.push({ role: 'agent', text: nextResponse });
                            await callLog.save();
                        }
                    }

                    if (terminateLog) {
                        let waitMs = 5000;
                        if (nextResponse && nextResponse.trim() && typeof pcmBuffer !== 'undefined') {
                            waitMs = (pcmBuffer.length / 32) + 2000;
                        }
                        setTimeout(async () => {
                            try {
                                const webrtcConn = webrtcService.connections.get(waCallId);
                                let activePhoneId = webrtcConn?.phoneNumberId;
                                if (!activePhoneId) {
                                    const waPhone = await WhatsappPhoneNumber.findOne({ user_id: agent.user_id, deleted_at: null });
                                    activePhoneId = waPhone ? (waPhone.whatsapp_phone_number_id || waPhone.phone_number_id) : (callLog.direction === 'inbound' ? callLog.to_number : callLog.from_number);
                                }
                                await whatsappCallingService.terminateCall(activePhoneId, waCallId);
                            } catch (e) {
                                console.error('[CallAutomation] Error terminating call:', e.message);
                            } finally {
                                await this.finishCall(callLog);
                            }
                        }, waitMs);
                    }
                }
            } else {
                const conversationContext = callLog.transcript
                    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
                    .join('\n');

                const fullPrompt = `Conversation so far:\n${conversationContext}`;

                let systemPrompt = agent.system_prompt || agent.personality || '';
                if (agent.custom_knowledge_base) {
                    systemPrompt += `\n\nADDITIONAL KNOWLEDGE BASE:\n${agent.custom_knowledge_base}`;
                }

                const aiConfig = userSettings?.ai_model ? {
                    model: userSettings.ai_model.model_id,
                    apiKey: userSettings.ai_api_key,
                    provider: userSettings.ai_model.provider
                } : null;

                const nextResponse = await llmService.generateResponseWithSystemPrompt(
                    fullPrompt,
                    systemPrompt,
                    aiConfig?.model || agent.llm_model?.model_id,
                    aiConfig,
                    {
                        empathy_level: agent.empathy_level,
                        energy_level: agent.energy_level,
                        response_length: agent.response_length,
                        intelligence_level: agent.intelligence_level
                    }
                );

                if (nextResponse && nextResponse.trim()) {
                    const pcmBuffer = await this.generateSpeech(agent, userSettings, nextResponse);
                    await webrtcService.playAudio(waCallId, pcmBuffer);

                    if (agent.enable_call_transcription) {
                        callLog.transcript.push({ role: 'agent', text: nextResponse });
                        await callLog.save();
                    }
                }
            }
        } catch (error) {
            console.error('[CallAutomation] handleUserSpeech error:', error);
        } finally {
            aiProcessingLocks.set(waCallId, false);
        }
    }
}

module.exports = new WhatsappCallAutomationService();
