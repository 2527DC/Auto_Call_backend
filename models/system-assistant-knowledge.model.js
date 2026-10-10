const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SystemAssistantKnowledgeSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      enum: ['workflow_nodes', 'flows', 'contacts', 'campaigns', 'voice_agents', 'phone_numbers', 'settings', 'general', 'troubleshooting'],
      default: 'general'
    },
    route_match: {
      type: [String],
      default: [] // e.g. ["/workflow-builder", "/workflow-builder/*"]
    },
    content: {
      type: String,
      required: true
    },
    tags: {
      type: [String],
      default: []
    },
    order: {
      type: Number,
      default: 0
    },
    is_active: {
      type: Boolean,
      default: true
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    collection: 'system_assistant_knowledge',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

addVirtualId(SystemAssistantKnowledgeSchema);

module.exports = mongoose.model('SystemAssistantKnowledge', SystemAssistantKnowledgeSchema);
