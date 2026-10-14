const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const AgentSchema = new Schema(
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
    type: {
      type: String,
      enum: ['incoming', 'flow'],
      default: 'incoming'
    },
    flow_id: {
      type: Schema.Types.ObjectId,
      ref: 'Flow',
      default: null
    },
    voice_tone: {
      type: String,
      default: null
    },
    personality: {
      type: String,
      default: null
    },
    description: {
      type: String,
      default: null
    },
    speech_speed: {
      type: Number,
      default: 1.0,
      min: 0.5,
      max: 2.0
    },
    pitch: {
      type: Number,
      default: 0,
      min: -10,
      max: 10
    },
    empathy_level: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    energy_level: {
      type: String,
      enum: ['calm', 'balanced', 'energetic'],
      default: 'balanced'
    },
    idle_timeout: {
      type: Number,
      default: 60,
      min: 0
    },
    accuracy_priority: {
      type: String,
      enum: ['balanced', 'high_accuracy', 'low_latency'],
      default: 'balanced'
    },
    intelligence_level: {
      type: Number,
      default: 7,
      min: 0,
      max: 10
    },
    response_length: {
      type: String,
      enum: ['concise', 'balanced', 'verbose'],
      default: 'balanced'
    },
    enable_call_transcription: {
      type: Boolean,
      default: true
    },
    telephony_provider: {
      type: String,
      enum: ['twilio', 'sip', 'meta_whatsapp', 'plivo'],
      default: 'twilio'
    },
    elevenlabs_agent_id: {
      type: String,
      default: null
    },
    voice_provider: {
      type: String,
      enum: ['elevenlabs', 'deepgram', 'sarvam_ai'],
      default: 'elevenlabs'
    },
    voice_id: {
      type: String,
      default: null
    },
    // ElevenLabs voice model for this agent; null (or a model the admin no
    // longer allows) uses the admin's default (elevenlabsService.resolveModel).
    tts_model: {
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
    temperature: {
      type: Number,
      default: 0.5
    },
    response_delay: {
      type: Number,
      default: 0
    },
    expression_mode: {
      type: Boolean,
      default: false
    },
    system_prompt: {
      type: String,
      default: null
    },
    first_message: {
      type: String,
      default: null
    },
    goodbye_message: {
      type: String,
      default: null
    },
    custom_knowledge_base: {
      type: String,
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
      },
      team_id: {
        type: Schema.Types.ObjectId,
        ref: 'Team',
        default: null
      },
      member_id: {
        type: Schema.Types.ObjectId,
        ref: 'TeamMember',
        default: null
      }
    },
    max_call_duration: {
      type: Number,
      default: null,
      min: 0
    },
    // After each call the AI writes a summary, picks the outcome and fills in
    // the details to collect (a Lead Capture Form). See services/outcomeService.js.
    analysis: {
      enabled: { type: Boolean, default: true },
      form_id: { type: Schema.Types.ObjectId, ref: 'Form', default: null },
      // What counts as success for this agent's calls (else the client's default).
      success_description: { type: String, default: '' },
      extra_instructions: { type: String, default: '' },
      // Who follows up at the due time: the client's default, the AI, the team, or nobody.
      follow_up_mode: { type: String, enum: ['default', 'ai_call', 'team', 'off'], default: 'default' },
      // A connected Google Sheet that gets one row per analysed call.
      google_sheet_id: { type: Schema.Types.ObjectId, ref: 'GoogleSheet', default: null }
    },
    // Outgoing calls: wait for the customer's "Hello?" before greeting, or greet
    // the moment the call connects. Incoming calls always greet at once.
    greeting_mode: {
      type: String,
      enum: ['wait_for_hello', 'immediate'],
      default: 'wait_for_hello'
    },
    // With wait_for_hello: greet anyway after this long without a hello.
    hello_wait_ms: {
      type: Number,
      default: 1000,
      min: 300,
      max: 3000
    },
    // The caller may talk over the agent: clear speech stops it and is answered.
    allow_interruptions: {
      type: Boolean,
      default: true
    },
    // How readily it stops: low needs longer, louder speech (noisy places),
    // high stops at the first words.
    interruption_sensitivity: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    enable_call_recording: {
      type: Boolean,
      default: false
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
    collection: 'agents',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

AgentSchema.pre('validate', function(next) {
  if (this.telephony_provider === 'deepgram_twilio' || this.telephony_provider === 'deepgram_sip') {
    this.voice_provider = 'deepgram';
  } else if (this.telephony_provider === 'elevenlabs_twilio' || this.telephony_provider === 'elevenlabs_sip') {
    this.voice_provider = 'elevenlabs';
  }
  next();
});

AgentSchema.pre('save', function(next) {
  if (this.telephony_provider === 'deepgram_twilio' || this.telephony_provider === 'deepgram_sip') {
    this.voice_provider = 'deepgram';
  } else if (this.telephony_provider === 'elevenlabs_twilio' || this.telephony_provider === 'elevenlabs_sip') {
    this.voice_provider = 'elevenlabs';
  }
  next();
});

addVirtualId(AgentSchema);

AgentSchema.index({ user_id: 1 });
AgentSchema.index({ status: 1 });

module.exports = mongoose.model('Agent', AgentSchema);