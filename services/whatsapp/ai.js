'use strict';

const { db } = require('../../models');
const { WhatsappInboxSetting, WhatsappMessage, UserSettings, KnowledgeBase } = db;
const llmService = require('../llmService');

const KNOWLEDGE_CHARS = 15000;

const WHATSAPP_RULES = [
  'You are replying to a customer on WhatsApp.',
  'Keep replies short (under 80 words) and in plain text, without markdown headings or tables.',
  "Reply in the customer's language and style (English, Hindi, Hinglish, Kannada, Tamil, Telugu…).",
  'Only state prices, dates, offers or policies that appear in the knowledge below. If you are not sure, say a team member will confirm.',
].join(' ');

// The last messages of a chat, as turns for the AI model.
const historyFor = async (conversationId, limit = 12) => {
  const messages = await WhatsappMessage.find({ conversation_id: conversationId, direction: { $ne: 'internal' } })
    .sort({ created_at: -1 })
    .limit(limit)
    .select('direction text type')
    .lean();
  return messages
    .reverse()
    .filter((m) => m.text)
    .map((m) => ({ role: m.direction === 'inbound' ? 'user' : 'assistant', content: m.text }));
};

// An AI answer for an account, using its WhatsApp AI instructions and knowledge bases.
// history is a list of { role: 'user' | 'assistant', content } ending with the customer's message.
const generateReply = async ({ accountId, history, extraInstructions = '' }) => {
  const [settings, userSettings] = await Promise.all([
    WhatsappInboxSetting.findOne({ user_id: accountId }).lean(),
    UserSettings.findOne({ user: accountId }).populate('ai_model').lean(),
  ]);
  if (!userSettings?.ai_model || !userSettings.ai_api_key) {
    throw new Error('No AI model is set up for this account. Choose one under Settings → AI model.');
  }

  const kbIds = settings?.ai?.knowledge_base_ids || [];
  const knowledge = kbIds.length
    ? (await KnowledgeBase.find({ _id: { $in: kbIds }, user_id: accountId }).select('name content').lean())
        .map((kb) => `## ${kb.name}\n${kb.content || ''}`)
        .join('\n\n')
        .slice(0, KNOWLEDGE_CHARS)
    : '';

  const systemPrompt = [
    settings?.ai?.instructions || WhatsappInboxSetting.schema.path('ai.instructions').defaultValue,
    extraInstructions,
    WHATSAPP_RULES,
    knowledge && `KNOWLEDGE:\n${knowledge}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const reply = await llmService.generateChatAssistantResponse({
    messages: history,
    systemPrompt,
    provider: userSettings.ai_model.provider,
    model: userSettings.ai_model.model_id,
    apiKey: userSettings.ai_api_key,
    temperature: 0.3,
    maxTokens: 400,
  });
  return String(reply || '').trim();
};

const matchesKeyword = (text, keywords = []) => {
  const t = String(text || '').toLowerCase();
  return keywords.some((k) => k && t.includes(String(k).toLowerCase().trim()));
};

module.exports = { generateReply, historyFor, matchesKeyword };
