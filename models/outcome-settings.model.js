const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

// One per client: their call outcomes and lead statuses (started from a preset
// in utils/outcomePresets.js, then renamed or extended), and follow-up defaults.
// Clients without one use the General preset.
const OutcomeSchema = new Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  description: { type: String, default: '' },
  reached: { type: Boolean, default: true },
  result: { type: String, enum: ['good', 'bad', 'neutral'], default: 'neutral' },
  next_step: { type: String, enum: ['none', 'retry', 'follow_up', 'team_task'], default: 'none' },
  stops_calls: { type: Boolean, default: false },
  lead_status: { type: String, default: null },
  system: { type: Boolean, default: false },
  archived: { type: Boolean, default: false },
  order: { type: Number, default: 0 }
}, { _id: false });

const LeadStatusSchema = new Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  kind: { type: String, enum: ['open', 'won', 'lost', 'closed'], default: 'open' },
  order: { type: Number, default: 0 }
}, { _id: false });

const OutcomeSettingsSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    preset: { type: String, default: 'general' },
    // What counts as success on this client's calls; agents can set their own.
    success_description: { type: String, default: '' },
    outcomes: { type: [OutcomeSchema], default: [] },
    lead_statuses: { type: [LeadStatusSchema], default: [] },
    follow_up: {
      // ai_call: the agent calls back at the due time; team: a task for the team.
      mode: { type: String, enum: ['ai_call', 'team'], default: 'ai_call' },
      max_attempts: { type: Number, default: 2, min: 1, max: 5 },
      // Not reached (no answer, busy): try again after this many hours.
      retry_after_hours: { type: Number, default: 4, min: 1, max: 72 },
      // Unreachable after this many calls that didn't reach the person.
      max_unreached: { type: Number, default: 3, min: 1, max: 10 }
    },
    summary_language: { type: String, default: 'English' },
    // A morning summary (9 AM India time): yesterday's calls and today's follow-ups.
    digest: {
      enabled: { type: Boolean, default: false },
      email: { type: String, default: '' },
      // An approved WhatsApp template with one body variable for the summary text.
      whatsapp_template_id: { type: Schema.Types.ObjectId, ref: 'WhatsAppTemplate', default: null },
      whatsapp_to: { type: String, default: '' },
      last_sent_on: { type: String, default: null }
    },
    // Bumped on every change, and stored with each analysis.
    version: { type: Number, default: 1 }
  },
  {
    collection: 'outcome_settings',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

addVirtualId(OutcomeSettingsSchema);

module.exports = mongoose.model('OutcomeSettings', OutcomeSettingsSchema);
