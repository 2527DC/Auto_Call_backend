const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

// One customer going through one flow. While active it is either moving or
// waiting (for a reply, a delay, or AI chat turns) at current_node_id.
const WhatsappFlowRunSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    flow_id: { type: Schema.Types.ObjectId, ref: 'WhatsappFlow', required: true },
    conversation_id: { type: Schema.Types.ObjectId, ref: 'WhatsappConversation', default: null },
    // Test runs from the builder's simulator send nothing to WhatsApp.
    simulation: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'completed', 'handed_off', 'timed_out', 'stopped', 'failed'], default: 'active' },
    current_node_id: { type: String, default: null },
    waiting: {
      kind: { type: String, enum: ['reply', 'input', 'delay', 'ai_chat', 'slot', null], default: null },
      since: { type: Date, default: null },
      resume_at: { type: Date, default: null },
      // Slots offered by an appointment step, keyed by row id.
      options: { type: Schema.Types.Mixed, default: null },
      turns: { type: Number, default: 0 },
    },
    vars: { type: Schema.Types.Mixed, default: {} },
    reprompts: { type: Number, default: 0 },
    last_advanced_at: { type: Date, default: Date.now },
    ended_at: { type: Date, default: null },
    end_reason: { type: String, default: null },
    events: [
      {
        _id: false,
        at: { type: Date, default: Date.now },
        type: { type: String },
        node_id: { type: String },
        detail: { type: String },
      },
    ],
  },
  {
    collection: 'whatsapp_flow_runs',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(WhatsappFlowRunSchema);

// At most one active run per conversation.
WhatsappFlowRunSchema.index(
  { conversation_id: 1 },
  { unique: true, partialFilterExpression: { status: 'active', simulation: false } }
);
WhatsappFlowRunSchema.index({ flow_id: 1, created_at: -1 });
WhatsappFlowRunSchema.index({ status: 1, 'waiting.resume_at': 1 });

module.exports = mongoose.model('WhatsappFlowRun', WhatsappFlowRunSchema);
