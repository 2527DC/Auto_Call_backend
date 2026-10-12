'use strict';

const mongoose = require('mongoose');
const { db } = require('../models');
const { WhatsappFlow, WhatsappFlowRun, WhatsappInboxSetting, KnowledgeBase, ContactGroup, TeamMember, Agent, PhoneNumber, GoogleCalendar, UserSettings } = db;
const flowEngine = require('../services/whatsapp/flowEngine');
const ai = require('../services/whatsapp/ai');
const { fromTemplate, TEMPLATES } = require('../services/whatsapp/flowTemplates');
const storageService = require('../services/storageService');
const { accountIdOf } = require('../middlewares/whatsappBeta');

const isId = (id) => mongoose.Types.ObjectId.isValid(id);
const NODE_TYPES = new Set(['start', 'message', 'buttons', 'list', 'question', 'condition', 'delay', 'set_variable', 'contact', 'handoff', 'ai_reply', 'webhook', 'appointment', 'voice_call', 'end']);

const fail = (res, error, fallback) => {
  console.error(fallback, error);
  res.status(500).json({ success: false, message: fallback });
};

// The parts of a flow the builder may change, cleaned up.
const flowFields = (body) => {
  const out = {};
  if (typeof body.name === 'string') out.name = body.name.trim().slice(0, 100) || 'Untitled automation';
  if (typeof body.description === 'string') out.description = body.description.trim().slice(0, 500);
  if (body.trigger) {
    out.trigger = {
      type: ['keyword', 'first_message', 'any_message'].includes(body.trigger.type) ? body.trigger.type : 'keyword',
      keywords: (Array.isArray(body.trigger.keywords) ? body.trigger.keywords : []).map((k) => String(k).trim().slice(0, 50)).filter(Boolean).slice(0, 30),
      match: body.trigger.match === 'exact' ? 'exact' : 'contains',
    };
  }
  if (body.settings) {
    out.settings = {
      on_unknown_reply: ['reprompt', 'handoff', 'end'].includes(body.settings.on_unknown_reply) ? body.settings.on_unknown_reply : 'reprompt',
      max_reprompts: Math.min(5, Math.max(0, Number(body.settings.max_reprompts ?? 2))),
      timeout_hours: Math.min(72, Math.max(1, Number(body.settings.timeout_hours ?? 24))),
    };
  }
  if (body.priority !== undefined) out.priority = Math.min(1000, Math.max(0, Number(body.priority) || 0));
  if (Array.isArray(body.nodes)) {
    out.nodes = body.nodes
      .filter((n) => n && typeof n.id === 'string' && NODE_TYPES.has(n.type))
      .slice(0, 200)
      .map((n) => ({
        id: n.id.slice(0, 64),
        type: n.type,
        position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 },
        data: n.data && typeof n.data === 'object' ? n.data : {},
      }));
  }
  if (Array.isArray(body.edges)) {
    out.edges = body.edges
      .filter((e) => e && typeof e.source === 'string' && typeof e.target === 'string')
      .slice(0, 400)
      .map((e) => ({
        id: String(e.id || `e_${e.source}_${e.sourceHandle || 'next'}_${e.target}`).slice(0, 200),
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || 'next',
      }));
  }
  return out;
};

const loadFlow = async (req, res) => {
  if (!isId(req.params.id)) {
    res.status(404).json({ success: false, message: 'Automation not found' });
    return null;
  }
  const flow = await WhatsappFlow.findOne({ _id: req.params.id, user_id: accountIdOf(req.user), deleted_at: null });
  if (!flow) res.status(404).json({ success: false, message: 'Automation not found' });
  return flow;
};

// GET /api/whatsapp-automations/flows
exports.listFlows = async (req, res) => {
  try {
    const flows = await WhatsappFlow.find({ user_id: accountIdOf(req.user), deleted_at: null })
      .select('-nodes -edges')
      .sort({ status: 1, priority: 1, created_at: -1 })
      .lean();
    const active = await WhatsappFlowRun.aggregate([
      { $match: { flow_id: { $in: flows.map((f) => f._id) }, status: 'active', simulation: false } },
      { $group: { _id: '$flow_id', n: { $sum: 1 } } },
    ]);
    const activeBy = Object.fromEntries(active.map((a) => [String(a._id), a.n]));
    res.json({
      success: true,
      data: flows.map(({ _id, ...f }) => ({ ...f, id: String(_id), active_runs: activeBy[String(_id)] || 0 })),
      templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, name: t.name, description: t.description })),
    });
  } catch (error) {
    fail(res, error, 'Failed to load automations');
  }
};

// POST /api/whatsapp-automations/flows { name, template }
exports.createFlow = async (req, res) => {
  try {
    const base = fromTemplate(req.body.template);
    const flow = await WhatsappFlow.create({
      ...base,
      ...flowFields({ name: req.body.name || base.name }),
      user_id: accountIdOf(req.user),
      status: 'draft',
    });
    res.status(201).json({ success: true, data: flow });
  } catch (error) {
    fail(res, error, 'Failed to create the automation');
  }
};

// GET /api/whatsapp-automations/flows/:id
exports.getFlow = async (req, res) => {
  try {
    const flow = await loadFlow(req, res);
    if (!flow) return;
    res.json({ success: true, data: flow, validation: flowEngine.validateFlow(flow) });
  } catch (error) {
    fail(res, error, 'Failed to load the automation');
  }
};

// PUT /api/whatsapp-automations/flows/:id — a live flow is only saved when it has no errors.
exports.updateFlow = async (req, res) => {
  try {
    const flow = await loadFlow(req, res);
    if (!flow) return;
    flow.set(flowFields(req.body));
    const validation = flowEngine.validateFlow(flow);
    if (flow.status === 'active' && validation.errors.length) {
      return res.status(422).json({ success: false, message: 'This automation is live, so it can only be saved without errors. Fix them or pause it first.', validation });
    }
    await flow.save();
    res.json({ success: true, data: flow, validation });
  } catch (error) {
    fail(res, error, 'Failed to save the automation');
  }
};

// POST /api/whatsapp-automations/flows/:id/status { status }
exports.setStatus = async (req, res) => {
  try {
    const flow = await loadFlow(req, res);
    if (!flow) return;
    const status = req.body.status;
    if (!['active', 'paused', 'draft'].includes(status)) return res.status(400).json({ success: false, message: 'Unknown status' });
    const validation = flowEngine.validateFlow(flow);
    if (status === 'active' && validation.errors.length) {
      return res.status(422).json({ success: false, message: 'Fix the errors before switching this automation on.', validation });
    }
    flow.status = status;
    await flow.save();
    if (status !== 'active') {
      await WhatsappFlowRun.updateMany({ flow_id: flow._id, status: 'active', simulation: false }, { $set: { status: 'stopped', end_reason: 'flow_paused', ended_at: new Date() } });
    }
    res.json({ success: true, data: flow, validation });
  } catch (error) {
    fail(res, error, 'Failed to change the automation status');
  }
};

// POST /api/whatsapp-automations/flows/:id/duplicate
exports.duplicateFlow = async (req, res) => {
  try {
    const flow = await loadFlow(req, res);
    if (!flow) return;
    const { _id, id, stats, created_at, updated_at, status, ...rest } = flow.toObject();
    const copy = await WhatsappFlow.create({ ...rest, name: `${flow.name} (copy)`.slice(0, 100), status: 'draft' });
    res.status(201).json({ success: true, data: copy });
  } catch (error) {
    fail(res, error, 'Failed to copy the automation');
  }
};

// DELETE /api/whatsapp-automations/flows/:id
exports.deleteFlow = async (req, res) => {
  try {
    const flow = await loadFlow(req, res);
    if (!flow) return;
    flow.deleted_at = new Date();
    flow.status = 'paused';
    await flow.save();
    await WhatsappFlowRun.updateMany({ flow_id: flow._id, status: 'active' }, { $set: { status: 'stopped', end_reason: 'flow_deleted', ended_at: new Date() } });
    res.json({ success: true, message: 'Automation deleted' });
  } catch (error) {
    fail(res, error, 'Failed to delete the automation');
  }
};

// GET /api/whatsapp-automations/flows/:id/runs — recent real runs, newest first.
exports.listRuns = async (req, res) => {
  try {
    const flow = await loadFlow(req, res);
    if (!flow) return;
    const runs = await WhatsappFlowRun.find({ flow_id: flow._id, simulation: false })
      .populate('conversation_id', 'profile_name wa_id')
      .sort({ created_at: -1 })
      .limit(100)
      .lean();
    res.json({
      success: true,
      data: runs.map((r) => {
        const { __history, ...vars } = r.vars || {};
        const node = flow.nodes.find((n) => n.id === r.current_node_id);
        return {
          id: String(r._id),
          status: r.status,
          end_reason: r.end_reason,
          step: node?.data?.label || node?.type || null,
          waiting: r.waiting?.kind || null,
          customer: r.conversation_id ? { name: r.conversation_id.profile_name, phone: `+${r.conversation_id.wa_id}`, conversation_id: String(r.conversation_id._id) } : null,
          vars,
          events: (r.events || []).slice(-30),
          created_at: r.created_at,
          ended_at: r.ended_at,
        };
      }),
    });
  } catch (error) {
    fail(res, error, 'Failed to load the runs');
  }
};

// POST /api/whatsapp-automations/flows/:id/simulate { run_id, text, interactive_id, definition }
// Tests the flow as drawn (definition) or as saved, without sending anything on WhatsApp.
exports.simulate = async (req, res) => {
  try {
    const flow = await loadFlow(req, res);
    if (!flow) return;
    const definition = req.body.definition ? flowFields(req.body.definition) : {};
    const testFlow = { ...flow.toObject(), ...definition, _id: flow._id };
    const result = await flowEngine.simulate({
      accountId: accountIdOf(req.user),
      flow: testFlow,
      runId: isId(req.body.run_id) ? req.body.run_id : null,
      input: { text: String(req.body.text || '').slice(0, 1000), interactive_id: req.body.interactive_id ? String(req.body.interactive_id) : null },
    });
    res.json({ success: true, data: result });
  } catch (error) {
    fail(res, error, 'Failed to run the test');
  }
};

// POST /api/whatsapp-automations/validate { nodes, edges, trigger }
exports.validate = async (req, res) => {
  res.json({ success: true, data: flowEngine.validateFlow(flowFields(req.body)) });
};

// GET /api/whatsapp-automations/options — choices for the builder's dropdowns.
exports.options = async (req, res) => {
  try {
    const accountId = accountIdOf(req.user);
    const [knowledgeBases, groups, members, agents, numbers, calendars] = await Promise.all([
      KnowledgeBase.find({ user_id: accountId }).select('name').sort({ name: 1 }).lean(),
      ContactGroup.find({ user_id: accountId }).select('group_name').sort({ group_name: 1 }).lean(),
      TeamMember.find({ user_id: accountId, status: 'active' }).select('first_name last_name email').lean(),
      Agent.find({ user_id: accountId, type: 'flow', status: 'active' }).select('name flow_id').lean(),
      PhoneNumber.find({ user_id: accountId }).select('phone_number provider').lean(),
      GoogleCalendar.find({ user_id: accountId }).select('name calendar_id').lean(),
    ]);
    res.json({
      success: true,
      data: {
        knowledge_bases: knowledgeBases.map((k) => ({ id: String(k._id), name: k.name })),
        contact_groups: groups.map((g) => ({ id: String(g._id), name: g.group_name })),
        team_members: members.map((m) => ({ id: String(m._id), name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.email })),
        voice_agents: agents.filter((a) => a.flow_id).map((a) => ({ id: String(a._id), name: a.name })),
        phone_numbers: numbers.map((n) => ({ id: String(n._id), number: n.phone_number, provider: n.provider })),
        calendars: calendars.map((c) => ({ id: c.calendar_id, name: c.name })),
      },
    });
  } catch (error) {
    fail(res, error, 'Failed to load the builder options');
  }
};

// POST /api/whatsapp-automations/media — a file for a message step.
exports.uploadMedia = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Choose a file' });
    const url = await storageService.uploadFile(req.file, accountIdOf(req.user), 'whatsapp-flows');
    const kind = req.file.mimetype.startsWith('image/') ? 'image' : req.file.mimetype.startsWith('video/') ? 'video' : 'document';
    res.status(201).json({ success: true, data: { url, type: kind, filename: req.file.originalname, mime_type: req.file.mimetype } });
  } catch (error) {
    fail(res, error, 'Failed to upload the file');
  }
};

const AI_FIELDS = (body) => ({
  enabled: !!body.enabled,
  instructions: String(body.instructions || '').trim().slice(0, 4000),
  knowledge_base_ids: (Array.isArray(body.knowledge_base_ids) ? body.knowledge_base_ids : []).filter(isId).slice(0, 20),
  max_replies: Math.min(100, Math.max(1, Number(body.max_replies) || 10)),
  handoff_keywords: (Array.isArray(body.handoff_keywords) ? body.handoff_keywords : []).map((k) => String(k).trim().slice(0, 40)).filter(Boolean).slice(0, 30),
  handoff_message: String(body.handoff_message || '').trim().slice(0, 1000),
});

// GET /api/whatsapp-automations/ai-settings
exports.getAiSettings = async (req, res) => {
  try {
    const accountId = accountIdOf(req.user);
    const [settings, userSettings] = await Promise.all([
      WhatsappInboxSetting.findOne({ user_id: accountId }).lean(),
      UserSettings.findOne({ user: accountId }).populate('ai_model', 'name model_id provider').lean(),
    ]);
    const defaults = new WhatsappInboxSetting({ user_id: accountId }).toObject().ai;
    res.json({
      success: true,
      data: {
        ...defaults,
        ...(settings?.ai || {}),
        model: userSettings?.ai_model && userSettings.ai_api_key
          ? { name: userSettings.ai_model.name || userSettings.ai_model.model_id, provider: userSettings.ai_model.provider }
          : null,
      },
    });
  } catch (error) {
    fail(res, error, 'Failed to load the AI settings');
  }
};

// PUT /api/whatsapp-automations/ai-settings
exports.saveAiSettings = async (req, res) => {
  try {
    const settings = await WhatsappInboxSetting.findOneAndUpdate(
      { user_id: accountIdOf(req.user) },
      { $set: { ai: AI_FIELDS(req.body) } },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: settings.ai });
  } catch (error) {
    fail(res, error, 'Failed to save the AI settings');
  }
};

// POST /api/whatsapp-automations/ai-settings/test { message, history }
exports.testAi = async (req, res) => {
  try {
    const history = (Array.isArray(req.body.history) ? req.body.history : [])
      .filter((m) => m && ['user', 'assistant'].includes(m.role) && m.content)
      .slice(-10)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 1000) }));
    history.push({ role: 'user', content: String(req.body.message || '').slice(0, 1000) });
    const reply = await ai.generateReply({ accountId: accountIdOf(req.user), history });
    res.json({ success: true, data: { reply } });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
