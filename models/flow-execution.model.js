const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const FlowExecutionSchema = new Schema(
  {
    flow_id: {
      type: Schema.Types.ObjectId,
      ref: 'Flow',
      required: true
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    agent_id: {
      type: Schema.Types.ObjectId,
      ref: 'Agent',
      default: null
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'waiting', 'success', 'failed', 'cancelled'],
      default: 'pending'
    },
    current_node_id: {
      type: String,
      default: null
    },
    next_node_id: {
      type: String,
      default: null
    },
    context: {
      type: Schema.Types.Mixed,
      default: {}
    },
    logs: [
      {
        node_id: String,
        node_type: String,
        status: { type: String, enum: ['success', 'failed', 'running'] },
        input: Schema.Types.Mixed,
        output: Schema.Types.Mixed,
        error: Schema.Types.Mixed,
        timestamp: { type: Date, default: Date.now }
      }
    ],
    started_at: {
      type: Date,
      default: Date.now
    },
    completed_at: {
      type: Date,
      default: null
    },
    error_message: {
      type: String,
      default: null
    }
  },
  {
    collection: 'flow_executions',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(FlowExecutionSchema);

FlowExecutionSchema.index({ flow_id: 1 });
FlowExecutionSchema.index({ user_id: 1 });
FlowExecutionSchema.index({ status: 1 });

module.exports = mongoose.model('FlowExecution', FlowExecutionSchema);