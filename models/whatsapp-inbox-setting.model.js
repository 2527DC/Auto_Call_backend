const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

// Per-account WhatsApp inbox settings: the AI auto-reply and saved quick replies.
const WhatsappInboxSettingSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    ai: {
      // When on, the AI answers messages that no automation picks up.
      enabled: { type: Boolean, default: false },
      instructions: {
        type: String,
        default: 'You are a friendly assistant for our business on WhatsApp. Answer briefly and politely. If you are not sure, say a team member will follow up.',
      },
      knowledge_base_ids: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeBase' }],
      // After this many AI replies in one chat, the AI stops and the chat waits for a person.
      max_replies: { type: Number, default: 10 },
      // Words that make the AI hand over to a person straight away.
      handoff_keywords: { type: [String], default: ['agent', 'human', 'person', 'call me'] },
      handoff_message: { type: String, default: 'Thanks! A team member will reply to you shortly.' },
    },
    quick_replies: [
      {
        title: { type: String, trim: true, required: true },
        text: { type: String, trim: true, required: true },
      },
    ],
  },
  {
    collection: 'whatsapp_inbox_settings',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(WhatsappInboxSettingSchema);

module.exports = mongoose.model('WhatsappInboxSetting', WhatsappInboxSettingSchema);
