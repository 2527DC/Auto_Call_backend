const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const WhatsappMessageSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    conversation_id: { type: Schema.Types.ObjectId, ref: 'WhatsappConversation', required: true },
    // internal: a note for the team or a system event, never sent to WhatsApp.
    direction: { type: String, enum: ['inbound', 'outbound', 'internal'], required: true },
    sender: { type: String, enum: ['customer', 'agent', 'bot', 'ai', 'system'], required: true },
    sent_by_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    sent_by_member_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', default: null },
    type: {
      type: String,
      enum: ['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contacts', 'interactive', 'button_reply', 'template', 'note', 'event', 'unsupported'],
      default: 'text',
    },
    text: { type: String, default: '' },
    media: {
      meta_id: { type: String, default: null },
      url: { type: String, default: null },
      mime_type: { type: String, default: null },
      filename: { type: String, default: null },
      size: { type: Number, default: null },
    },
    location: {
      latitude: Number,
      longitude: Number,
      name: String,
      address: String,
    },
    // Outbound buttons/list as sent, or the button/row the customer tapped.
    interactive: { type: Schema.Types.Mixed, default: null },
    template: {
      name: { type: String, default: null },
      language: { type: String, default: null },
    },
    reply_to_message_id: { type: Schema.Types.ObjectId, ref: 'WhatsappMessage', default: null },
    reactions: [
      {
        _id: false,
        actor: { type: String, enum: ['customer', 'agent'] },
        emoji: String,
        at: { type: Date, default: Date.now },
      },
    ],
    wamid: { type: String, default: null },
    status: { type: String, enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'received'], default: 'pending' },
    error: {
      code: { type: Number, default: null },
      message: { type: String, default: null },
    },
    flow_run_id: { type: Schema.Types.ObjectId, ref: 'WhatsappFlowRun', default: null },
  },
  {
    collection: 'whatsapp_messages',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(WhatsappMessageSchema);

WhatsappMessageSchema.index({ conversation_id: 1, created_at: -1 });
// Meta retries webhooks; the same wamid is stored once.
WhatsappMessageSchema.index({ wamid: 1 }, { unique: true, partialFilterExpression: { wamid: { $type: 'string' } } });

module.exports = mongoose.model('WhatsappMessage', WhatsappMessageSchema);
