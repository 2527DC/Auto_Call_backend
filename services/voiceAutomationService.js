'use strict';

const EventEmitter = require('events');
const automationEngine = require('../utils/automationEngine');
const elevenLabsService = require('./elevenlabsService');
const deepgramService = require('./deepgramService');
const sarvamService = require('./sarvamService');
const appointmentService = require('./appointmentService');
const twilio = require('twilio');
const plivo = require('plivo');
const { db } = require('../models');
const creditService = require('./creditService');
const { newUsage, runWithUsage, recordUsage } = require('../utils/usageMeter');
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
const ttsCache = require('./voice/ttsCache');
const { decrypt } = require('../utils/encryption-utils');

// Loudness (RMS of decoded mu-law) above which caller audio counts as speech.
// 650 is calibrated for standard 8 kHz telephone mu-law to capture normal voice while ignoring line hum.
const SPEECH_RMS_THRESHOLD = 650;

// In-memory cache for active violence words with 5-minute TTL to eliminate DB queries on speech turns.
let cachedViolenceWords = null;
let cachedViolenceWordsExpiry = 0;
async function getActiveViolenceWords() {
  const now = Date.now();
  if (cachedViolenceWords && now < cachedViolenceWordsExpiry) {
    return cachedViolenceWords;
  }
  try {
    cachedViolenceWords = await ViolenceWord.find({ is_active: true }).lean();
    cachedViolenceWordsExpiry = now + 5 * 60 * 1000;
    return cachedViolenceWords;
  } catch (err) {
    return cachedViolenceWords || [];
  }
}

// Outgoing calls: people answer with "Hello?". Greeting at once talks over them
// (and their words are dropped while the agent speaks), so by default the
// greeting waits until they finish their hello, or plays after a silent wait.
const HELLO_MIN_SPEECH_MS = 120;   // shorter bursts are clicks or line noise
const HELLO_END_SILENCE_MS = 350;  // pause that ends their hello
const HELLO_MAX_EXTRA_MS = 2500;   // greet anyway if they keep talking past the wait
const DEFAULT_HELLO_WAIT_MS = 1000;

// Caller audio sent to speech-to-text, which bills every second of it: a little
// lead-in so soft first syllables are kept, and only a short tail of the
// silence that ended the turn.
const PRE_ROLL_MS = 250;
const TRAILING_SILENCE_KEPT_MS = 200;

// Messages of the conversation sent to the AI each turn (the greeting and the
// last 9 or so exchanges); every one is paid for again on every turn.
const HISTORY_TURNS_SENT = 20;

// A caller who goes quiet is asked if they are still there, and the call ends
// (with the agent's goodbye) once the silence reaches the agent's idle_timeout.
// Without this a silent line stays open, and billed, for hours.
const IDLE_CHECK_EVERY_MS = 2000;
const IDLE_CHECK_IN_MAX_MS = 20000;
const DEFAULT_IDLE_TIMEOUT_S = 60;
// Hang up anyway if the goodbye never reports that it finished playing.
const GOODBYE_HANGUP_FALLBACK_MS = 15000;
const STILL_THERE = {
  hi: 'क्या आप अभी भी लाइन पर हैं?',
  kn: 'ನೀವು ಇನ್ನೂ ಲೈನ್‌ನಲ್ಲಿ ಇದ್ದೀರಾ?',
  en: 'Are you still there?',
};
const DEFAULT_GOODBYE = 'Goodbye! Thank you for calling.';

// The caller may talk over the agent. Speech that cuts it off must be clear
// conversational speech above telephone line hum, set per agent by interruption_sensitivity.
// high: ~150ms of speech (instant barge-in for fast natural conversation)
// medium: ~200ms of speech (balanced)
// low: ~380ms of louder speech (noisy environments)
const INTERRUPTION_RULES = {
  low: { speechMs: 380, rms: Math.round(SPEECH_RMS_THRESHOLD * 1.4) },
  medium: { speechMs: 200, rms: Math.round(SPEECH_RMS_THRESHOLD * 1.1) },
  high: { speechMs: 150, rms: SPEECH_RMS_THRESHOLD },
};
const BARGE_IN_GAP_MS = 300;    // a longer pause starts the count again
const BARGE_IN_GRACE_MS = 150;  // allow immediate caller interruption after start of playback
// A reply cut off by what turns out to be noise, or only "hmm" or "ok", is
// finished from the start of the cut sentence if the caller spoke this recently.
const RESUME_WITHIN_MS = 15000;
const FILLER_WORD = /^(h?m+|mhm+|hm+|uh+|um+|huh|aha|ok+|okay|achh?a|accha|हम्म*|अच्छा|ओके|ಹ್ಮ್*|ಓಕೆ)$/;

// Agents without a workflow: how to end a call well when the caller isn't
// interested, is busy, or asks not to be called. The reply that says goodbye
// ends with END_CALL_MARK, and the call ends once it has been said.
const END_CALL_MARK = '[END_CALL]';
const CALL_HANDLING_RULES = `CALL HANDLING:
- If the caller says they are not interested, ask once, politely, whether another time would suit them better. If they still say no, thank them and say goodbye.
- If the caller is busy or asks to be called later, ask what time suits them, repeat the time back, thank them and say goodbye.
- If the caller asks not to be called again, or it is a wrong number, apologise briefly and say goodbye.
- If the caller asks to speak to a person, say someone from the team will call them back, then say goodbye.
- Only when you are saying goodbye and the conversation is over, end your reply with ${END_CALL_MARK}.`;

class VoiceAutomationService extends EventEmitter {
  constructor() {
    super();
    this.activeStreams = new Map();
    this.twilioClient = null;
    // Call UUIDs of live Plivo streams, so call control goes to Plivo instead of Twilio.
    this.plivoCallIds = new Set();
    // Greeting audio being made ahead of a call, by cache key, so a call that is
    // answered meanwhile waits for it instead of making it a second time.
    this.warming = new Map();
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

  // Client for hanging up / redirecting live calls. Keeps Twilio's
  // client.calls(id).update(...) shape but routes Plivo calls to the Plivo API.
  async getCallControlClient(userId) {
    if (!userId) return null;

    const twilioClient = await this.getTwilioClient(userId);
    const settings = await UserSettings.findOne({ user: userId });
    const plivoAuthId = settings?.plivo_auth_id || process.env.PLIVO_AUTH_ID;
    const plivoAuthToken = settings?.plivo_auth_token || process.env.PLIVO_AUTH_TOKEN;
    if (!plivoAuthId || !plivoAuthToken || this.plivoCallIds.size === 0) {
      return twilioClient;
    }

    const plivoClient = new plivo.Client(plivoAuthId, plivoAuthToken);
    const client = Object.create(twilioClient || {});
    client.calls = (callId) => {
      if (!this.plivoCallIds.has(callId)) {
        return twilioClient ? twilioClient.calls(callId) : { update: async () => {} };
      }
      return {
        update: async (opts = {}) => {
          if (opts.status === 'completed') {
            await plivoClient.calls.hangup(callId);
          } else {
            console.warn(`[Plivo] Call update not supported for Plivo calls (${Object.keys(opts).join(', ')}); call ${callId} left unchanged.`);
          }
        }
      };
    };
    return client;
  }

  // Plivo sends context as "key=value;key=value" (keys may carry an X-PH- prefix).
  parsePlivoExtraHeaders(extraHeaders) {
    if (!extraHeaders) return {};
    if (typeof extraHeaders === 'object') return extraHeaders;
    return String(extraHeaders).split(';').reduce((acc, pair) => {
      const [key, ...rest] = pair.split('=');
      if (key && rest.length) {
        const name = key.trim().replace(/^X-PH-/i, '');
        const canonical = { agentid: 'agentId', userid: 'userId', flowid: 'flowId', direction: 'direction' }[name.toLowerCase()] || name;
        acc[canonical] = rest.join('=').trim();
      }
      return acc;
    }, {});
  }

  // Sends one synthesized utterance (8 kHz mu-law, base64) and signals when
  // playback ends. spoken: its text and voice, so a reply the caller cuts off
  // can be shortened in the conversation, or finished (see interruptAgent).
  sendAgentAudio(ws, streamSid, base64Audio, spoken = {}) {
    const stream = this.activeStreams.get(streamSid);
    const audio = Buffer.from(base64Audio, 'base64');
    // Caller audio is not taken as a turn until this utterance has finished
    // playing (see handlePlaybackComplete), so the agent never answers its own
    // echo; only clear speech cuts it short (see watchForBargeIn).
    if (stream) {
      if (!stream.pendingPlaybacks) stream.playing = [];
      stream.pendingPlaybacks = (stream.pendingPlaybacks || 0) + 1;
      // Utterances queue up and play at 8000 mu-law bytes per second.
      const startsAt = Math.max(Date.now(), stream.playbackEndsAt || 0);
      stream.playbackEndsAt = startsAt + Math.ceil(audio.length / 8);
      stream.playing.push({ text: spoken.text || '', voiceId: spoken.voiceId || null, startsAt, endsAt: stream.playbackEndsAt });
    }
    // Bumped when the caller cuts the agent off, so the end of audio that was
    // dropped is not taken for the end of what plays next.
    const playback = stream?.playbackGen || 0;

    if (stream?.provider !== 'plivo') {
      ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: base64Audio } }));
      // Twilio returns the mark once the audio has played, or at once for audio a 'clear' dropped.
      ws.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: `agent-speech-${playback}` } }));
      return;
    }

    // Plivo caps WebSocket messages at 64 KB, so send about one second per message.
    const CHUNK_BYTES = 8000;
    for (let offset = 0; offset < audio.length; offset += CHUNK_BYTES) {
      ws.send(JSON.stringify({
        event: 'playAudio',
        media: {
          contentType: 'audio/x-mulaw',
          sampleRate: 8000,
          payload: audio.subarray(offset, offset + CHUNK_BYTES).toString('base64')
        }
      }));
    }

    // Plivo queues audio; fire the "speech finished" step when this utterance
    // should have finished playing.
    setTimeout(() => {
      if ((stream.playbackGen || 0) !== playback) return;
      this.handlePlaybackComplete(streamSid).catch(err => console.error('[Plivo] Playback completion error:', err.message));
    }, stream.playbackEndsAt - Date.now() + 300);
  }

  setIo(io) {
    this.io = io;
  }

  // answeredAt: when the call's audio stream started, i.e. when it was picked
  // up. The call log's started_at is set when the call is placed, so billing
  // from it would charge for the ringing.
  async handleStreamCallCompletion(callSid, userId, answeredAt = null) {
    try {
      if (!callSid) return;
      const call = await Call.findOne({ twilio_call_sid: callSid });
      if (!call) return;

      const finalStatuses = ['completed', 'failed', 'busy', 'no-answer', 'canceled', 'declined', 'missed'];
      if (finalStatuses.includes(call.status)) return;

      const now = new Date();
      call.status = 'completed';
      call.ended_at = now;
      if (answeredAt || call.started_at) {
        const from = answeredAt || new Date(call.started_at).getTime();
        call.duration = Math.max(1, Math.round((now.getTime() - from) / 1000));
      } else {
        call.started_at = now;
        call.duration = 1;
      }
      await call.save();
      console.log(`[Stream Closed] Call ${callSid} status updated to completed. Duration: ${call.duration}s`);

      // Realtime notification to frontend
      if (userId && this.io) {
        this.io.emit(`call-status-update-${userId}`, {
          callSid: call.twilio_call_sid,
          status: 'completed'
        });
      }

      // Process credit deduction
      try {
        const creditResult = await creditService.processCallCreditDeduction(
          call.user_id,
          call._id,
          call.duration || 0
        );
        if (creditResult && creditResult.credits_deducted !== undefined) {
          call.credits_used = creditResult.credits_deducted;
          await call.save();
        }
      } catch (cErr) {
        console.error('[Stream Closed] Credit deduction error:', cErr.message);
      }

      // Webhook event
      try {
        const webhookDispatcher = require('./webhookDispatcher');
        webhookDispatcher.dispatchEvent(call.user_id, call.direction === 'inbound' ? 'Inbound Call Finished' : 'Call Finished', call);
      } catch (wErr) {
        console.error('[Stream Closed] Webhook error:', wErr.message);
      }
    } catch (err) {
      console.error('[Stream Closed] Error completing call on stream close:', err.message);
    }
  }

  endStream(streamSid) {
    const closingStream = this.activeStreams.get(streamSid);
    if (!closingStream) return;
    clearInterval(closingStream.idleTimer);
    clearTimeout(closingStream.maxDurationTimer);
    this.finishHello(closingStream, 'ended');
    if (closingStream.callSid) {
      // The agent ended it (goodbye, silence, time limit), else the caller hung up.
      const ended = { end_reason: closingStream.endReason || 'caller_hung_up' };
      if (closingStream.usage) ended.usage = closingStream.usage;
      Call.updateOne({ twilio_call_sid: closingStream.callSid }, { $set: ended })
        .catch((e) => console.error('[Usage] Could not save call usage:', e.message));
      this.handleStreamCallCompletion(closingStream.callSid, closingStream.userId, closingStream.callStartTime);
      this.handlePostCallIntegrations(closingStream.callSid, closingStream.userId);
      this.plivoCallIds.delete(closingStream.callSid);
    }
    this.activeStreams.delete(streamSid);
    console.log(`Stream stopped: ${streamSid}`);
  }

  // True while the agent is thinking or talking, or saying goodbye.
  isAgentTurn(stream) {
    return stream.ending || stream.processingTurn || stream.pendingPlaybacks > 0 || Date.now() < (stream.listenAfter || 0);
  }

  // How much caller speech cuts the agent off, or null when it may not be interrupted.
  interruptionRule(agent) {
    if (agent?.allow_interruptions === false) return null;
    if (agent?.interruption_sensitivity && INTERRUPTION_RULES[agent.interruption_sensitivity]) {
      return INTERRUPTION_RULES[agent.interruption_sensitivity];
    }
    return agent?.type === 'incoming' ? INTERRUPTION_RULES.high : INTERRUPTION_RULES.medium;
  }

  // Whether caller audio counts towards their next turn (while the agent
  // talks it goes to watchForBargeIn instead). While the AI works on a reply
  // the caller is still heard; in a workflow those words only count if they
  // end the conversation ("not interested"), see answerHeldWords.
  hearsCaller(stream) {
    if (stream.ending) return false;
    if (stream.callerHasFloor) return true;
    if (stream.pendingPlaybacks > 0 || Date.now() < (stream.listenAfter || 0)) return false;
    if (!stream.processingTurn) return true;
    return !!stream.answering && !!this.interruptionRule(stream.agent);
  }

  // Drops buffered caller audio older than the lead-in kept before speech.
  keepLeadIn(stream) {
    let bufferedMs = stream.audioBuffer.reduce((ms, c) => ms + c.length / 8, 0);
    while (bufferedMs > PRE_ROLL_MS && stream.audioBuffer.length > 1) {
      bufferedMs -= stream.audioBuffer.shift().length / 8;
    }
  }

  // While the agent talks: clear speech from the caller stops it, and what
  // they have said so far starts their turn. The goodbye, a transfer notice and
  // the first moment of each utterance cannot be cut.
  watchForBargeIn(stream, streamSid, ws, chunk, rms) {
    const rule = this.interruptionRule(stream.agent);
    const now = Date.now();
    const current = (stream.playing || []).find(p => now < p.endsAt);
    const interruptible = rule && stream.playing?.length && !stream.pendingTerminate && !stream.pendingTransfer
      && (!current || now - current.startsAt >= BARGE_IN_GRACE_MS);
    if (!interruptible) {
      stream.bargeIn = null;
      if (stream.audioBuffer.length) {
        stream.audioBuffer = [];
        stream.isSpeaking = false;
        stream.silenceMs = 0;
        stream.speechMs = 0;
      }
      return;
    }

    const barge = stream.bargeIn || (stream.bargeIn = { speechMs: 0, silenceMs: 0 });
    const chunkMs = chunk.length / 8;
    stream.audioBuffer.push(chunk);
    if (rms > SPEECH_RMS_THRESHOLD) {
      const heard = stream.overTalk || (stream.overTalk = { peak: 0, longestMs: 0, runMs: 0 });
      heard.peak = Math.max(heard.peak, Math.round(rms));
      heard.runMs += chunkMs;
      heard.longestMs = Math.max(heard.longestMs, heard.runMs);
    } else if (stream.overTalk) {
      stream.overTalk.runMs = 0;
    }
    if (rms > rule.rms) {
      barge.speechMs += chunkMs;
      barge.silenceMs = 0;
    } else {
      barge.silenceMs += chunkMs;
      if (barge.silenceMs >= BARGE_IN_GAP_MS) barge.speechMs = 0;
    }
    if (!barge.speechMs) {
      this.keepLeadIn(stream);
      return;
    }
    if (barge.speechMs < rule.speechMs) return;

    stream.overTalk = null;
    this.interruptAgent(stream, streamSid, ws, now);
    this.giveCallerTheFloor(stream, barge);
  }

  // The caller is talking: their audio so far is kept and the turn continues
  // through the usual end-of-speech check.
  giveCallerTheFloor(stream, barge) {
    stream.bargeIn = null;
    stream.callerHasFloor = true;
    stream.isSpeaking = true;
    stream.speechMs = barge.speechMs;
    stream.silenceMs = barge.silenceMs;
    stream.quietSince = Date.now();
    stream.idleCheckedIn = false;
  }

  // Stops the agent mid-sentence. The conversation sent to the AI then shows
  // only the part the caller heard, and the rest is kept in case the caller
  // turns out to have said nothing (see resumeUnheard).
  interruptAgent(stream, streamSid, ws, now = Date.now()) {
    if (stream.turnAbort) {
      try {
        stream.turnAbort.abort();
      } catch (_) {}
      stream.turnAbort = null;
    }
    ws.send(JSON.stringify(stream.provider === 'plivo'
      ? { event: 'clearAudio', streamId: streamSid }
      : { event: 'clear', streamSid }));
    stream.playbackGen = (stream.playbackGen || 0) + 1;
    stream.pendingPlaybacks = 0;
    stream.playbackEndsAt = 0;
    stream.listenAfter = 0;
    const playing = stream.playing || [];
    stream.playing = [];

    const at = playing.findIndex(p => now < p.endsAt);
    if (at === -1) return;
    const current = playing[at];
    const { heard, rest } = this.splitSpokenText(current.text, (now - current.startsAt) / Math.max(1, current.endsAt - current.startsAt));
    const entry = [...(stream.conversationHistory || [])].reverse().find(m => m.role === 'assistant' && m.text === current.text);
    if (entry) {
      entry.text = heard || '…';
      entry.interrupted = true;
    }
    // Marked on the call's transcript with the caller's next words (processCallerTurn).
    stream.cutOff = { text: current.text, heard: heard || '' };
    const unheard = [rest, ...playing.slice(at + 1).map(p => p.text)].filter(Boolean).join(' ');
    stream.unheard = unheard ? {
      text: unheard,
      voiceId: current.voiceId,
      at: now,
      restore: entry ? () => { entry.text = current.text; entry.interrupted = false; } : null,
    } : null;
    console.log(`[Barge-in] Caller cut the agent off ${((now - current.startsAt) / 1000).toFixed(1)}s into "${current.text.substring(0, 45)}"`);
  }

  // Splits a reply where the caller stopped hearing it (fraction of its
  // playing time): the words heard, and the rest from the start of that sentence.
  splitSpokenText(text, fraction) {
    const cut = Math.round(text.length * Math.max(0, Math.min(1, fraction)));
    if (cut >= text.length) return { heard: text, rest: '' };
    const before = text.slice(0, cut);
    const lastSpace = before.lastIndexOf(' ');
    const heard = lastSpace > 0 ? `${before.slice(0, lastSpace).trim()}…` : '';
    const sentenceEnds = [...before.matchAll(/[.!?।॥]+\s+/g)];
    const last = sentenceEnds[sentenceEnds.length - 1];
    const rest = text.slice(last ? last.index + last[0].length : 0).trim();
    return { heard, rest };
  }

  // Only "hmm", "ok" and the like: the caller is listening, not taking a turn.
  isFillerOnly(text) {
    const words = String(text).toLowerCase().replace(/[.,!?।॥…'"-]+/g, ' ').split(/\s+/).filter(Boolean);
    return words.length > 0 && words.length <= 3 && words.every(w => FILLER_WORD.test(w));
  }

  // Finishes the reply the caller cut off when they said nothing after all.
  async resumeUnheard(stream, streamSid, ws, heard = '') {
    const unheard = stream.unheard;
    stream.unheard = null;
    stream.cutOff = null;
    if (!unheard || stream.ending || Date.now() - unheard.at > RESUME_WITHIN_MS) return;
    console.log(`[Barge-in] Caller said ${heard ? `only "${heard}"` : 'nothing'}; finishing the agent's reply`);
    unheard.restore?.();
    await this.speak(ws, streamSid, unheard.text, unheard.voiceId, stream.userSettings?.elevenlabs_api_key);
  }

  // Free conversation, reply ready: true when the caller has said more since,
  // so playing it would talk over them or answer half of what they said.
  callerKeptTalking(stream) {
    const rule = this.interruptionRule(stream.agent);
    return !!rule && (!!stream.heldAudio || (stream.isSpeaking && stream.speechMs >= rule.speechMs));
  }

  // Answers words the caller finished while their previous turn was still being
  // handled. A workflow has already moved on to its next question, so there
  // they only count if they end the conversation.
  answerHeldWords(streamSid, ws) {
    const stream = this.activeStreams.get(streamSid);
    if (!stream?.heldAudio || stream.processingTurn) return;
    const audio = stream.heldAudio;
    stream.heldAudio = null;
    if (stream.ending || stream.pendingTransfer) return;
    this.handleCompleteSpeech(streamSid, ws, audio, { exitsOnly: !!stream.flowId }).catch(err => console.error(err));
  }

  greetingText(agent) {
    return agent.first_message || `Hello! I'm ${agent.name}. How can I help you today?`;
  }

  // How long an outgoing call waits for the customer's hello before greeting
  // (0 = greet at once). Incoming and widget calls always greet at once.
  greetingWaitFor(agent, direction) {
    if (direction !== 'outbound' || !agent || agent.greeting_mode === 'immediate') return 0;
    return agent.hello_wait_ms || DEFAULT_HELLO_WAIT_MS;
  }

  // Follows the caller's audio until the greeting starts, to tell when they
  // have said hello and stopped.
  trackHello(stream, payload) {
    const hello = stream.hello;
    const chunk = Buffer.from(payload, 'base64');
    const chunkMs = chunk.length / 8;
    if (this.calculateUlawRMS(chunk) > SPEECH_RMS_THRESHOLD) {
      hello.speechMs += chunkMs;
      hello.silenceMs = 0;
    } else {
      hello.silenceMs += chunkMs;
      if (hello.speechMs < HELLO_MIN_SPEECH_MS && hello.silenceMs >= HELLO_END_SILENCE_MS) hello.speechMs = 0;
    }
    this.checkHello(stream);
  }

  checkHello(stream) {
    const hello = stream.hello;
    if (!hello || hello.done || hello.waitMs == null) return;
    const elapsed = Date.now() - stream.callStartTime;
    const midSpeech = hello.speechMs > 0 && hello.silenceMs < HELLO_END_SILENCE_MS;
    if (hello.speechMs >= HELLO_MIN_SPEECH_MS && !midSpeech) this.finishHello(stream, 'hello');
    else if (!midSpeech && elapsed >= hello.waitMs) this.finishHello(stream, 'silence');
    else if (elapsed >= hello.waitMs + HELLO_MAX_EXTRA_MS) this.finishHello(stream, 'kept talking');
  }

  finishHello(stream, reason) {
    const hello = stream?.hello;
    if (!hello || hello.done) return;
    hello.done = true;
    hello.timers.forEach(clearTimeout);
    if (hello.waitMs != null) {
      console.log(`[Greeting] ${reason === 'hello' ? 'Customer said hello' : `Greeting released (${reason})`}, ${Date.now() - stream.callStartTime}ms after the call connected`);
    }
    hello.waiters.forEach(resolve => resolve());
    hello.waiters = [];
  }

  // Resolves when the greeting may play: at once, or for outgoing calls set to
  // wait, once the customer has said hello or stayed silent for the wait.
  waitForGreetingTurn(stream) {
    const hello = stream?.hello;
    if (!hello || hello.done) return Promise.resolve();
    if (!stream.greetingWaitMs) {
      this.finishHello(stream, 'immediate');
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      hello.waiters.push(resolve);
      if (hello.waitMs == null) {
        hello.waitMs = stream.greetingWaitMs;
        const since = Date.now() - stream.callStartTime;
        // Caller audio drives the checks; the timers cover a stream that sends none.
        hello.timers.push(setTimeout(() => this.checkHello(stream), Math.max(0, hello.waitMs - since)));
        hello.timers.push(setTimeout(() => this.finishHello(stream, 'kept talking'), Math.max(0, hello.waitMs + HELLO_MAX_EXTRA_MS - since)));
      }
      this.checkHello(stream);
    });
  }

  // Which voice provider and voice an utterance uses: the agent's provider
  // replaces the ElevenLabs default.
  pickVoice(agent, voiceId, provider = 'elevenlabs') {
    let activeProvider = provider || 'elevenlabs';
    let activeVoiceId = voiceId;
    if (agent && (!provider || provider === 'elevenlabs')) {
      const agentProvider = agent.voice_provider === 'deepgram' || agent.telephony_provider?.startsWith('deepgram') ? 'deepgram'
        : agent.voice_provider === 'sarvam_ai' || agent.telephony_provider?.startsWith('sarvam_ai') ? 'sarvam_ai'
        : agent.voice_provider || null;
      if (agentProvider) {
        activeProvider = agentProvider;
        if (!activeVoiceId && agent.voice_id) activeVoiceId = agent.voice_id;
      }
    }
    return { activeProvider, activeVoiceId };
  }

  // Same words in another voice model or language sound different, so they are kept apart.
  ttsCacheKey(provider, voiceId, text, language, model = null) {
    const variant = provider === 'elevenlabs' ? `${elevenLabsService.resolveModel(model)}|${language || ''}` : (language || '');
    return ttsCache.keyFor(provider, voiceId, text, variant);
  }

  // Phone audio (8 kHz mu-law, base64) for text, or null when the provider has
  // no API key. requestedProvider is the provider speak() was asked for; its
  // apiKey argument only belongs to that provider.
  async synthesize({ provider, voiceId, text, settings, apiKey, language = null, model = null, requestedProvider = 'elevenlabs', deepgramApiKey = null }) {
    if (provider === 'deepgram') {
      const dgApiKey = deepgramApiKey || settings?.deepgram_api_key || deepgramService.apiKey;
      if (!dgApiKey) {
        console.warn('[TTS] No Deepgram API key found. Falling back to Twilio <Say>.');
        return null;
      }
      const mulawBuffer = await deepgramService.generateSpeech(text, voiceId || 'aura-asteria-en', {}, dgApiKey, 8000, 'mulaw');
      return mulawBuffer.toString('base64');
    }

    if (provider === 'sarvam_ai') {
      let sarvamApiKey = settings?.sarvam_ai_api_key || sarvamService.apiKey;
      if (!sarvamApiKey && apiKey && !apiKey.startsWith('sk_75') && !apiKey.startsWith('sk_f1')) {
        sarvamApiKey = apiKey;
      }
      if (!sarvamApiKey) {
        console.warn('[TTS] No Sarvam AI API key found. Falling back to Twilio <Say>.');
        return null;
      }
      const pcmBuffer = await sarvamService.generateSpeech(text, voiceId || 'shubh', {}, sarvamApiKey, 8000);
      return this.encodePcmToUlaw(pcmBuffer, pcmBuffer.sampleRate || 8000).toString('base64');
    }

    const elApiKey = (provider === requestedProvider ? apiKey : null) || settings?.elevenlabs_api_key || elevenLabsService.apiKey;
    if (!elApiKey) {
      console.warn('[TTS] No ElevenLabs API key found. Falling back to Twilio <Say>.');
      return null;
    }
    const pcmBuffer = await elevenLabsService.generateSpeech(text, voiceId || 'JBFqnCBsd6RMkjVDRZzb', { language, model }, elApiKey);
    return this.encodePcmToUlaw(pcmBuffer, 16000).toString('base64');
  }

  // Makes audio ahead of time and keeps it (memory + disk); does nothing if it
  // is already kept or already being made.
  warmSpeech({ agent, text, voiceId, settings }) {
    const { activeProvider, activeVoiceId } = this.pickVoice(agent, voiceId);
    const language = agent?.language || null;
    const model = agent?.tts_model || null;
    const key = this.ttsCacheKey(activeProvider, activeVoiceId, text, language, model);
    if (this.warming.has(key)) return this.warming.get(key);
    const job = (async () => {
      if (await ttsCache.get(key)) return;
      const audio = await this.synthesize({
        provider: activeProvider,
        voiceId: activeVoiceId,
        text,
        settings,
        language,
        model,
        apiKey: settings?.elevenlabs_api_key
      });
      if (audio) ttsCache.set(key, audio, { persist: true });
    })().finally(() => this.warming.delete(key));
    this.warming.set(key, job);
    return job;
  }

  // Makes a call's greeting audio before it is needed: while an outgoing call
  // rings, when an incoming call arrives, or when an agent is saved. Mirrors how
  // the stream 'start' handler picks the greeting: the flow's opening words when
  // the call carries a flow, otherwise the agent's first message. Never throws.
  async prepareGreeting({ agent = null, agentId = null, flowId = null, userId = null, userSettings = null } = {}) {
    try {
      const isValidId = (id) => id && db.mongoose.Types.ObjectId.isValid(String(id));
      let text;
      let voiceId;
      if (isValidId(flowId)) {
        const [flow, flowAgent] = await Promise.all([
          Flow.findById(flowId).lean(),
          Agent.findOne({ flow_id: flowId })
        ]);
        if (!flow) return;
        agent = flowAgent;
        text = automationEngine.openingMessage(flow);
        voiceId = flow.nodes?.[0]?.data?.voice_id || null;
      } else {
        if (!agent && isValidId(agentId)) agent = await Agent.findById(agentId);
        if (!agent) return;
        text = this.greetingText(agent);
        voiceId = agent.voice_id;
      }
      if (!text || !text.trim()) return;

      const ownerId = userId || agent?.user_id;
      const settings = userSettings || (ownerId ? await UserSettings.findOne({ user: ownerId }) : null);
      const startedAt = Date.now();
      await this.warmSpeech({ agent, text, voiceId, settings });
      console.log(`[Greeting] Audio ready in ${Date.now() - startedAt}ms: "${text.substring(0, 45)}"`);
    } catch (err) {
      console.warn('[Greeting] Could not prepare greeting audio:', err.message);
    }
  }

  async handlePlaybackComplete(streamSid) {
    const streamForMark = this.activeStreams.get(streamSid);
    if (streamForMark && streamForMark.pendingPlaybacks > 0) {
      streamForMark.pendingPlaybacks--;
      if (streamForMark.pendingPlaybacks === 0) {
        streamForMark.playing = [];
        // The caller spoke over the agent without cutting it off: logged so the
        // interruption sensitivity can be checked against real calls.
        const overTalk = streamForMark.overTalk;
        streamForMark.overTalk = null;
        const rule = this.interruptionRule(streamForMark.agent);
        if (overTalk && rule && overTalk.longestMs >= 100) {
          console.log(`[Barge-in] Caller spoke over the agent without cutting it off: loudest ${overTalk.peak}, longest ${Math.round(overTalk.longestMs)}ms (needs over ${rule.rms} for ${rule.speechMs}ms)`);
        }
        const barge = streamForMark.bargeIn;
        streamForMark.bargeIn = null;
        if (barge?.speechMs && !streamForMark.ending) {
          // The caller started talking as the agent finished: keep their words.
          this.giveCallerTheFloor(streamForMark, barge);
          console.log(`[Turn] Agent finished speaking, caller already talking (${streamSid})`);
        } else {
          // Short grace period so the tail of the agent's own voice is not captured.
          streamForMark.listenAfter = Date.now() + 300;
          streamForMark.audioBuffer = [];
          streamForMark.isSpeaking = false;
          streamForMark.silenceMs = 0;
          streamForMark.speechMs = 0;
          // Silence is counted from the end of the agent's reply, but not from
          // its own "are you still there?", so the call still ends on time.
          if (!streamForMark.idleCheckedIn) streamForMark.quietSince = Date.now();
          console.log(`[Turn] Agent finished speaking, listening to caller (${streamSid})`);
        }
      }
    }
    if (streamForMark && streamForMark.pendingTransfer) {
      console.log(`[Flow] Speech completed, executing pending transfer to: ${streamForMark.pendingTransfer}`);
      const client = await this.getCallControlClient(streamForMark.userId);
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
    } else if (streamForMark && streamForMark.pendingTerminate && !streamForMark.pendingPlaybacks) {
      // Only once everything queued (the goodbye last) has played.
      console.log(`[Flow] Speech completed, terminating call gracefully.`);
      streamForMark.pendingTerminate = false;
      await this.hangUp(streamForMark, 'after goodbye');
    }
  }

  async hangUp(stream, reason) {
    if (!stream?.callSid || stream.hungUp) return;
    stream.hungUp = true;
    stream.endReason = stream.endReason || reason;
    const client = await this.getCallControlClient(stream.userId);
    if (!client) return;
    try {
      await client.calls(stream.callSid).update({ status: 'completed' });
      console.log(`[Call] Hung up ${stream.callSid} (${reason})`);
    } catch (err) {
      stream.hungUp = false;
      console.error(`Error hanging up call (${reason}):`, err.message);
    }
  }

  // Says goodbye and hangs up once it has played, instead of cutting it off.
  // Only the first call to end a call counts.
  async endCallWithGoodbye(streamSid, ws, reason, text = null) {
    const stream = this.activeStreams.get(streamSid);
    if (!stream || stream.ending) return;
    stream.ending = true;
    clearInterval(stream.idleTimer);
    clearTimeout(stream.maxDurationTimer);
    const agent = stream.agent;
    console.log(`[Call] Ending call ${stream.callSid}: ${reason}`);
    stream.endReason = reason;
    stream.pendingTerminate = true;
    setTimeout(() => {
      if (this.activeStreams.has(streamSid)) this.hangUp(stream, `${reason}, goodbye did not finish`);
    }, GOODBYE_HANGUP_FALLBACK_MS).unref?.();
    await this.speak(ws, streamSid, text || agent?.goodbye_message || DEFAULT_GOODBYE, agent?.voice_id || null, stream.userSettings?.elevenlabs_api_key);
    // Nothing was queued to play (e.g. no voice key): hang up now.
    if (stream.pendingTerminate && !stream.pendingPlaybacks) {
      stream.pendingTerminate = false;
      await this.hangUp(stream, reason);
    }
  }

  // The agent's idle_timeout (seconds of silence before hanging up; 0 = off).
  idleLimitMs(agent) {
    const seconds = agent?.idle_timeout ?? DEFAULT_IDLE_TIMEOUT_S;
    return seconds > 0 ? seconds * 1000 : 0;
  }

  // Runs every few seconds while the caller's turn is open: asks once whether
  // they are still there, then ends a call that stays silent.
  checkIdle(streamSid, ws) {
    const stream = this.activeStreams.get(streamSid);
    if (!stream || stream.ending || stream.pendingTransfer || !stream.hello?.done) return;
    if (this.isAgentTurn(stream) || stream.isSpeaking) return;
    const limitMs = this.idleLimitMs(stream.agent);
    if (!limitMs) return;
    const quietMs = Date.now() - (stream.quietSince || stream.callStartTime);
    if (quietMs >= limitMs) {
      this.endCallWithGoodbye(streamSid, ws, `caller silent for ${Math.round(quietMs / 1000)}s`)
        .catch(err => console.error('[Call] Idle hang-up failed:', err.message));
    } else if (!stream.idleCheckedIn && quietMs >= Math.min(IDLE_CHECK_IN_MAX_MS, limitMs / 2)) {
      stream.idleCheckedIn = true;
      const language = String(stream.agent?.language || 'en').split(/[-_]/)[0].toLowerCase();
      this.speak(ws, streamSid, STILL_THERE[language] || STILL_THERE.en, stream.agent?.voice_id || null, stream.userSettings?.elevenlabs_api_key)
        .catch(err => console.error('[Call] Idle check-in failed:', err.message));
    }
  }

  // Starts the silence watch and the agent's max_call_duration timer, once the
  // call's agent is known.
  startCallTimers(streamSid, ws) {
    const stream = this.activeStreams.get(streamSid);
    if (!stream || stream.idleTimer) return;
    stream.quietSince = Date.now();
    stream.idleTimer = setInterval(() => this.checkIdle(streamSid, ws), IDLE_CHECK_EVERY_MS);
    const maxSeconds = stream.agent?.max_call_duration;
    if (maxSeconds > 0) {
      const leftMs = Math.max(0, maxSeconds * 1000 - (Date.now() - stream.callStartTime));
      stream.maxDurationTimer = setTimeout(() => {
        this.endCallWithGoodbye(streamSid, ws, `max call duration ${maxSeconds}s reached`)
          .catch(err => console.error('[Call] Max-duration hang-up failed:', err.message));
      }, leftMs);
    }
  }

  handleMediaStream(ws, req = null) {
    let callSid = null;
    let streamSid = null;
    let flowId = null;
    let agentId = null;
    let userId = null;
    const usage = newUsage();

    ws.on('message', (message) => runWithUsage(usage, async () => {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case 'start':
          const isPlivo = !!(msg.start.streamId || msg.streamId);
          callSid = isPlivo ? (msg.start.callId || msg.start.callUUID || msg.callId) : msg.start.callSid;
          streamSid = isPlivo ? (msg.start.streamId || msg.streamId) : msg.start.streamSid;
          let customData = msg.start.customParameters || {};
          if (isPlivo) {
            this.plivoCallIds.add(callSid);
            console.log(`[Plivo] Stream start fields: ${Object.keys(msg.start).join(', ')} | handshake headers: ${Object.keys(req?.headers || {}).join(', ')}`);
            // Plivo's extraHeaders may arrive in the start event or on the WebSocket handshake.
            customData = {
              ...this.parsePlivoExtraHeaders(req?.headers?.['x-ph-extraheaders'] || req?.headers?.['extraheaders']),
              ...Object.fromEntries(['agentid', 'userid', 'flowid', 'direction']
                .filter(key => req?.headers?.[`x-ph-${key}`] || req?.headers?.[key])
                .map(key => [{ agentid: 'agentId', userid: 'userId', flowid: 'flowId', direction: 'direction' }[key], req.headers[`x-ph-${key}`] || req.headers[key]])),
              ...this.parsePlivoExtraHeaders(msg.start.extraHeaders || msg.start.extra_headers || msg.extraHeaders)
            };
            // Last resort: plivo-inbound / plivo-xml saved the call with its agent and user.
            if (!customData.agentId && !customData.flowId && callSid) {
              const knownCall = await Call.findOne({ twilio_call_sid: callSid }).lean();
              if (knownCall) {
                customData.agentId = knownCall.agent_id?.toString();
                customData.flowId = knownCall.flow_id?.toString();
                customData.userId = knownCall.user_id?.toString();
              }
            }
          }
          flowId = customData.flowId && customData.flowId !== 'undefined' && customData.flowId !== 'null' ? customData.flowId : null;
          agentId = customData.agentId && customData.agentId !== 'undefined' && customData.agentId !== 'null' ? customData.agentId : null;
          userId = customData.userId && customData.userId !== 'undefined' && customData.userId !== 'null' ? customData.userId : null;

          usage.telephony_provider = isPlivo ? 'plivo' : 'twilio';
          this.activeStreams.set(streamSid, {
            usage,
            provider: isPlivo ? 'plivo' : 'twilio',
            callSid,
            flowId,
            agentId,
            userId,
            audioBuffer: [],
            lastProcessedAt: Date.now(),
            currentNodeId: null,
            isSpeaking: false,
            silenceMs: 0,
            speechMs: 0,
            // Hold the caller's audio until the greeting has been played.
            processingTurn: true,
            pendingPlaybacks: 0,
            conversationHistory: [],
            callStartTime: Date.now(),
            // Caller audio before the greeting, to know when they said hello (see waitForGreetingTurn).
            hello: { speechMs: 0, silenceMs: 0, done: false, waitMs: null, waiters: [], timers: [] },
            greetingWaitMs: 0
          });

          console.log(`Stream started: CallSid=${callSid}, FlowId=${flowId}, AgentId=${agentId}, UserId=${userId}`);
          const startedAt = Date.now();
          try {
            const isValidId = (id) => id && db.mongoose.Types.ObjectId.isValid(id);
            const hasFlow = isValidId(flowId);
            const hasAgent = !hasFlow && isValidId(agentId);
            // Independent lookups run together; each Atlas round trip adds to the silence before the greeting.
            const [callLog, userSettings, flow, flowAgent, directAgent] = await Promise.all([
              Call.findOne({ twilio_call_sid: callSid }),
              isValidId(userId) ? UserSettings.findOne({ user: userId }).populate('ai_model') : null,
              hasFlow ? Flow.findById(flowId) : null,
              hasFlow ? Agent.findOne({ flow_id: flowId }).populate('llm_model', 'model_id provider name') : null,
              hasAgent ? Agent.findById(agentId).populate('llm_model', 'model_id provider name') : null
            ]);
            const startStream = this.activeStreams.get(streamSid);
            if (startStream) {
              startStream.agent = hasFlow ? flowAgent : directAgent;
              startStream.userSettings = userSettings;
              startStream.aiConfig = userSettings?.ai_model ? {
                model: userSettings.ai_model.model_id,
                apiKey: userSettings.ai_api_key,
                provider: userSettings.ai_model.provider
              } : null;
              startStream.callLog = callLog;
              // The answer URL says which way the call goes; the call log is the fallback.
              startStream.greetingWaitMs = this.greetingWaitFor(startStream.agent, customData.direction || callLog?.direction);
            }
            console.log(`[Timing] Stream setup lookups took ${Date.now() - startedAt}ms`);

            if (callLog?.direction === 'inbound' && !(await creditService.hasCredits(userId))) {
              console.warn(`[Credits] User ${userId} has no credits left; hanging up inbound call ${callSid}.`);
              const client = await this.getCallControlClient(userId);
              await client?.calls(callSid).update({ status: 'completed' }).catch((e) => console.error('Hangup failed:', e.message));
              return;
            }

            if (hasFlow) {
              const agent = flowAgent;

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
                  callLog.extracted_data = {
                    ...(callLog.extracted_data || {}),
                    ...automationEngine.savedFlowData(result.final_data)
                  };
                }
                if (result.callState) callLog.conversation_state = result.callState;
                if (result.signals?.length) callLog.live_signals.push(...result.signals);
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
                  const client = await this.getCallControlClient(userId);
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
                  const client = await this.getCallControlClient(userId);
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
                  const client = await this.getCallControlClient(userId);
                  if (client && callSid) {
                    try {
                      await client.calls(callSid).update({ status: 'completed' });
                    } catch (e) {
                      console.error('Error terminating call immediately on start:', e.message);
                    }
                  }
                }
              }
            } else if (hasAgent) {
              const agent = directAgent;
              const stream = this.activeStreams.get(streamSid);

              if (agent && callLog) {
                const greeting = this.greetingText(agent);
                if (stream) {
                  stream.conversationHistory = [
                    { role: 'assistant', text: greeting }
                  ];
                }
                if (agent?.enable_call_transcription) {
                  callLog.transcript.push({ role: 'agent', text: greeting });
                }
                await this.speak(ws, streamSid, greeting, agent.voice_id, userSettings?.elevenlabs_api_key);
                await callLog.save();
              }
            }
          } catch (err) {
            console.error('Error starting stream:', err);
          } finally {
            const startStream = this.activeStreams.get(streamSid);
            if (startStream) {
              startStream.processingTurn = false;
              this.finishHello(startStream, 'no greeting');
              this.startCallTimers(streamSid, ws);
              this.answerHeldWords(streamSid, ws);
            }
            console.log(`[Timing] Greeting sent ${Date.now() - startedAt}ms after stream start`);
          }
          break;

        case 'media': {
          const stream = this.activeStreams.get(streamSid);
          if (!stream) break;
          if (!stream.hello.done) this.trackHello(stream, msg.media.payload);
          const chunk = Buffer.from(msg.media.payload, 'base64');
          const rms = this.calculateUlawRMS(chunk);

          if (stream.pendingPlaybacks > 0 && !stream.callerHasFloor && !stream.ending) {
            this.watchForBargeIn(stream, streamSid, ws, chunk, rms);
            break;
          }

          // Otherwise caller audio is dropped while the agent is busy, so its own
          // voice (echo) or an early "hello?" is not taken as an answer.
          if (!this.hearsCaller(stream)) {
            if (stream.audioBuffer.length) {
              stream.audioBuffer = [];
              stream.isSpeaking = false;
              stream.silenceMs = 0;
              stream.speechMs = 0;
            }
            break;
          }

          const chunkMs = chunk.length / 8; // 8 kHz mu-law = 8 bytes per ms

          const SPEECH_THRESHOLD = SPEECH_RMS_THRESHOLD;
          const MIN_SPEECH_MS = 150;     // ignore clicks and short noise bursts
          const END_OF_TURN_SILENCE_MS = 380;   // Snappy turn-taking: 380ms of silence marks end of turn (cuts dead air by 320ms)
          const MAX_UTTERANCE_MS = 30000; // long interview answers

          if (rms > SPEECH_THRESHOLD) {
            stream.isSpeaking = true;
            stream.silenceMs = 0;
            stream.speechMs = (stream.speechMs || 0) + chunkMs;
            stream.quietSince = Date.now();
            stream.idleCheckedIn = false;
          } else if (stream.isSpeaking) {
            stream.silenceMs = (stream.silenceMs || 0) + chunkMs;
          }

          stream.audioBuffer.push(chunk);

          if (!stream.isSpeaking) {
            this.keepLeadIn(stream);
            break;
          }

          const utteranceMs = stream.audioBuffer.reduce((ms, c) => ms + c.length / 8, 0);
          const endOfTurn = stream.silenceMs >= END_OF_TURN_SILENCE_MS || utteranceMs >= MAX_UTTERANCE_MS;
          if (!endOfTurn) break;

          // Most of the silence that ended the turn is dropped before speech-to-text.
          const joined = Buffer.concat(stream.audioBuffer);
          const trailingDropMs = Math.max(0, stream.silenceMs - TRAILING_SILENCE_KEPT_MS);
          const fullBuffer = joined.subarray(0, Math.max(0, joined.length - Math.floor(trailingDropMs * 8)));
          const wasRealSpeech = stream.speechMs >= MIN_SPEECH_MS;
          stream.audioBuffer = [];
          stream.isSpeaking = false;
          stream.silenceMs = 0;
          stream.speechMs = 0;
          stream.callerHasFloor = false;

          if (wasRealSpeech) {
            this.handleCompleteSpeech(streamSid, ws, fullBuffer).catch(err => console.error(err));
          }
          break;
        }

        case 'mark': {
          // Marks for audio that a 'clear' dropped come back too; that playback is already over.
          const markStream = this.activeStreams.get(streamSid);
          if (markStream && msg.mark?.name !== `agent-speech-${markStream.playbackGen || 0}`) break;
          await this.handlePlaybackComplete(streamSid);
          break;
        }

        case 'stop':
          this.endStream(streamSid);
          break;
      }
    }));

    ws.on('close', () => runWithUsage(usage, () => {
      console.log('Media Stream WebSocket closed');
      // Plivo does not always send a 'stop' event, so clean up on close too.
      if (streamSid) this.endStream(streamSid);
    }));

    ws.on('error', (err) => {
      console.error('Twilio Media Stream WebSocket error:', err.message);
    });
  }

  // One caller turn at a time. Words the caller finishes while a turn is still
  // being handled are held and answered right after it.
  async handleCompleteSpeech(streamSid, ws, audioBuffer, opts = {}) {
    const stream = this.activeStreams.get(streamSid);
    if (!stream) return;
    if (stream.processingTurn) {
      stream.heldAudio = stream.heldAudio ? Buffer.concat([stream.heldAudio, audioBuffer]) : audioBuffer;
      return;
    }
    stream.processingTurn = true;
    stream.answering = true;
    const turnStartedAt = Date.now();
    try {
      await this.processCallerTurn(stream, streamSid, ws, audioBuffer, opts);
    } finally {
      stream.processingTurn = false;
      stream.answering = false;
      console.log(`[Timing] Caller turn handled in ${Date.now() - turnStartedAt}ms`);
    }
    this.answerHeldWords(streamSid, ws);
  }

  // Saves what the caller made clear ("not interested", "call me at 6") and
  // where the workflow conversation stands, straight away: a transfer or a
  // hang-up may follow before the call log is saved again.
  async saveConversationProgress(callLog, result) {
    const update = { $set: { conversation_state: result.callState || {} } };
    if (result.signals?.length) {
      update.$push = { live_signals: { $each: result.signals } };
      console.log(`[Flow] Caller: ${result.signals.map(sg => sg.type).join(', ')}`);
    }
    await Call.updateOne({ _id: callLog._id }, update).catch(err => console.error('[Flow] Could not save conversation progress:', err.message));
  }

  async processCallerTurn(stream, streamSid, ws, audioBuffer, { exitsOnly = false } = {}) {
    if (stream.ending) return;
    const text = await this.processSTT(audioBuffer, stream.userId, stream.agentId, stream.flowId, stream);
    if (stream.ending) return;
    // The agent was cut off by a noise or only a "hmm": it finishes what it was saying.
    if (!text || !text.trim() || (stream.unheard && this.isFillerOnly(text))) {
      await this.resumeUnheard(stream, streamSid, ws, text ? text.trim() : '');
      return;
    }
    stream.unheard = null;
    const cutOff = stream.cutOff;
    stream.cutOff = null;

    console.log(`Processing complete sentence: "${text}"${exitsOnly ? ' (said while the agent was busy)' : ''}`);

    let currentAgentForChecks = stream.agent || null;
    if (!currentAgentForChecks) {
      if (stream.agentId) {
        currentAgentForChecks = await Agent.findById(stream.agentId).populate('llm_model', 'model_id provider name');
      } else if (stream.flowId) {
        currentAgentForChecks = await Agent.findOne({ flow_id: stream.flowId }).populate('llm_model', 'model_id provider name');
      }
      if (currentAgentForChecks) stream.agent = currentAgentForChecks;
    }

    let earlyUserSettings = stream.userSettings || null;

    if (currentAgentForChecks) {
      if (currentAgentForChecks.max_call_duration && stream.callStartTime) {
        const elapsedSeconds = Math.floor((Date.now() - stream.callStartTime) / 1000);
        if (elapsedSeconds >= currentAgentForChecks.max_call_duration) {
          await this.endCallWithGoodbye(streamSid, ws, `max call duration ${currentAgentForChecks.max_call_duration}s reached`,
            currentAgentForChecks.goodbye_message || 'Thank you for your time. Goodbye!');
          return;
        }
      }
    }

    // Whole words only: substring matching hung up on answers containing
    // "execute" (cut), "stopped" (stop) or "bypass" (bye).
    const hangupPattern = /\b(hang ?up|cut the call|end the call|stop the call|goodbye|bye)\b|\[phone (hangs up|hanging up|clicks)\]/i;
    const isHangup = hangupPattern.test(text);

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

          const client = await this.getCallControlClient(stream.userId);
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
                const callLog = stream.callLog || await Call.findOne({ twilio_call_sid: stream.callSid });
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
                  Call.updateOne({ _id: callLog._id }, { $set: { is_transferred: true, transfer_member_id: callLog.transfer_member_id, transfer_details: callLog.transfer_details } }).catch(() => {});
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
      await this.endCallWithGoodbye(streamSid, ws, 'caller said goodbye', currentAgentForChecks?.goodbye_message);
      return;
    }

    try {
      const currentCallLog = stream.callLog || await Call.findOne({ twilio_call_sid: stream.callSid });
      const userSettings = stream.userSettings || (stream.userId ? await UserSettings.findOne({ user: stream.userId }).populate('ai_model') : null);
      const aiConfig = stream.aiConfig || (userSettings?.ai_model ? {
        model: userSettings.ai_model.model_id,
        apiKey: userSettings.ai_api_key,
        provider: userSettings.ai_model.provider
      } : null);

      if (!currentCallLog) return;
      
      const violenceWords = await getActiveViolenceWords();
      let detectedWords = [];
      if (violenceWords.length > 0) {
        const textLower = text.toLowerCase();
        detectedWords = violenceWords
          .filter(vw => textLower.includes(vw.word.toLowerCase()))
          .map(vw => vw.word);
          
        if (detectedWords.length > 0) {
          currentCallLog.detected_words = [...new Set([...(currentCallLog.detected_words || []), ...detectedWords])];
          if (currentCallLog.transcript_snippet) {
            currentCallLog.transcript_snippet += ` | ${text}`;
          } else {
            currentCallLog.transcript_snippet = text;
          }
        }
      }

      // The caller cut the agent off: the transcript shows how much they heard.
      if (cutOff) {
        const line = [...(currentCallLog.transcript || [])].reverse().find(m => m.role === 'agent' && m.text === cutOff.text);
        if (line) {
          line.interrupted = true;
          line.heard = cutOff.heard;
        }
      }

      if (currentAgentForChecks?.enable_call_transcription !== false) {
        currentCallLog.transcript.push({ role: 'user', text: text });
      }

      // Save user transcript asynchronously without blocking the AI speech loop
      Call.updateOne(
        { _id: currentCallLog._id },
        {
          $set: {
            transcript: currentCallLog.transcript,
            ...(detectedWords.length ? { detected_words: currentCallLog.detected_words, transcript_snippet: currentCallLog.transcript_snippet } : {})
          }
        }
      ).catch(err => console.error('[CallLog] Background transcript save error:', err.message));

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
              form_id: currentCallLog.extracted_data?.form_id || null,
              call_state: currentCallLog.conversation_state || {},
              exits_only: exitsOnly
            },
            stream.currentNodeId
          );

          if (result.ignored) {
            console.log('[Flow] Words said while the agent was busy did not end the conversation; not answered');
            return;
          }
          stream.currentNodeId = result.currentNodeId;
          await this.saveConversationProgress(currentCallLog, result);

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
            const client = await this.getCallControlClient(stream.userId);
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
            const client = await this.getCallControlClient(stream.userId);
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
            const client = await this.getCallControlClient(stream.userId);
            if (client && stream.callSid) {
              try {
                await client.calls(stream.callSid).update({ status: 'completed' });
              } catch (e) {
                console.error('Error terminating call immediately:', e.message);
              }
            }
          }

          if (result.final_data) {
            currentCallLog.extracted_data = {
              ...(currentCallLog.extracted_data || {}),
              ...automationEngine.savedFlowData(result.final_data)
            };
          }
          await currentCallLog.save();
        }
      } else if (stream.agentId) {
        const currentAgent = stream.agent || currentAgentForChecks || (stream.agentId ? await Agent.findById(stream.agentId).populate('llm_model', 'model_id provider name') : null);

        if (currentAgent) {
          if (!stream.conversationHistory) stream.conversationHistory = [];
          stream.conversationHistory.push({ role: 'user', text });

          // The whole history is sent every turn, so long calls keep only the
          // latest turns. The caller's last words are its final line.
          const conversationContext = stream.conversationHistory
            .slice(-HISTORY_TURNS_SENT)
            .map(m => `${m.role === 'user' ? 'User' : m.interrupted ? 'Assistant (cut off by the caller)' : 'Assistant'}: ${m.text}`)
            .join('\n');

          const fullPrompt = `Conversation so far:\n${conversationContext}\n\nReply to the user's last message.`;

          let systemPrompt = currentAgent.system_prompt || currentAgent.personality || '';
          if (currentAgent.custom_knowledge_base) {
            systemPrompt += `\n\nADDITIONAL KNOWLEDGE BASE:\n${currentAgent.custom_knowledge_base}`;
          }
          systemPrompt += `\n\n${CALL_HANDLING_RULES}`;

          const turnAbort = new AbortController();
          stream.turnAbort = turnAbort;

          let fullResponseText = '';
          let endsCall = false;
          let firstSentenceDispatched = false;

          // Sequential sentence playback queue: ensures sentence 2 starts synthesizing
          // while sentence 1 is playing, but audio chunks are sent to Plivo in correct order
          let speakPromiseChain = Promise.resolve();

          const handleSentence = async (sentence) => {
            if (turnAbort.signal.aborted || stream.ending) return;
            let cleanSentence = (sentence || '').replace(/^\s*(assistant|agent|ai)\s*(\([^)]*\))?\s*:\s*/i, '').trim();
            if (cleanSentence.includes(END_CALL_MARK)) {
              endsCall = true;
              cleanSentence = cleanSentence.split(END_CALL_MARK).join(' ').replace(/\s+/g, ' ').trim();
            }
            if (!cleanSentence) return;

            // If caller began speaking while sentence was generating: hold back!
            if (this.callerKeptTalking(stream)) {
              console.log('[Barge-in] Caller kept talking while reply was generating; reply held back');
              turnAbort.abort();
              stream.unheard = {
                text: cleanSentence,
                voiceId: currentAgent.voice_id,
                at: Date.now(),
                restore: () => stream.conversationHistory.push({ role: 'assistant', text: cleanSentence }),
              };
              return;
            }

            fullResponseText += (fullResponseText ? ' ' : '') + cleanSentence;
            firstSentenceDispatched = true;

            // Chain speak promises sequentially so utterances queue smoothly
            speakPromiseChain = speakPromiseChain.then(async () => {
              if (turnAbort.signal.aborted || stream.ending) return;
              if (endsCall) {
                await this.endCallWithGoodbye(streamSid, ws, 'agent said goodbye', cleanSentence);
              } else {
                await this.speak(ws, streamSid, cleanSentence, currentAgent.voice_id, userSettings?.elevenlabs_api_key);
              }
            }).catch(err => console.error('[Voice] Speak chunk error:', err.message));
          };

          const rawResponse = await llmService.streamResponseWithSystemPrompt({
            prompt: fullPrompt,
            systemPrompt,
            model: aiConfig?.model || currentAgent.llm_model?.model_id,
            aiConfig,
            agentConfig: {
              empathy_level: currentAgent.empathy_level,
              energy_level: currentAgent.energy_level,
              response_length: currentAgent.response_length,
              intelligence_level: currentAgent.intelligence_level
            },
            onSentence: handleSentence,
            signal: turnAbort.signal
          });

          // Wait for any remaining chained speak promises to complete synthesis
          await speakPromiseChain;

          // If streaming didn't dispatch (e.g. non-streaming fallback returned full text)
          if (!firstSentenceDispatched && rawResponse && rawResponse.trim() && !turnAbort.signal.aborted) {
            let labelled = rawResponse.replace(/^\s*(assistant|agent|ai)\s*(\([^)]*\))?\s*:\s*/i, '');
            if (labelled.includes(END_CALL_MARK)) {
              endsCall = true;
              labelled = labelled.split(END_CALL_MARK).join(' ').replace(/\s+/g, ' ').trim();
            }
            const nextResponse = labelled.trim();
            if (nextResponse) {
              if (this.callerKeptTalking(stream)) {
                stream.unheard = {
                  text: nextResponse,
                  voiceId: currentAgent.voice_id,
                  at: Date.now(),
                  restore: () => stream.conversationHistory.push({ role: 'assistant', text: nextResponse }),
                };
              } else {
                fullResponseText = nextResponse;
                if (endsCall) {
                  await this.endCallWithGoodbye(streamSid, ws, 'agent said goodbye', nextResponse);
                } else {
                  await this.speak(ws, streamSid, nextResponse, currentAgent.voice_id, userSettings?.elevenlabs_api_key);
                }
              }
            }
          }

          if (fullResponseText && !turnAbort.signal.aborted) {
            stream.conversationHistory.push({ role: 'assistant', text: fullResponseText });
            if (currentAgent.enable_call_transcription !== false) {
              if (currentAgent?.enable_call_transcription) {
                currentCallLog.transcript.push({ role: 'agent', text: fullResponseText });
              }
              Call.updateOne(
                { _id: currentCallLog._id },
                { $set: { transcript: currentCallLog.transcript } }
              ).catch(err => console.error('[CallLog] Background transcript update error:', err.message));
            }
          }
        }
      }
    } catch (err) {
      console.error('Error handling complete speech:', err);
    }
  }

  async processSTT(buffer, userId, agentId = null, flowId = null, stream = null) {
    try {
      const validUserId = (userId && userId !== 'undefined' && userId !== 'null' && db.mongoose.Types.ObjectId.isValid(userId)) ? userId : null;
      const userSettings = stream?.userSettings || (validUserId ? await UserSettings.findOne({ user: validUserId }) : null);
      let agent = stream?.agent || null;
      if (!agent) {
        if (agentId && agentId !== 'undefined' && agentId !== 'null' && db.mongoose.Types.ObjectId.isValid(agentId)) {
          agent = await Agent.findById(agentId);
        } else if (flowId && flowId !== 'undefined' && flowId !== 'null' && db.mongoose.Types.ObjectId.isValid(flowId)) {
          agent = await Agent.findOne({ flow_id: flowId });
        }
      }

      const provider = agent?.voice_provider || (agent?.telephony_provider?.startsWith('deepgram') ? 'deepgram' : (agent?.telephony_provider?.startsWith('sarvam_ai') ? 'sarvam_ai' : 'elevenlabs'));
      recordUsage({ stt_provider: provider, stt_seconds: buffer.length / 8000 });

      const noiseTokens = ['[background noise]', '[pause]', '[laughs]', '[clicking]', '[phone ringing]', '[phone beeping]', '[outro jingle]', '[silence]', '[phone hangs up]', '[phone hanging up]', '[phone clicks]'];

      if (provider === 'deepgram') {
        const apiKey = userSettings?.deepgram_api_key;
        const wavBuffer = this.createUlawWav(buffer);
        deepgramService.saveAudio(wavBuffer, `inbound_${Date.now()}.wav`).catch(() => {});
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
        sarvamService.saveAudio(wavBuffer, `inbound_${Date.now()}.wav`).catch(() => {});
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
        elevenLabsService.saveAudio(wavBuffer, `inbound_${Date.now()}.mp3`).catch(() => {});
        const languageCode = agent?.language ? String(agent.language).split(/[-_]/)[0].toLowerCase() : null;
        const text = await elevenLabsService.transcribeAudio(wavBuffer, apiKey, languageCode);
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
      let agent = null;
      if (stream && (!provider || provider === 'elevenlabs')) {
        agent = stream.agent || null;
        if (!agent && stream.agentId) agent = await Agent.findById(stream.agentId);
        else if (!agent && stream.flowId) agent = await Agent.findOne({ flow_id: stream.flowId });
      }
      const { activeProvider, activeVoiceId } = this.pickVoice(agent, voiceId, provider);

      // The first words of a call are its greeting: the same on most calls, so
      // they are kept across restarts (often made ahead by prepareGreeting).
      const isGreeting = !!stream?.hello && !stream.hello.done;
      const language = agent?.language || null;
      const model = agent?.tts_model || null;
      const cacheKey = this.ttsCacheKey(activeProvider, activeVoiceId, text, language, model);
      let base64Audio = await ttsCache.get(cacheKey);
      if (!base64Audio && this.warming.has(cacheKey)) {
        await this.warming.get(cacheKey).catch(() => {});
        base64Audio = await ttsCache.get(cacheKey);
      }

      if (base64Audio) {
        console.log(`[TTS Cache HIT] Instant 0ms speech playback for: "${text.substring(0, 45)}..."`);
      } else {
        const settings = stream?.userSettings || (stream?.userId ? await UserSettings.findOne({ user: stream.userId }) : null);
        base64Audio = await this.synthesize({
          provider: activeProvider,
          voiceId: activeVoiceId,
          text,
          settings,
          apiKey,
          language,
          model,
          requestedProvider: provider,
          deepgramApiKey
        });
        if (!base64Audio) {
          await this.waitForGreetingTurn(stream);
          return await this.speakViaTwiml(streamSid, text);
        }
        recordUsage({ tts_provider: activeProvider, tts_characters: text.length });
        ttsCache.set(cacheKey, base64Audio, { persist: isGreeting });
      }

      // The audio is made while waiting for the customer's hello, then sent.
      await this.waitForGreetingTurn(stream);
      if (!this.activeStreams.has(streamSid)) return;
      if (!stream.callerHasFloor) stream.audioBuffer = [];
      this.sendAgentAudio(ws, streamSid, base64Audio, { text, voiceId });
    } catch (err) {
      console.error(`[${provider || 'ElevenLabs'}] TTS failed, falling back to Twilio <Say>:`, err.message);
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

      const client = await this.getCallControlClient(stream.userId);
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

    // G.711 segment s holds biased values below 256 << s.
    for (seg = 0; seg < 8; seg++) {
      if (pcm < (256 << seg)) break;
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
      // What happened on the call: summary, outcome, details (after the call is marked complete).
      require('./outcomeService').request(call._id).catch(() => {});

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
          contact_id: call.contact_id || null,
          phone: call.direction === 'inbound' ? call.from_number : call.to_number,
          agent_id: call.agent_id || null,
          campaign_id: call.campaign_id || null,
          direction: call.direction,
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

      // No follow-up message to someone who asked not to be contacted, on this call or before.
      const optedOut = (call.live_signals || []).some(sg => sg.type === 'do_not_call')
        || (call.contact_id && require('../utils/doNotContact').isDoNotContact(await db.Contact.findById(call.contact_id).lean()));
      const userSettings = optedOut ? null : await UserSettings.findOne({ user: userId });
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