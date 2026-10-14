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
      // Twilio and Plivo status callbacks store busy as 'declined' and no-answer as 'missed'.
      enum: ['queued', 'initiated', 'ringing', 'in-progress', 'completed', 'failed', 'busy', 'no-answer', 'canceled', 'declined', 'missed'],
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
    recording_sid: {
      type: String,
      default: null
    },
    recording_duration: {
      type: Number,
      default: null
    },
    transcript: [
      {
        role: { type: String, enum: ['agent', 'user', 'human'] },
        text: String,
        timestamp: { type: Date, default: Date.now },
        // The caller cut this agent line off; heard is the part they heard.
        interrupted: Boolean,
        heard: String
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
    // When the person picked up (set where the provider tells us, e.g. WhatsApp calls).
    answered_at: {
      type: Date,
      default: null
    },
    extracted_data: {
      type: Schema.Types.Mixed,
      default: {}
    },
    // What the caller made clear during the call ("not interested", "call me
    // at 6", "don't call me"), recorded the moment it happened. Used for the
    // call's outcome and follow-ups.
    live_signals: [{
      _id: false,
      type: { type: String },
      said: String,
      // For a workflow's "Set outcome" step.
      outcome_key: String,
      node_id: String,
      at: Date,
      callback_at: Date,
      callback_asked: Boolean,
      transferred: Boolean
    }],
    // Where a workflow conversation stands between turns (re-asks used, a
    // question of the agent's own waiting for its answer).
    conversation_state: {
      type: Schema.Types.Mixed,
      default: {}
    },
    // Set when this call was placed to carry out a follow-up (a callback or a retry).
    follow_up_id: {
      type: Schema.Types.ObjectId,
      ref: 'FollowUp',
      default: null
    },
    // Why the call ended (caller hung up, agent said goodbye, silence, ...).
    end_reason: {
      type: String,
      default: null
    },
    // What happened on the call (services/outcomeService.js). state tracks the
    // analysis: pending -> processing -> done | waiting_transcript | skipped | failed.
    outcome: {
      state: { type: String, default: null },
      key: { type: String, default: null },
      label: { type: String, default: null },
      reached: { type: Boolean, default: null },
      result: { type: String, default: null },
      summary: { type: String, default: null },
      sentiment: { type: String, default: null },
      confidence: { type: Number, default: null },
      reasons: [{ _id: false, text: String, quote: String }],
      details: { type: Schema.Types.Mixed, default: undefined },
      follow_up: {
        requested: { type: Boolean, default: undefined },
        at: { type: Date, default: undefined },
        note: { type: String, default: undefined }
      },
      // rule | workflow | live | ai | person
      source: { type: String, default: null },
      // The AI's suggestion when a person (or a lock) decided otherwise.
      ai_suggestion: { type: Schema.Types.Mixed, default: undefined },
      locked: { type: Boolean, default: false },
      set_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      set_at: { type: Date, default: null },
      model: { type: String, default: null },
      settings_version: { type: Number, default: null },
      trimmed: { type: Boolean, default: undefined },
      // A person's note when they set the outcome.
      note: { type: String, default: undefined },
      error: { type: String, default: null },
      attempts: { type: Number, default: 0 },
      claimed_at: { type: Date, default: null },
      charged: { type: Boolean, default: false }
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
    // Set once when the call is charged, so the stream close and the provider's
    // status callback can't both charge it.
    credits_charged: {
      type: Boolean,
      default: false
    },
    // What the call used from paid providers, for the cost and profit report.
    usage: {
      telephony_provider: { type: String, default: null },
      stt_provider: { type: String, default: null },
      stt_seconds: { type: Number, default: 0 },
      tts_provider: { type: String, default: null },
      tts_characters: { type: Number, default: 0 },
      llm_input_tokens: { type: Number, default: 0 },
      llm_output_tokens: { type: Number, default: 0 }
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

CallSchema.index({ user_id: 1, 'outcome.key': 1, created_at: -1 });
CallSchema.index({ 'outcome.state': 1, updated_at: 1 });

module.exports = mongoose.model('Call', CallSchema);
