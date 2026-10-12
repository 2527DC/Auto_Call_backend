const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

// One chat thread per customer per WhatsApp business number.
const WhatsappConversationSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    phone_number_id: { type: Schema.Types.ObjectId, ref: 'WhatsappPhoneNumber', required: true },
    waba_id: { type: Schema.Types.ObjectId, ref: 'WhatsappWaba', required: true },
    contact_id: { type: Schema.Types.ObjectId, ref: 'Contact', default: null },
    // The customer's WhatsApp id (their number in digits, e.g. 919876543210).
    wa_id: { type: String, required: true },
    profile_name: { type: String, default: '' },
    status: { type: String, enum: ['open', 'pending', 'resolved'], default: 'open' },
    assigned_member_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', default: null },
    labels: { type: [String], default: [] },
    unread_count: { type: Number, default: 0 },
    last_message: {
      text: { type: String, default: '' },
      type: { type: String, default: 'text' },
      direction: { type: String, enum: ['inbound', 'outbound', 'internal'], default: 'inbound' },
      at: { type: Date, default: null },
    },
    // Free-form replies are allowed for 24 hours after the customer's last message.
    last_inbound_at: { type: Date, default: null },
    // An agent replied by hand: automations and AI replies stay quiet until resumed or resolved.
    bot_paused: { type: Boolean, default: false },
    ai_reply_count: { type: Number, default: 0 },
  },
  {
    collection: 'whatsapp_conversations',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(WhatsappConversationSchema);

WhatsappConversationSchema.index({ phone_number_id: 1, wa_id: 1 }, { unique: true });
WhatsappConversationSchema.index({ user_id: 1, status: 1, 'last_message.at': -1 });
WhatsappConversationSchema.index({ user_id: 1, assigned_member_id: 1 });

module.exports = mongoose.model('WhatsappConversation', WhatsappConversationSchema);
