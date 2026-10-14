const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

// Something to do about a person at a time: call them back (the AI agent, or a
// team member), or a task for the team. Created from call outcomes, campaign
// retries, missed incoming calls, or by hand (services/followUpService.js).
const FollowUpSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    contact_id: { type: Schema.Types.ObjectId, ref: 'Contact', default: null },
    phone: { type: String, default: null },
    name: { type: String, default: '' },
    // The call it came from, and the agent / campaign / number to call back with.
    call_id: { type: Schema.Types.ObjectId, ref: 'Call', default: null },
    agent_id: { type: Schema.Types.ObjectId, ref: 'Agent', default: null },
    campaign_id: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    from_number: { type: String, default: null },
    due_at: { type: Date, required: true },
    // callback_requested, interested, needs_info, complaint, couldnt_understand,
    // call_dropped, retry_not_reached, missed_inbound, unreachable, manual
    reason: { type: String, required: true },
    note: { type: String, default: '' },
    // What the person said, e.g. "busy now, call after 6".
    said: { type: String, default: '' },
    // ai_call: the agent calls at due_at; team: a task for the team.
    mode: { type: String, enum: ['ai_call', 'team'], default: 'team' },
    assigned_member_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', default: null },
    status: { type: String, enum: ['pending', 'in_progress', 'done', 'missed', 'cancelled'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    max_attempts: { type: Number, default: 2 },
    last_attempt_at: { type: Date, default: null },
    last_call_id: { type: Schema.Types.ObjectId, ref: 'Call', default: null },
    closed_at: { type: Date, default: null },
    closed_reason: { type: String, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // When the team was told this task is due (once).
    due_notified_at: { type: Date, default: null },
    error: { type: String, default: null }
  },
  {
    collection: 'follow_ups',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

addVirtualId(FollowUpSchema);

FollowUpSchema.index({ user_id: 1, status: 1, due_at: 1 });
FollowUpSchema.index({ contact_id: 1, status: 1 });
FollowUpSchema.index({ status: 1, mode: 1, due_at: 1 });

module.exports = mongoose.model('FollowUp', FollowUpSchema);
