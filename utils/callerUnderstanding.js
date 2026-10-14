'use strict';

// Understands the caller's reply before a workflow step uses it, so the call
// follows the person instead of a fixed script: "not interested" gets one
// offer of a better time and a polite goodbye, "call me later" gets a callback
// time, "hello?" gets the question again in other words, a side question gets
// a short answer, and after too many unclear replies the call ends politely.
// Each of these is recorded on the call as a live signal for its outcome.

const llmService = require('../services/llmService');
const { cleanFieldValue } = require('./fieldValue');

// Steps that wait for the caller's words.
const LISTENING_NODES = ['input_capture', 'data_capture'];
const DEFAULT_MAX_REASKS = 2;
const MAX_REPEATS = 3;
// Callbacks are only placed between 10 AM and 9 PM, India time.
const CALL_START_HOUR = 10;
const CALL_END_HOUR = 21;
const IST_OFFSET_MS = 330 * 60 * 1000;

const LANGUAGE_NAMES = {
  en: 'English', hi: 'Hindi', kn: 'Kannada', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam',
  mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', or: 'Odia'
};

// What the agent says on the way out, in the agent's language.
const LINES = {
  en: {
    better_time: 'No problem. Would another time suit you better?',
    ask_time: 'Sure. What time should we call you back?',
    callback: 'Sure, we will call you back {when}. Thank you!',
    later_today: 'later today',
    tomorrow_morning: 'tomorrow morning',
    not_interested: 'No problem. Thank you for your time, have a good day.',
    wrong_person: 'Sorry for the trouble. Have a good day.',
    do_not_call: 'Understood, we will not call you again. Thank you.',
    transfer: 'Sure, connecting you to our team now.',
    team_callback: 'Sure, someone from our team will call you back shortly. Thank you!',
    couldnt_understand: "Sorry, I'm having trouble understanding. Someone from our team will get back to you. Thank you!",
    didnt_catch: "Sorry, I didn't catch that."
  },
  hi: {
    better_time: 'कोई बात नहीं। क्या किसी और समय बात करना आपके लिए ठीक रहेगा?',
    ask_time: 'ज़रूर। हम आपको किस समय कॉल करें?',
    callback: 'ठीक है, हम आपको {when} कॉल करेंगे। धन्यवाद!',
    later_today: 'आज थोड़ी देर बाद',
    tomorrow_morning: 'कल सुबह',
    not_interested: 'कोई बात नहीं। आपके समय के लिए धन्यवाद, आपका दिन शुभ हो।',
    wrong_person: 'परेशानी के लिए माफ़ कीजिए। आपका दिन शुभ हो।',
    do_not_call: 'ठीक है, हम आपको दोबारा कॉल नहीं करेंगे। धन्यवाद।',
    transfer: 'ज़रूर, आपको हमारी टीम से जोड़ा जा रहा है।',
    team_callback: 'ज़रूर, हमारी टीम से कोई आपको जल्द ही कॉल करेगा। धन्यवाद!',
    couldnt_understand: 'माफ़ कीजिए, मुझे ठीक से समझ नहीं आ रहा। हमारी टीम आपसे जल्द संपर्क करेगी। धन्यवाद!',
    didnt_catch: 'माफ़ कीजिए, यह ठीक से सुनाई नहीं दिया।'
  },
  kn: {
    better_time: 'ಪರವಾಗಿಲ್ಲ. ಬೇರೆ ಸಮಯದಲ್ಲಿ ಮಾತನಾಡುವುದು ನಿಮಗೆ ಅನುಕೂಲವೇ?',
    ask_time: 'ಖಂಡಿತ. ನಿಮಗೆ ಯಾವ ಸಮಯದಲ್ಲಿ ಮತ್ತೆ ಕರೆ ಮಾಡಬೇಕು?',
    callback: 'ಸರಿ, ನಾವು ನಿಮಗೆ {when} ಕರೆ ಮಾಡುತ್ತೇವೆ. ಧನ್ಯವಾದಗಳು!',
    later_today: 'ಇಂದು ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ',
    tomorrow_morning: 'ನಾಳೆ ಬೆಳಿಗ್ಗೆ',
    not_interested: 'ಪರವಾಗಿಲ್ಲ. ನಿಮ್ಮ ಸಮಯಕ್ಕೆ ಧನ್ಯವಾದಗಳು. ಶುಭ ದಿನ.',
    wrong_person: 'ತೊಂದರೆಗಾಗಿ ಕ್ಷಮಿಸಿ. ಶುಭ ದಿನ.',
    do_not_call: 'ಸರಿ, ನಾವು ನಿಮಗೆ ಮತ್ತೆ ಕರೆ ಮಾಡುವುದಿಲ್ಲ. ಧನ್ಯವಾದಗಳು.',
    transfer: 'ಖಂಡಿತ, ನಿಮ್ಮನ್ನು ನಮ್ಮ ತಂಡಕ್ಕೆ ಸಂಪರ್ಕಿಸಲಾಗುತ್ತಿದೆ.',
    team_callback: 'ಖಂಡಿತ, ನಮ್ಮ ತಂಡದವರು ಶೀಘ್ರದಲ್ಲೇ ನಿಮಗೆ ಕರೆ ಮಾಡುತ್ತಾರೆ. ಧನ್ಯವಾದಗಳು!',
    couldnt_understand: 'ಕ್ಷಮಿಸಿ, ನನಗೆ ಸರಿಯಾಗಿ ಅರ್ಥವಾಗುತ್ತಿಲ್ಲ. ನಮ್ಮ ತಂಡದವರು ಶೀಘ್ರದಲ್ಲೇ ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ. ಧನ್ಯವಾದಗಳು!',
    didnt_catch: 'ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ.'
  }
};

const languageOf = (agent) => String(agent?.language || 'en').split(/[-_]/)[0].toLowerCase();
const say = (lang, key, vars = {}) => (LINES[lang]?.[key] || LINES.en[key]).replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? '');

// "Great! To start, could you…" asked again is just "Could you…".
function stripFiller(question) {
  let q = String(question || '').trim();
  const filler = /^(great|okay|ok|sure|perfect|alright|awesome|wonderful|excellent|got it|thank you|thanks|nice|good)\b[!.,]*\s*/i;
  const opener = /^(to start|to begin|first|firstly|next|now|lastly|finally|so)\b[,:]?\s*/i;
  for (let i = 0; i < 3; i++) q = q.replace(filler, '').replace(opener, '');
  return q ? q.charAt(0).toUpperCase() + q.slice(1) : String(question || '');
}

// India time parts of a date.
const istParts = (date) => {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes() };
};
const istDate = (y, m, day, h, min = 0) => new Date(Date.UTC(y, m, day, h, min) - IST_OFFSET_MS);

// The next moment inside calling hours, at or after `date`.
function intoCallingHours(date) {
  const p = istParts(date);
  if (p.h < CALL_START_HOUR) return istDate(p.y, p.m, p.day, CALL_START_HOUR);
  if (p.h >= CALL_END_HOUR) return istDate(p.y, p.m, p.day + 1, CALL_START_HOUR);
  return date;
}

// When the caller gave no usable time: in 2 hours if that's within calling
// hours, otherwise 11 AM on the next calling day.
function defaultCallback(now = new Date()) {
  const inTwoHours = new Date(now.getTime() + 2 * 3600 * 1000);
  const p = istParts(inTwoHours);
  const n = istParts(now);
  if (p.h >= CALL_START_HOUR && p.h < CALL_END_HOUR && n.day === p.day) return { at: inTwoHours, when: 'later_today' };
  // Early morning: 11 AM today; otherwise 11 AM tomorrow.
  if (n.h < CALL_START_HOUR - 1) return { at: istDate(n.y, n.m, n.day, 11), when: 'later_today' };
  return { at: istDate(n.y, n.m, n.day + 1, 11), when: 'tomorrow_morning' };
}

// The callback time the caller asked for, moved into calling hours, or the default.
function callbackFrom(understood, now = new Date()) {
  const asked = understood?.callback_time ? new Date(`${understood.callback_time}:00+05:30`) : null;
  if (!asked || Number.isNaN(asked.getTime()) || asked.getTime() < now.getTime() + 5 * 60 * 1000) {
    return { ...defaultCallback(now), asked: false };
  }
  const at = intoCallingHours(asked);
  if (at.getTime() !== asked.getTime()) return { at, when: null, asked: true, moved: true };
  return { at, when: null, spoken: understood.callback_spoken, asked: true };
}

function spokenWhen(lang, cb) {
  if (cb.when) return say(lang, cb.when);
  if (cb.spoken && !cb.moved) return cb.spoken;
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true }).format(cb.at);
}

// The question this step is waiting on, and the shape of its answer.
async function questionFor(node, data) {
  const state = data.call_state || {};
  if (node.type === 'data_capture' && node.data?.form_id) {
    const { db } = require('../models');
    const form = await db.Form.findById(node.data.form_id).lean().catch(() => null);
    const f = form?.fields?.[data.current_field_index || 0];
    if (f) return { question: f.question, type: f.type || 'text', options: f.options || [], required: f.required !== false, field: f };
  }
  if (node.type === 'data_capture') {
    return { question: node.data?.question || node.data?.text || node.data?.description, type: node.data?.field_type || 'open', options: [], required: node.data?.required !== false };
  }
  return { question: state.last_question || node.data?.description || node.data?.text, type: 'yes/no or open', options: [], required: true };
}

const businessInfo = (agent) => [agent?.system_prompt, agent?.custom_knowledge_base].filter(Boolean).join('\n\n');

class CallerUnderstanding {
  constructor() {
    this.LISTENING_NODES = LISTENING_NODES;
    this.stripFiller = stripFiller;
    this.callbackFrom = callbackFrom;
    this.defaultCallback = defaultCallback;
  }

  isOn(flow) {
    return flow?.settings?.understand_caller !== false;
  }

  maxReasks(flow) {
    const n = Number(flow?.settings?.max_reasks);
    return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 5) : DEFAULT_MAX_REASKS;
  }

  // Reads the caller's reply at a listening step. Returns either
  //   { proceed: true, understood }  - an answer: the step runs with it, or
  //   { stop: {...} }                - what to say instead (and whether the call ends).
  // understood is null when the AI couldn't be reached: the step then runs as before.
  async handle({ flow, node, data, now = new Date() }) {
    const prior = data.call_state || {};
    const state = { ...prior, reasks: { ...(prior.reasks || {}) }, repeats: { ...(prior.repeats || {}) } };
    const agent = data.agent || {};
    const lang = languageOf(agent);
    const said = data.user_input;
    const signal = (type, extra = {}) => ({ type, said, node_id: node.id, at: now, ...extra });

    // A follow-up question of our own is waiting for its answer.
    if (state.awaiting) return this.handleAwaiting({ state, lang, said, data, node, now, signal });

    const q = await questionFor(node, data);
    const understood = await llmService.understandReply({
      said, question: q.question, type: q.type, options: q.options,
      language: LANGUAGE_NAMES[lang] || 'English', business: businessInfo(agent), now, aiConfig: data.aiConfig
    });
    if (!understood) return { proceed: true, understood: null };

    const reask = understood.reask || stripFiller(q.question);
    const unclear = async () => {
      const used = (state.reasks[node.id] || 0) + 1;
      state.reasks[node.id] = used;
      if (used > this.maxReasks(flow)) {
        if (!q.required && node.type === 'data_capture') return { proceed: true, understood: { ...understood, value: null, skipped: true, node_id: node.id }, state };
        return { stop: { say: say(lang, 'couldnt_understand'), endCall: true, state, signals: [signal('couldnt_understand')] } };
      }
      return { stop: { say: `${say(lang, 'didnt_catch')} ${reask}`, state } };
    };

    switch (understood.intent) {
      case 'answer': {
        if (node.type === 'data_capture') {
          // A typed field (form, or a step with field_type) is checked; otherwise the AI's value is kept as given.
          const typed = q.field || (q.type !== 'open' ? { type: q.type, options: q.options } : null);
          const raw = understood.value;
          const value = typed ? cleanFieldValue(typed, raw) : (raw === '' || raw === undefined ? null : raw);
          if (value === null) {
            if (!q.required) return { proceed: true, understood: { ...understood, value: null, skipped: true, node_id: node.id }, state };
            return unclear();
          }
          state.reasks[node.id] = 0;
          return { proceed: true, understood: { ...understood, value, node_id: node.id }, state };
        }
        // A "no" to "are you ready?" means not now.
        if (understood.confirmed === false) return this.askForTime({ state, lang, signal });
        state.reasks[node.id] = 0;
        return { proceed: true, understood: { ...understood, node_id: node.id }, state };
      }
      case 'repeat': {
        const used = (state.repeats[node.id] || 0) + 1;
        state.repeats[node.id] = used;
        if (used > MAX_REPEATS) return unclear();
        return { stop: { say: reask, state } };
      }
      case 'question':
        return { stop: { say: [understood.reply, reask].filter(Boolean).join(' '), state } };
      case 'not_interested':
        if (state.offered_later) {
          return { stop: { say: say(lang, 'not_interested'), endCall: true, state, signals: [signal('not_interested')] } };
        }
        state.offered_later = true;
        state.awaiting = 'better_time';
        return { stop: { say: say(lang, 'better_time'), state, signals: [signal('not_interested_offered_later')] } };
      case 'call_later':
        if (understood.callback_time) return this.confirmCallback({ state, lang, understood, now, signal });
        return this.askForTime({ state, lang, signal });
      case 'wrong_person':
        return { stop: { say: say(lang, 'wrong_person'), endCall: true, state, signals: [signal('wrong_person')] } };
      case 'do_not_call':
        return { stop: { say: say(lang, 'do_not_call'), endCall: true, state, signals: [signal('do_not_call')] } };
      case 'wants_human':
        return this.handOver({ state, lang, agent, signal, canTransfer: data.can_transfer !== false });
      default:
        return unclear();
    }
  }

  askForTime({ state, lang, signal }) {
    state.awaiting = 'callback_time';
    return { stop: { say: say(lang, 'ask_time'), state, signals: [signal('call_later')] } };
  }

  confirmCallback({ state, lang, understood, now, signal }) {
    const cb = callbackFrom(understood, now);
    state.awaiting = null;
    return {
      stop: {
        say: say(lang, 'callback', { when: spokenWhen(lang, cb) }),
        endCall: true,
        state,
        signals: [signal('call_later', { callback_at: cb.at, callback_asked: cb.asked })]
      }
    };
  }

  // The reply to "would another time suit you better?" or "what time should we call?".
  async handleAwaiting({ state, lang, said, data, node, now, signal }) {
    const awaiting = state.awaiting;
    const question = say(lang, awaiting === 'better_time' ? 'better_time' : 'ask_time');
    const understood = await llmService.understandReply({
      said, question, type: awaiting === 'better_time' ? 'yes_no' : 'time to call back',
      language: LANGUAGE_NAMES[lang] || 'English', now, aiConfig: data.aiConfig
    });
    state.awaiting = null;
    const intent = understood?.intent;

    if (intent === 'do_not_call') return { stop: { say: say(lang, 'do_not_call'), endCall: true, state, signals: [signal('do_not_call')] } };
    if (understood?.callback_time) return this.confirmCallback({ state, lang, understood, now, signal });
    if (awaiting === 'better_time') {
      if (understood?.confirmed === true || intent === 'call_later') return this.askForTime({ state, lang, signal });
      return { stop: { say: say(lang, 'not_interested'), endCall: true, state, signals: [signal('not_interested')] } };
    }
    // Asked for a time and got none: refused, or a callback at the default time.
    if (intent === 'not_interested' || understood?.confirmed === false) {
      return { stop: { say: say(lang, 'not_interested'), endCall: true, state, signals: [signal('not_interested')] } };
    }
    return this.confirmCallback({ state, lang, understood: null, now, signal });
  }

  // Transfer when the agent has a team member set up for it; otherwise a team callback.
  async handOver({ state, lang, agent, signal, canTransfer = true }) {
    const transfer = agent?.transfer_to_human;
    if (canTransfer && transfer?.enabled && transfer.member_id) {
      const { db } = require('../models');
      const member = await db.TeamMember.findById(transfer.member_id).lean().catch(() => null);
      if (member?.phone_number) {
        return {
          stop: {
            transfer: { transfer_to: member.phone_number, transfer_text: say(lang, 'transfer'), member_id: member._id },
            state,
            signals: [signal('wants_human', { transferred: true })]
          }
        };
      }
    }
    return { stop: { say: say(lang, 'team_callback'), endCall: true, state, signals: [signal('wants_human')] } };
  }
}

module.exports = new CallerUnderstanding();
module.exports.LINES = LINES;
