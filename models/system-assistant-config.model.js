const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const DEFAULT_SUGGESTED_PROMPTS = [
  'How do I create a workflow?',
  'How does the Decision Split node work?',
  'How do I add or import contacts?',
  'How do I configure an AI voice agent?'
];

const DEFAULT_SYSTEM_PROMPT = `You are Voxeno Assistant, the in-app guide for Voxeno (AutoCall).
Your mission is to help members and team members understand and use the platform effectively.

GUIDELINES:
1. Ground your answers strictly in the provided SYSTEM KNOWLEDGE BASE.
2. Provide step-by-step instructions with clear formatting (headings, numbered steps, bold UI labels).
3. If explaining workflow nodes, describe their purpose, parameters, connections, and common use cases.
4. If a question is outside the scope of Voxeno or information is missing from the knowledge base, politely state that this information is not yet in the system documentation and suggest contacting the administrator or checking the support center.
5. Keep your tone encouraging, helpful, professional, and clear. Avoid guessing internal URLs or server credentials.`;

const SystemAssistantConfigSchema = new Schema(
  {
    is_enabled: {
      type: Boolean,
      default: true
    },
    bot_name: {
      type: String,
      default: 'Voxeno Assistant'
    },
    welcome_message: {
      type: String,
      default: 'Hi there! I can help you build workflows, import contacts, configure nodes, and set up your AI voice agents. What would you like to know?'
    },
    ai_provider: {
      type: String,
      enum: ['gemini', 'openai', 'anthropic'],
      default: 'gemini'
    },
    ai_model: {
      type: String,
      default: 'gemini-2.5-flash'
    },
    custom_api_key: {
      type: String,
      default: null
    },
    temperature: {
      type: Number,
      default: 0.2
    },
    system_prompt: {
      type: String,
      default: DEFAULT_SYSTEM_PROMPT
    },
    suggested_prompts: {
      type: [String],
      default: DEFAULT_SUGGESTED_PROMPTS
    },
    updated_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    collection: 'system_assistant_config',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

addVirtualId(SystemAssistantConfigSchema);

module.exports = mongoose.model('SystemAssistantConfig', SystemAssistantConfigSchema);
