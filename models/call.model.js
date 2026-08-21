const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const CallSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    flow_id: {
      type: Schema.Types.ObjectId,
      ref: 'Flow',
      default: null
    },
    agent_id: {
      type: Schema.Types.ObjectId,
      ref: 'Agent',
      default: null
    },
    campaign_id: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign',
      default: null
    },
    contact_id: {
      type: Schema.Types.ObjectId,
      ref: 'Contact',
      default: null
    },
    lead_name: {
      type: String,
      default: ''
    },
    fail_reason: {
      type: String,
      default: ''
    },
    twilio_call_sid: {
      type: String,
      required: true,
      unique: true
    },
    from_number: {
      type: String,
      required: true
    },
    to_number: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['queued', 'initiated', 'ringing', 'in-progress', 'completed', 'failed', 'busy', 'no-answer', 'canceled'],
      default: 'queued'
    },
    direction: {
      type: String,
      enum: ['outbound', 'inbound'],
      default: 'outbound'
    },
    duration: {
      type: Number,
      default: 0
    },
    recording_url: {
      type: String,
      default: null
    },
    transcript: [
      {
        role: { type: String, enum: ['agent', 'user', 'human'] },
        text: String,
        timestamp: { type: Date, default: Date.now }
      }
    ],
    execution_logs: [
      {
        node_id: String,
        node_type: String,
        timestamp: { type: Date, default: Date.now }
      }
    ],
    started_at: {
      type: Date,
      default: Date.now
    },
    ended_at: {
      type: Date,
      default: null
    },
    extracted_data: {
      type: Schema.Types.Mixed,
      default: {}
    },
    detected_words: [{
      type: String
    }],
    has_restricted_words: {
      type: Boolean,
      default: false
    },
    transcript_snippet: {
      type: String
    },
    credits_used: {
      type: Number,
      default: 0
    },
    post_call_handled: {
      type: Boolean,
      default: false
    },
    is_transferred: {
      type: Boolean,
      default: false
    },
    transfer_member_id: {
      type: Schema.Types.ObjectId,
      ref: 'TeamMember',
      default: null
    },
    transfer_details: {
      transferred_at: { type: Date, default: null },
      answered_at: { type: Date, default: null },
      ended_at: { type: Date, default: null },
      human_duration: { type: Number, default: 0 },
      human_recording_url: { type: String, default: null },
      human_transcript: [
        {
          role: { type: String, enum: ['human', 'user'] },
          text: String,
          timestamp: { type: Date, default: Date.now }
        }
      ],
      human_call_status: {
        type: String,
        enum: ['initiated', 'ringing', 'answered', 'missed', 'declined', 'failed', 'completed'],
        default: 'initiated'
      }
    }
  },
  {
    collection: 'calls',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(CallSchema);

CallSchema.index({ user_id: 1 });
CallSchema.index({ flow_id: 1 });
CallSchema.index({ twilio_call_sid: 1 });

module.exports = mongoose.model('Call', CallSchema);
