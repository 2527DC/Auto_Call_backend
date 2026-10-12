const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

// A WhatsApp chatbot flow. Nodes and edges are stored as the builder's canvas
// keeps them: edges join a node's output handle (next, true, btn:<id>, ...) to the next node.
const WhatsappFlowSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['draft', 'active', 'paused'], default: 'draft' },
    trigger: {
      type: { type: String, enum: ['keyword', 'first_message', 'any_message'], default: 'keyword' },
      keywords: { type: [String], default: [] },
      match: { type: String, enum: ['exact', 'contains'], default: 'contains' },
    },
    // Lower runs first when several flows match the same message.
    priority: { type: Number, default: 100 },
    settings: {
      // A reply that matches no button or row: ask again, hand over to a person, or end.
      on_unknown_reply: { type: String, enum: ['reprompt', 'handoff', 'end'], default: 'reprompt' },
      max_reprompts: { type: Number, default: 2 },
      // A run waiting longer than this for the customer is closed.
      timeout_hours: { type: Number, default: 24 },
    },
    nodes: { type: [Schema.Types.Mixed], default: [] },
    edges: { type: [Schema.Types.Mixed], default: [] },
    stats: {
      runs: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      handed_off: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    deleted_at: { type: Date, default: null },
  },
  {
    collection: 'whatsapp_flows',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(WhatsappFlowSchema);

WhatsappFlowSchema.index({ user_id: 1, status: 1, priority: 1 });

module.exports = mongoose.model('WhatsappFlow', WhatsappFlowSchema);
