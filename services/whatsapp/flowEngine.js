'use strict';

const dns = require('dns').promises;
const net = require('net');
const axios = require('axios');
const { db } = require('../../models');
const { WhatsappFlow, WhatsappFlowRun, WhatsappConversation, WhatsappInboxSetting, Contact, Agent, Appointment, AppointmentSetting } = db;
const inbox = require('./inbox');
const ai = require('./ai');
const meta = require('./meta');
const appointmentService = require('../appointmentService');
const outboundCallService = require('../outboundCallService');
const { sendNotification } = require('../../utils/notificationHelper');
const realtime = require('../../utils/realtime');

const MAX_STEPS = 50;
const TIMEZONE = 'Asia/Kolkata';
const MAX_DELAY_MS = 23 * 60 * 60 * 1000; // Bot messages need the 24-hour window.

// ---------------------------------------------------------------------------
// Helpers

// Messages for one conversation are handled one at a time, in order.
const locks = new Map();
const withLock = (key, fn) => {
  const run = (locks.get(key) || Promise.resolve()).then(fn, fn);
  const tail = run.then(() => {}, () => {});
  locks.set(key, tail);
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return run;
};

const norm = (s) => String(s ?? '').trim().toLowerCase();

const lookup = (obj, path) =>
  String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);

const valueOf = (scope, key) => {
  let v = lookup(scope, key);
  if (v === undefined && !key.includes('.')) v = lookup(scope.vars || {}, key);
  return v;
};

// Fills {{contact.name}}, {{vars.email}} (or just {{email}}) and {{message.text}}.
const render = (template, scope) =>
  String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g, (_, key) => {
    const v = valueOf(scope, key);
    if (v == null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  });

// The same inside a JSON body, with values escaped so the JSON stays valid.
const renderJson = (template, scope) =>
  String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g, (_, key) => {
    const v = valueOf(scope, key);
    if (v == null) return '';
    return JSON.stringify(typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(1, -1);
  });

const isPrivateIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
};

// Webhook steps may only call the public internet, never this server or its network.
const assertPublicUrl = async (raw) => {
  let url;
  try { url = new URL(raw); } catch { throw new Error('The webhook URL is not valid'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The webhook URL must start with http:// or https://');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateIp)) throw new Error('The webhook URL points to a private network address');
};

const nowParts = (date = new Date()) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
};

const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const timeLabel = (minutes) => {
  const h = Math.floor(minutes / 60);
  return `${((h + 11) % 12) + 1}:${String(minutes % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const dateLabel = (isoDate) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const VALIDATORS = {
  any: (v) => (v ? v : null),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : null),
  phone: (v) => {
    const digits = v.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
  },
  number: (v) => {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? String(n) : null;
  },
  date: (v) => {
    const dmy = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (dmy) {
      const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
      const d = new Date(Date.UTC(Number(year), Number(dmy[2]) - 1, Number(dmy[1])));
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
  },
};

const DEFAULT_ERRORS = {
  any: 'Please type your answer.',
  email: 'That doesn\'t look like an email address. Please try again.',
  phone: 'Please send a valid phone number.',
  number: 'Please send a number.',
  date: 'Please send a date, for example 25/12/2026.',
};

const nodeById = (flow, id) => (flow.nodes || []).find((n) => n.id === id);
const nextFrom = (flow, nodeId, handle = 'next') => {
  const edge = (flow.edges || []).find((e) => e.source === nodeId && (e.sourceHandle || 'next') === handle);
  return edge ? edge.target : null;
};

// The option a customer chose: a tapped button/row, its exact title, or its number.
const pickOption = (options, inbound) => {
  if (inbound.interactiveId) {
    const byId = options.find((o) => String(o.id) === String(inbound.interactiveId));
    if (byId) return byId;
  }
  const text = norm(inbound.text);
  if (!text) return null;
  return options.find((o) => norm(o.title) === text) || options[Number(text) - 1] || null;
};

// ---------------------------------------------------------------------------
// Validation, shared by the builder (on save) and activation.

const VAR_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const validateFlow = (flow) => {
  const errors = [];
  const warnings = [];
  const nodes = flow.nodes || [];
  const edges = flow.edges || [];
  const ids = new Set(nodes.map((n) => n.id));
  const label = (n) => n.data?.label || n.type;

  const starts = nodes.filter((n) => n.type === 'start');
  if (starts.length !== 1) errors.push({ message: 'The flow needs exactly one Start step.' });
  if (flow.trigger?.type === 'keyword' && !(flow.trigger.keywords || []).some((k) => String(k).trim())) {
    errors.push({ message: 'Add at least one keyword that starts this flow.' });
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) errors.push({ message: 'A connection points to a step that no longer exists.' });
  }

  for (const n of nodes) {
    const d = n.data || {};
    const err = (message) => errors.push({ node_id: n.id, message: `${label(n)}: ${message}` });
    switch (n.type) {
      case 'message':
        if (!String(d.text || '').trim() && !d.media?.url) err('add a message or a file.');
        if (String(d.text || '').length > meta.LIMITS.text) err('the message is too long.');
        break;
      case 'buttons': {
        const buttons = d.buttons || [];
        if (!String(d.text || '').trim()) err('add the message text.');
        if (buttons.length < 1 || buttons.length > meta.LIMITS.buttons) err('add 1 to 3 buttons.');
        if (new Set(buttons.map((b) => b.id)).size !== buttons.length) err('two buttons have the same id.');
        buttons.forEach((b) => {
          if (!String(b.title || '').trim()) err('every button needs a title.');
          if (String(b.title || '').length > meta.LIMITS.button_title) err(`button "${b.title}" is longer than ${meta.LIMITS.button_title} characters.`);
        });
        if (String(d.text || '').length > meta.LIMITS.body) err(`the text is longer than ${meta.LIMITS.body} characters.`);
        if (String(d.header || '').length > meta.LIMITS.header) err(`the header is longer than ${meta.LIMITS.header} characters.`);
        if (String(d.footer || '').length > meta.LIMITS.footer) err(`the footer is longer than ${meta.LIMITS.footer} characters.`);
        break;
      }
      case 'list': {
        const rows = (d.sections || []).flatMap((s) => s.rows || []);
        if (!String(d.text || '').trim()) err('add the message text.');
        if (rows.length < 1 || rows.length > meta.LIMITS.list_rows) err('add 1 to 10 options.');
        if (new Set(rows.map((r) => r.id)).size !== rows.length) err('two options have the same id.');
        rows.forEach((r) => {
          if (!String(r.title || '').trim()) err('every option needs a title.');
          if (String(r.title || '').length > meta.LIMITS.row_title) err(`option "${r.title}" is longer than ${meta.LIMITS.row_title} characters.`);
          if (String(r.description || '').length > meta.LIMITS.row_description) err(`the description of "${r.title}" is longer than ${meta.LIMITS.row_description} characters.`);
        });
        if (String(d.button_label || '').length > meta.LIMITS.list_button) err(`the menu button label is longer than ${meta.LIMITS.list_button} characters.`);
        break;
      }
      case 'question':
        if (!String(d.text || '').trim()) err('add the question.');
        if (!VAR_RE.test(d.variable || '')) err('choose a variable name (letters, numbers and _).');
        break;
      case 'condition':
        if (!(d.rules || []).length) err('add at least one rule.');
        break;
      case 'delay': {
        const ms = Number(d.amount) * (d.unit === 'hours' ? 3600000 : 60000);
        if (!(ms > 0)) err('set how long to wait.');
        if (ms > MAX_DELAY_MS) err('wait at most 23 hours (WhatsApp only allows replies within 24 hours).');
        break;
      }
      case 'set_variable':
        if (!VAR_RE.test(d.variable || '')) err('choose a variable name.');
        break;
      case 'webhook':
        if (!/^https?:\/\//.test(d.url || '')) err('add a URL starting with http:// or https://.');
        break;
      case 'appointment':
        if (!String(d.text || '').trim()) err('add the message that offers the slots.');
        break;
      case 'voice_call':
        if (!d.agent_id) err('choose the AI voice agent that will call.');
        if (!d.from_number) err('choose the number to call from.');
        break;
      default:
        break;
    }
  }

  // Steps nothing leads to never run.
  if (starts.length === 1) {
    const reachable = new Set([starts[0].id]);
    const queue = [starts[0].id];
    while (queue.length) {
      const id = queue.shift();
      for (const e of edges.filter((x) => x.source === id)) {
        if (!reachable.has(e.target)) {
          reachable.add(e.target);
          queue.push(e.target);
        }
      }
    }
    nodes.filter((n) => !reachable.has(n.id)).forEach((n) => warnings.push({ node_id: n.id, message: `${label(n)} is not connected, so it never runs.` }));
  }

  return { errors, warnings };
};

// ---------------------------------------------------------------------------
// Steps. enter() runs when the flow reaches the step; reply() when the customer
// answers a step that waits. Both return { next: handle }, { wait }, { end }
// or (reply only) { stay } to keep waiting, { unknown } / { invalid } for a bad answer.

const offerSlots = async (ctx, node) => {
  const d = node.data || {};
  const slots = await findSlots(ctx.accountId, d);
  if (!slots.length) {
    await ctx.say(render(d.no_slots_text || 'Sorry, there are no free slots right now. A team member will contact you.', ctx.scope()));
    return { next: 'failed' };
  }
  const byDate = new Map();
  for (const s of slots) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }
  const sections = [...byDate.entries()].map(([date, list]) => ({
    title: dateLabel(date),
    rows: list.map((s) => ({ id: s.id, title: s.title, description: dateLabel(date) })),
  }));
  await ctx.sayList({ text: render(d.text, ctx.scope()), button_label: d.button_label || 'Choose a time', sections });
  return { wait: { kind: 'slot', options: Object.fromEntries(slots.map((s) => [s.id, s])) } };
};

const findSlots = async (accountId, d) => {
  const settings = (await AppointmentSetting.findOne({ user_id: accountId }).lean()) || (await AppointmentSetting.create({ user_id: accountId })).toObject();
  const step = Math.max(15, Number(d.slot_minutes) || 30);
  const days = Math.min(14, Math.max(1, Number(d.days_ahead) || 7));
  const max = Math.min(10, Math.max(1, Number(d.max_slots) || 10));
  const now = nowParts();
  const slots = [];
  let checks = 0;

  for (let i = 0; i < days && slots.length < max && checks < 200; i++) {
    const date = addDays(now.date, i);
    const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toLowerCase();
    const day = (settings.slots || []).find((s) => s.day === weekday && s.is_enabled);
    for (const interval of day?.intervals || []) {
      const [fh, fm] = interval.from.split(':').map(Number);
      const [th, tm] = interval.to.split(':').map(Number);
      for (let t = fh * 60 + fm; t + step <= th * 60 + tm && slots.length < max && checks < 200; t += step) {
        if (i === 0 && t <= now.minutes + 60) continue; // At least an hour from now.
        checks++;
        const result = await appointmentService.checkAvailability(accountId, date, hhmm(t));
        if (result.available) slots.push({ id: `slot_${date.replace(/-/g, '')}_${hhmm(t).replace(':', '')}`, date, time: hhmm(t), title: timeLabel(t), minutes: t });
      }
    }
  }
  return slots;
};

const evaluateRule = (rule, ctx) => {
  let actual;
  if (rule.subject === 'contact') actual = ctx.contact?.[rule.key];
  else if (rule.subject === 'message') actual = ctx.run.vars?.last_message;
  else if (rule.subject === 'label') actual = (ctx.conversation?.labels || []).join(',');
  else actual = ctx.run.vars?.[rule.key];

  const a = norm(actual);
  const expected = norm(render(rule.value, ctx.scope()));
  switch (rule.operator) {
    case 'exists': return a !== '';
    case 'not_exists': return a === '';
    case 'not_equals': return a !== expected;
    case 'contains': return rule.subject === 'label' ? a.split(',').includes(expected) : a.includes(expected);
    case 'starts_with': return a.startsWith(expected);
    case 'greater_than': return Number(actual) > Number(expected);
    case 'less_than': return Number(actual) < Number(expected);
    case 'equals':
    default: return a === expected;
  }
};

const HANDLERS = {
  start: { enter: async () => ({ next: 'next' }) },

  message: {
    async enter(node, ctx) {
      const d = node.data || {};
      const text = render(d.text, ctx.scope());
      if (d.media?.url) await ctx.sayMedia({ type: d.media.type || 'image', url: d.media.url, filename: d.media.filename }, text);
      else await ctx.say(text);
      return { next: 'next' };
    },
  },

  buttons: {
    async enter(node, ctx) {
      const d = node.data || {};
      const scope = ctx.scope();
      await ctx.sayButtons({
        text: render(d.text, scope),
        header: render(d.header, scope),
        footer: render(d.footer, scope),
        buttons: (d.buttons || []).map((b) => ({ id: b.id, title: render(b.title, scope) })),
      });
      return { wait: { kind: 'reply' } };
    },
    async reply(node, ctx) {
      const choice = pickOption(node.data?.buttons || [], ctx.inbound);
      if (!choice) return { unknown: true };
      if (node.data?.variable) ctx.run.vars[node.data.variable] = choice.title;
      return { next: `btn:${choice.id}` };
    },
  },

  list: {
    async enter(node, ctx) {
      const d = node.data || {};
      const scope = ctx.scope();
      await ctx.sayList({
        text: render(d.text, scope),
        header: render(d.header, scope),
        footer: render(d.footer, scope),
        button_label: render(d.button_label || 'Choose', scope),
        sections: (d.sections || []).map((s) => ({ title: s.title, rows: (s.rows || []).map((r) => ({ id: r.id, title: render(r.title, scope), description: render(r.description, scope) })) })),
      });
      return { wait: { kind: 'reply' } };
    },
    async reply(node, ctx) {
      const rows = (node.data?.sections || []).flatMap((s) => s.rows || []);
      const choice = pickOption(rows, ctx.inbound);
      if (!choice) return { unknown: true };
      if (node.data?.variable) ctx.run.vars[node.data.variable] = choice.title;
      return { next: `row:${choice.id}` };
    },
  },

  question: {
    async enter(node, ctx) {
      await ctx.say(render(node.data?.text, ctx.scope()));
      return { wait: { kind: 'input' } };
    },
    async reply(node, ctx) {
      const d = node.data || {};
      const kind = VALIDATORS[d.validation] ? d.validation : 'any';
      const value = VALIDATORS[kind](String(ctx.inbound.text || '').trim());
      if (value === null) return { invalid: render(d.error_text || DEFAULT_ERRORS[kind], ctx.scope()) };
      ctx.run.vars[d.variable] = value;
      return { next: 'next' };
    },
  },

  condition: {
    async enter(node, ctx) {
      const rules = node.data?.rules || [];
      const results = rules.map((r) => evaluateRule(r, ctx));
      const pass = node.data?.match === 'any' ? results.some(Boolean) : results.every(Boolean);
      return { next: pass ? 'true' : 'false' };
    },
  },

  delay: {
    async enter(node, ctx) {
      const d = node.data || {};
      const ms = Math.min(MAX_DELAY_MS, Number(d.amount) * (d.unit === 'hours' ? 3600000 : 60000));
      if (ctx.simulation) {
        ctx.note(`Waited ${d.amount} ${d.unit || 'minutes'} (skipped in the test).`);
        return { next: 'next' };
      }
      return { wait: { kind: 'delay', resume_at: new Date(Date.now() + ms) } };
    },
    // A message during the wait goes to the inbox; the flow keeps waiting.
    async reply() { return { stay: true }; },
  },

  set_variable: {
    async enter(node, ctx) {
      ctx.run.vars[node.data.variable] = render(node.data.value, ctx.scope());
      return { next: 'next' };
    },
  },

  contact: {
    async enter(node, ctx) {
      const d = node.data || {};
      const scope = ctx.scope();
      const fields = Object.fromEntries(
        ['first_name', 'last_name', 'email']
          .map((k) => [k, render(d.fields?.[k], scope).trim()])
          .filter(([, v]) => v)
      );
      if (ctx.simulation) {
        const parts = [];
        if (d.add_group_ids?.length) parts.push(`add to ${d.add_group_ids.length} group(s)`);
        if (d.remove_group_ids?.length) parts.push(`remove from ${d.remove_group_ids.length} group(s)`);
        if (d.add_labels?.length) parts.push(`label ${d.add_labels.join(', ')}`);
        if (Object.keys(fields).length) parts.push(`save ${Object.keys(fields).join(', ')}`);
        ctx.note(`Contact updated: ${parts.join('; ') || 'nothing to change'}.`);
        return { next: 'next' };
      }
      if (ctx.conversation.contact_id) {
        const update = {};
        if (d.add_group_ids?.length) update.$addToSet = { group_ids: { $each: d.add_group_ids } };
        if (Object.keys(fields).length) update.$set = fields;
        if (Object.keys(update).length) await Contact.updateOne({ _id: ctx.conversation.contact_id, user_id: ctx.accountId }, update);
        if (d.remove_group_ids?.length) {
          await Contact.updateOne({ _id: ctx.conversation.contact_id, user_id: ctx.accountId }, { $pull: { group_ids: { $in: d.remove_group_ids } } });
        }
        Object.assign(ctx.contact || {}, fields);
      }
      const labels = {};
      if (d.add_labels?.length) labels.$addToSet = { labels: { $each: d.add_labels } };
      if (Object.keys(labels).length) await WhatsappConversation.updateOne({ _id: ctx.conversation._id }, labels);
      if (d.remove_labels?.length) await WhatsappConversation.updateOne({ _id: ctx.conversation._id }, { $pull: { labels: { $in: d.remove_labels } } });
      return { next: 'next' };
    },
  },

  handoff: {
    async enter(node, ctx) {
      const d = node.data || {};
      if (d.text) await ctx.say(render(d.text, ctx.scope()));
      await ctx.handoff({ memberId: d.assign_member_id || null, status: d.status || 'pending', note: render(d.note, ctx.scope()) });
      return { end: 'handed_off', reason: 'handoff_step' };
    },
  },

  ai_reply: {
    async enter(node, ctx) {
      const d = node.data || {};
      if (d.mode === 'chat') {
        if (d.intro_text) await ctx.say(render(d.intro_text, ctx.scope()));
        return { wait: { kind: 'ai_chat' } };
      }
      await ctx.aiAnswer(d.instructions);
      return { next: 'next' };
    },
    async reply(node, ctx) {
      const d = node.data || {};
      if (ai.matchesKeyword(ctx.inbound.text, d.exit_keywords || [])) return { next: 'next' };
      await ctx.aiAnswer(d.instructions);
      ctx.run.waiting.turns = (ctx.run.waiting.turns || 0) + 1;
      if (ctx.run.waiting.turns >= Math.max(1, Number(d.max_turns) || 5)) return { next: 'next' };
      return { stay: true };
    },
  },

  webhook: {
    async enter(node, ctx) {
      const d = node.data || {};
      const scope = ctx.scope();
      const method = (d.method || 'POST').toUpperCase();
      const url = render(d.url, scope);
      try {
        await assertPublicUrl(url);
        const headers = Object.fromEntries((d.headers || []).filter((h) => h?.key).map((h) => [h.key, render(h.value, scope)]));
        let data;
        if (method !== 'GET' && String(d.body || '').trim()) {
          const raw = renderJson(d.body, scope);
          try {
            data = JSON.parse(raw);
            if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
          } catch {
            data = raw;
          }
        }
        const res = await axios({
          method,
          url,
          headers,
          data,
          timeout: Math.min(15, Math.max(2, Number(d.timeout_seconds) || 8)) * 1000,
          maxRedirects: 0,
          maxContentLength: 1024 * 1024,
          validateStatus: () => true,
        });
        ctx.run.vars.webhook_status = res.status;
        for (const m of d.save || []) {
          if (m?.variable && m.path) ctx.run.vars[m.variable] = lookup(res.data, m.path) ?? '';
        }
        ctx.note(`${method} ${url} → ${res.status}`);
        return { next: res.status >= 200 && res.status < 300 ? 'success' : 'error' };
      } catch (err) {
        ctx.run.vars.webhook_status = 0;
        ctx.run.vars.webhook_error = err.message;
        ctx.note(`${method} ${url} failed: ${err.message}`);
        return { next: 'error' };
      }
    },
  },

  appointment: {
    enter: (node, ctx) => offerSlots(ctx, node),
    async reply(node, ctx) {
      const d = node.data || {};
      const options = ctx.run.waiting.options || {};
      const slot = pickOption(Object.values(options), ctx.inbound);
      if (!slot) return { unknown: true };

      const scope = ctx.scope();
      const setVars = (meetLink = '') => Object.assign(ctx.run.vars, {
        appointment_date: dateLabel(slot.date),
        appointment_time: slot.title,
        meet_link: meetLink,
      });

      if (ctx.simulation) {
        setVars();
        ctx.note(`Would book ${dateLabel(slot.date)} at ${slot.title} (not booked in the test).`);
      } else {
        const check = await appointmentService.checkAvailability(ctx.accountId, slot.date, slot.time);
        if (!check.available) {
          await ctx.say('Sorry, that time was just taken. Please choose another one.');
          return offerSlots(ctx, node).then((r) => (r.wait ? { rewait: r.wait } : r));
        }
        const name = (d.name_variable && ctx.run.vars[d.name_variable]) || scope.contact.name || 'WhatsApp customer';
        let appointment = await Appointment.create({
          user_id: ctx.accountId,
          name,
          phone: scope.contact.phone,
          appointment_date: new Date(slot.date),
          appointment_time: slot.time,
          appointment_type: d.appointment_type || 'General',
          status: 'confirmed',
          notes: `Booked on WhatsApp${d.notes ? `: ${render(d.notes, scope)}` : ''}`,
        });
        try {
          appointment = (await appointmentService.syncToGoogleCalendar(ctx.accountId, appointment, !!d.send_meet_link, d.calendar_id || null)) || appointment;
        } catch (e) {
          console.warn('[WhatsApp flow] Calendar sync skipped:', e.message);
        }
        setVars(appointment.meet_link || '');
        ctx.note(`Booked ${dateLabel(slot.date)} at ${slot.title}.`);
      }
      await ctx.say(render(d.confirm_text || 'You\'re booked for {{appointment_date}} at {{appointment_time}}. See you then!', ctx.scope()));
      return { next: 'booked' };
    },
  },

  voice_call: {
    async enter(node, ctx) {
      const d = node.data || {};
      if (d.text) await ctx.say(render(d.text, ctx.scope()));
      if (ctx.simulation) {
        ctx.note('Would start the AI voice call now (no call in the test).');
        return { next: 'success' };
      }
      try {
        const agent = await Agent.findOne({ _id: d.agent_id, user_id: ctx.accountId }).select('flow_id').lean();
        if (!agent) throw new Error('The AI voice agent for this step was not found');
        const call = await outboundCallService.placeCall({
          userId: ctx.accountId,
          flowId: agent.flow_id,
          agentId: d.agent_id,
          phoneNumber: `+${ctx.conversation.wa_id}`,
          fromNumber: d.from_number,
        });
        ctx.run.vars.call_id = String(call._id);
        await ctx.event('AI voice call started by the automation.');
        return { next: 'success' };
      } catch (err) {
        ctx.run.vars.call_error = err.message;
        await ctx.event(`AI voice call failed: ${err.message}`);
        return { next: 'error' };
      }
    },
  },

  end: {
    async enter(node, ctx) {
      if (node.data?.text) await ctx.say(render(node.data.text, ctx.scope()));
      return { end: 'completed', reason: 'end_step' };
    },
  },
};

// ---------------------------------------------------------------------------
// The engine

class SendFailed extends Error {}

class FlowEngine {
  constructor() {
    this.validateFlow = validateFlow;
    this.render = render;
  }

  // Everything a step needs, for a real chat or a builder test.
  async context({ run, flow, conversation = null, inbound = null, simulation = false }) {
    const accountId = run.user_id;
    let contact = { name: 'Test customer', first_name: 'Test', last_name: 'customer', email: '', phone: '+919999999999' };
    if (!simulation) {
      const c = conversation.contact_id ? await Contact.findById(conversation.contact_id).lean() : null;
      contact = {
        first_name: c?.first_name || '',
        last_name: c?.last_name || '',
        email: c?.email || '',
        name: [c?.first_name, c?.last_name].filter(Boolean).join(' ') || conversation.profile_name || '',
        phone: `+${conversation.wa_id}`,
      };
    }
    if (!run.vars) run.vars = {};

    const outbox = [];
    const ctx = {
      run, flow, conversation, inbound, simulation, accountId, contact, outbox,
      scope: () => ({ contact: ctx.contact, vars: run.vars, message: { text: run.vars.last_message || '' } }),
      log: (type, detail = '') => {
        run.events.push({ type, node_id: run.current_node_id, detail: String(detail).slice(0, 300) });
        if (run.events.length > 100) run.events.splice(0, run.events.length - 100);
      },
      note: (text) => {
        ctx.log('note', text);
        if (simulation) outbox.push({ type: 'note', text });
      },
      event: async (text) => {
        if (simulation) ctx.note(text);
        else await inbox.addEvent(conversation, text);
      },
    };

    const send = async (kind, payload, sender = 'bot') => {
      if (simulation) {
        outbox.push({ type: kind, sender, ...payload });
        if (payload.text && kind !== 'note') this.simHistory(run).push({ role: 'assistant', content: payload.text });
        return;
      }
      const opts = { sender, flowRunId: run._id };
      let message;
      if (kind === 'text') message = await inbox.sendText(conversation, payload.text, opts);
      else if (kind === 'media') message = await inbox.sendMediaLink(conversation, { ...payload.media, caption: payload.text }, opts);
      else if (kind === 'buttons') message = await inbox.sendButtons(conversation, payload, opts);
      else if (kind === 'list') message = await inbox.sendList(conversation, payload, opts);
      if (message?.status === 'failed') throw new SendFailed(message.error?.message || 'WhatsApp did not accept the message');
    };

    ctx.say = (text) => (String(text || '').trim() ? send('text', { text: String(text).trim() }) : Promise.resolve());
    ctx.sayMedia = (media, text) => send('media', { media, text });
    ctx.sayButtons = (content) => send('buttons', content);
    ctx.sayList = (content) => send('list', content);
    ctx.aiAnswer = async (instructions) => {
      const history = simulation ? this.simHistory(run).slice(-12) : await ai.historyFor(conversation._id);
      const reply = await ai.generateReply({ accountId, history, extraInstructions: instructions || '' });
      if (reply) await send('text', { text: reply }, 'ai');
    };
    ctx.handoff = async ({ memberId, status, note }) => {
      if (simulation) {
        ctx.note(`Handed over to the team${memberId ? ' (assigned)' : ''}.`);
        return;
      }
      await WhatsappConversation.updateOne(
        { _id: conversation._id },
        { $set: { status: status === 'open' ? 'open' : 'pending', bot_paused: true, ...(memberId ? { assigned_member_id: memberId } : {}) } }
      );
      await inbox.addEvent(conversation, `Handed over to the team by the automation "${flow.name}"${note ? `: ${note}` : ''}.`);
      if (memberId) {
        const app = { get: (key) => (key === 'io' ? realtime.getIo() : null) };
        sendNotification(app, memberId, 'info', 'WhatsApp chat assigned to you', `A chat with ${contact.name || contact.phone} needs a reply.`).catch(() => {});
      }
      realtime.emitToAccount(accountId, 'whatsapp:conversation', { conversation_id: String(conversation._id) });
    };
    return ctx;
  }

  simHistory(run) {
    if (!Array.isArray(run.vars.__history)) run.vars.__history = [];
    return run.vars.__history;
  }

  async save(run) {
    run.markModified('vars');
    run.markModified('waiting');
    await run.save();
  }

  async finish(ctx, status, reason) {
    const { run } = ctx;
    run.status = status;
    run.end_reason = reason;
    run.ended_at = new Date();
    run.waiting = { kind: null };
    ctx.log('end', `${status}: ${reason}`);
    await this.save(run);
    if (!run.simulation) {
      const key = { completed: 'completed', handed_off: 'handed_off', failed: 'failed' }[status];
      if (key) await WhatsappFlow.updateOne({ _id: run.flow_id }, { $inc: { [`stats.${key}`]: 1 } });
    }
  }

  // Walks the flow from a step until it has to wait or ends.
  async advance(ctx, nodeId) {
    const { run, flow } = ctx;
    let steps = 0;
    while (nodeId) {
      if (++steps > MAX_STEPS) return this.finish(ctx, 'failed', 'Too many steps in a row. Check for a loop.');
      const node = nodeById(flow, nodeId);
      if (!node) return this.finish(ctx, 'failed', 'A connected step is missing');
      run.current_node_id = node.id;
      run.waiting = { kind: null };
      run.reprompts = 0;
      run.last_advanced_at = new Date();
      ctx.log('step', node.data?.label || node.type);

      let result;
      try {
        result = await (HANDLERS[node.type]?.enter || (async () => ({ next: 'next' })))(node, ctx);
      } catch (err) {
        console.error(`[WhatsApp flow] Step ${node.type} failed:`, err.message);
        ctx.log('error', err.message);
        const onError = nextFrom(flow, node.id, 'error');
        if (onError && !(err instanceof SendFailed)) { nodeId = onError; continue; }
        if (ctx.simulation) ctx.outbox.push({ type: 'note', text: `Error: ${err.message}` });
        return this.finish(ctx, 'failed', err.message);
      }

      if (result.wait) {
        run.waiting = { kind: result.wait.kind, since: new Date(), resume_at: result.wait.resume_at || null, options: result.wait.options || null, turns: 0 };
        return this.save(run);
      }
      if (result.end) return this.finish(ctx, result.end, result.reason);
      nodeId = nextFrom(flow, node.id, result.next);
    }
    return this.finish(ctx, 'completed', 'end_of_flow');
  }

  // The customer answered the step the run is waiting at.
  async resume(ctx) {
    const { run, flow } = ctx;
    const node = nodeById(flow, run.current_node_id);
    const handler = node && HANDLERS[node.type];
    if (!handler?.reply) return this.finish(ctx, 'failed', 'The waiting step is missing');
    run.vars.last_message = ctx.inbound.text || '';
    if (ctx.simulation) this.simHistory(run).push({ role: 'user', content: ctx.inbound.text || '' });

    let result;
    try {
      result = await handler.reply(node, ctx);
    } catch (err) {
      console.error(`[WhatsApp flow] Reply to ${node.type} failed:`, err.message);
      ctx.log('error', err.message);
      if (ctx.simulation) ctx.outbox.push({ type: 'note', text: `Error: ${err.message}` });
      const onError = nextFrom(flow, node.id, 'error');
      if (onError && !(err instanceof SendFailed)) return this.advance(ctx, onError);
      return this.finish(ctx, 'failed', err.message);
    }

    if (result.stay) {
      run.last_advanced_at = new Date();
      return this.save(run);
    }
    if (result.rewait) {
      run.waiting = { ...run.waiting, ...result.rewait };
      return this.save(run);
    }
    if (result.unknown || result.invalid) return this.badAnswer(ctx, node, result.invalid);
    if (result.end) return this.finish(ctx, result.end, result.reason);
    const next = nextFrom(flow, node.id, result.next);
    if (!next) return this.finish(ctx, 'completed', 'end_of_flow');
    return this.advance(ctx, next);
  }

  // An answer that matches no option (or fails validation): ask again, then hand over or end.
  async badAnswer(ctx, node, invalidText) {
    const { run, flow } = ctx;
    const policy = flow.settings?.on_unknown_reply || 'reprompt';
    const max = Math.max(0, Number(flow.settings?.max_reprompts ?? 2));
    if (policy === 'reprompt' && run.reprompts < max) {
      run.reprompts += 1;
      ctx.log('reprompt', `${run.reprompts}/${max}`);
      try {
        if (invalidText) await ctx.say(invalidText);
        else {
          await ctx.say('Please choose one of the options.');
          // Asking again re-sends the step (an appointment step offers fresh slots).
          const again = await HANDLERS[node.type].enter(node, ctx);
          if (again?.wait) run.waiting = { ...run.waiting, ...again.wait };
          else if (again?.next) return this.advance(ctx, nextFrom(flow, node.id, again.next));
        }
      } catch (err) {
        return this.finish(ctx, 'failed', err.message);
      }
      run.last_advanced_at = new Date();
      return this.save(run);
    }
    if (policy === 'end') return this.finish(ctx, 'completed', 'no_valid_answer');
    await ctx.handoff({ status: 'pending', note: 'the customer\'s reply didn\'t match the options' });
    return this.finish(ctx, 'handed_off', 'no_valid_answer');
  }

  async start(flow, conversation, inbound) {
    let run;
    try {
      run = await WhatsappFlowRun.create({
        user_id: conversation.user_id,
        flow_id: flow._id,
        conversation_id: conversation._id,
        vars: { last_message: inbound.text || '' },
      });
    } catch (err) {
      if (err.code === 11000) return; // Another message already started a run for this chat.
      throw err;
    }
    await WhatsappFlow.updateOne({ _id: flow._id }, { $inc: { 'stats.runs': 1 } });
    const ctx = await this.context({ run, flow, conversation, inbound });
    const startNode = (flow.nodes || []).find((n) => n.type === 'start');
    if (!startNode) return this.finish(ctx, 'failed', 'The flow has no Start step');
    return this.advance(ctx, startNode.id);
  }

  async findTrigger(accountId, inbound, isFirstMessage) {
    const flows = await WhatsappFlow.find({ user_id: accountId, status: 'active', deleted_at: null }).sort({ priority: 1, created_at: 1 }).lean();
    const candidates = [inbound.text, inbound.interactiveId, inbound.interactiveTitle].filter(Boolean).map(norm);
    // Keywords win over "first message", which wins over "any message".
    const keyword = flows.find((f) => f.trigger?.type === 'keyword' && (f.trigger.keywords || []).some((k) => {
      const kw = norm(k);
      return kw && candidates.some((c) => (f.trigger.match === 'exact' ? c === kw : c.includes(kw)));
    }));
    if (keyword) return keyword;
    if (isFirstMessage) {
      const first = flows.find((f) => f.trigger?.type === 'first_message');
      if (first) return first;
    }
    return flows.find((f) => f.trigger?.type === 'any_message') || null;
  }

  // A customer message from the webhook: continue the chat's flow, start one, or let the AI answer.
  handleInbound({ conversation, message, isFirstMessage }) {
    return withLock(String(conversation._id), async () => {
      const conv = await WhatsappConversation.findById(conversation._id);
      if (!conv || conv.bot_paused) return;
      const inbound = {
        text: message.text || '',
        type: message.type,
        interactiveId: message.interactive?.id || null,
        interactiveTitle: message.interactive?.title || null,
      };

      const active = await WhatsappFlowRun.findOne({ conversation_id: conv._id, status: 'active', simulation: false });
      if (active) {
        const flow = await WhatsappFlow.findOne({ _id: active.flow_id, deleted_at: null }).lean();
        if (flow && flow.status === 'active') {
          const ctx = await this.context({ run: active, flow, conversation: conv, inbound });
          return this.resume(ctx);
        }
        active.status = 'stopped';
        active.end_reason = 'flow_paused';
        active.ended_at = new Date();
        await active.save();
      }

      const flow = await this.findTrigger(conv.user_id, inbound, isFirstMessage);
      if (flow) return this.start(flow, conv, inbound);
      return this.aiAutoReply(conv, inbound);
    }).catch((err) => console.error('[WhatsApp flow] Inbound handling failed:', err));
  }

  // No automation took the message: the AI answers if it's switched on for this account.
  async aiAutoReply(conversation, inbound) {
    const settings = await WhatsappInboxSetting.findOne({ user_id: conversation.user_id }).lean();
    if (!settings?.ai?.enabled || !inbox.isWindowOpen(conversation)) return;

    const handOver = async (reason) => {
      if (settings.ai.handoff_message) await inbox.sendText(conversation, settings.ai.handoff_message, { sender: 'ai' });
      await WhatsappConversation.updateOne({ _id: conversation._id }, { $set: { status: 'pending', bot_paused: true } });
      await inbox.addEvent(conversation, `AI handed the chat to the team (${reason}).`);
      realtime.emitToAccount(conversation.user_id, 'whatsapp:conversation', { conversation_id: String(conversation._id) });
    };

    if (ai.matchesKeyword(inbound.text, settings.ai.handoff_keywords)) return handOver('the customer asked for a person');
    if (conversation.ai_reply_count >= (settings.ai.max_replies || 10)) return handOver('reply limit reached');

    try {
      const { phoneNumberId, token } = await inbox.numberFor(conversation);
      const last = await db.WhatsappMessage.findOne({ conversation_id: conversation._id, direction: 'inbound' }).sort({ created_at: -1 }).select('wamid').lean();
      if (last?.wamid) meta.markRead(phoneNumberId, token, last.wamid, true).catch(() => {});

      const reply = await ai.generateReply({ accountId: conversation.user_id, history: await ai.historyFor(conversation._id) });
      if (!reply) return;
      await inbox.sendText(conversation, reply, { sender: 'ai' });
      await WhatsappConversation.updateOne({ _id: conversation._id }, { $inc: { ai_reply_count: 1 } });
    } catch (err) {
      console.error('[WhatsApp AI] Auto-reply failed:', err.message);
      await inbox.addEvent(conversation, `AI reply failed: ${err.message}`).catch(() => {});
    }
  }

  // A delay step is over.
  resumeDelay(runId) {
    return WhatsappFlowRun.findById(runId).then((initial) => {
      if (!initial?.conversation_id) return null;
      return withLock(String(initial.conversation_id), async () => {
        const run = await WhatsappFlowRun.findOne({ _id: runId, status: 'active', 'waiting.kind': 'delay' });
        if (!run) return;
        const [flow, conversation] = await Promise.all([
          WhatsappFlow.findOne({ _id: run.flow_id, deleted_at: null }).lean(),
          WhatsappConversation.findById(run.conversation_id),
        ]);
        const ctx = await this.context({ run, flow: flow || { nodes: [], edges: [] }, conversation });
        if (!flow || flow.status !== 'active' || !conversation) return this.finish(ctx, 'stopped', 'flow_paused');
        if (conversation.bot_paused) return this.finish(ctx, 'stopped', 'agent_replied');
        const next = nextFrom(flow, run.current_node_id, 'next');
        if (!next) return this.finish(ctx, 'completed', 'end_of_flow');
        return this.advance(ctx, next);
      });
    });
  }

  // Runs waiting longer than their flow allows are closed.
  async expireStale() {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const runs = await WhatsappFlowRun.find({ status: 'active', simulation: false, 'waiting.kind': { $in: ['reply', 'input', 'slot', 'ai_chat'] }, last_advanced_at: { $lte: cutoff } })
      .select('flow_id last_advanced_at')
      .limit(500)
      .lean();
    const flows = new Map();
    for (const r of runs) {
      const key = String(r.flow_id);
      if (!flows.has(key)) flows.set(key, await WhatsappFlow.findById(r.flow_id).select('settings').lean());
      const hours = flows.get(key)?.settings?.timeout_hours || 24;
      if (Date.now() - new Date(r.last_advanced_at).getTime() > hours * 3600000) {
        await WhatsappFlowRun.updateOne({ _id: r._id, status: 'active' }, { $set: { status: 'timed_out', end_reason: 'no_reply', ended_at: new Date(), 'waiting.kind': null } });
      }
    }
  }

  // The builder's test chat: runs the flow (saved or as currently drawn) without WhatsApp.
  // input: { text, interactive_id } from the tester; a missing run_id starts a new test.
  async simulate({ accountId, flow, runId, input }) {
    let run = runId ? await WhatsappFlowRun.findOne({ _id: runId, user_id: accountId, simulation: true }) : null;
    const inbound = {
      text: input?.text || '',
      type: input?.interactive_id ? 'button_reply' : 'text',
      interactiveId: input?.interactive_id || null,
      interactiveTitle: input?.interactive_id ? input.text : null,
    };

    if (!run || run.status !== 'active') {
      run = await WhatsappFlowRun.create({ user_id: accountId, flow_id: flow._id, simulation: true, vars: { last_message: inbound.text, __history: [{ role: 'user', content: inbound.text }] } });
      const ctx = await this.context({ run, flow, inbound, simulation: true });
      const startNode = (flow.nodes || []).find((n) => n.type === 'start');
      if (!startNode) await this.finish(ctx, 'failed', 'The flow has no Start step');
      else await this.advance(ctx, startNode.id);
      return this.simResult(run, ctx);
    }

    const ctx = await this.context({ run, flow, inbound, simulation: true });
    if (run.waiting?.kind === 'delay') ctx.note('Still waiting.');
    else await this.resume(ctx);
    return this.simResult(run, ctx);
  }

  simResult(run, ctx) {
    const { __history, ...vars } = run.vars || {};
    return {
      run_id: run.id,
      status: run.status,
      end_reason: run.end_reason,
      current_node_id: run.current_node_id,
      waiting: run.waiting?.kind || null,
      vars,
      messages: ctx.outbox,
    };
  }
}

module.exports = new FlowEngine();
