const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const FlowSchema = new Schema(
  {
    user_id: {
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
      default: ''
    },
    nodes: [
      {
        id: { type: String, required: true },
        type: {
          type: String,
          required: true,
          enum: [
            'message_output',
            'input_capture',
            'decision_split',
            'book_slot',
            'data_capture',
            'api_request',
            'redirect_call',
            'wait_delay',
            'audio_playback',
            'email_notice',
            'whatsapp_notice',
            'terminate_call',
            'variable_map',
            'agent_jump',
            'team_alert'
          ]
        },
        position: {
          x: { type: Number, default: 0 },
          y: { type: Number, default: 0 }
        },
        data: {
          type: Schema.Types.Mixed,
          default: {}
        }
      }
    ],
    edges: [
      {
        id: { type: String, required: true },
        source: { type: String, required: true },
        target: { type: String, required: true },
        sourceHandle: { type: String, default: null },
        targetHandle: { type: String, default: null }
      }
    ],
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },
    system_flow: {
      type: Boolean,
      default: false
    },
    deleted_at: {
      type: Date,
      default: null
    }
  },
  {
    collection: 'flows',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(FlowSchema);

FlowSchema.index({ user_id: 1 });
FlowSchema.index({ status: 1 });
FlowSchema.index({ deleted_at: 1 });

module.exports = mongoose.model('Flow', FlowSchema);