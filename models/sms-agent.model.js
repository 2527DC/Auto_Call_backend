const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SMSAgentSchema = new Schema(
  {
    user_id : {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      default: null
    },
    language: {
      type: String,
      default: 'en'
    },
    llm_model: {
      type: Schema.Types.ObjectId,
      ref: 'AIModel',
      default: null
    },
    transfer_to_human: {
      enabled: {
        type: Boolean,
        default: false
      },
      transfer_keywords: {
        type: [String],
        default: []
      }
    },
    knowledge_base: [
      {
        type: Schema.Types.ObjectId,
        ref: 'KnowledgeBase'
      }
    ],
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    }
  },
  {
    collection: 'sms_agents',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  }
)

addVirtualId(SMSAgentSchema)

SMSAgentSchema.index({ user_id: 1 })
SMSAgentSchema.index({ status: 1 })

module.exports = mongoose.model('SMSAgent', SMSAgentSchema);
