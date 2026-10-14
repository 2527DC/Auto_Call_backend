const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');
const { normalizePhone } = require('../utils/phone');

const ContactSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    phone_number: {
      type: String,
      required: true,
      trim: true
    },
    // phone_number in one form (E.164, "+919845012345"), however it was typed,
    // so the same person is found from a call, an import or a WhatsApp chat.
    phone_e164: {
      type: String,
      default: null
    },
    first_name: {
      type: String,
      default: '',
      trim: true
    },
    last_name: {
      type: String,
      default: '',
      trim: true
    },
    email: {
      type: String,
      default: '',
      trim: true
    },
    group_ids: [{
      type: Schema.Types.ObjectId,
      ref: 'ContactGroup'
    }],
    is_blocked: {
      type: Boolean,
      default: false
    },
    // How the contact was added: manual, import, inbound_call, whatsapp, ...
    // Empty for contacts added before this was recorded.
    source: {
      type: String,
      default: null
    },
    // Where this person stands across all calls (services/outcomeService.js).
    lead: {
      status: { type: String, default: null },
      // A status set by a person is kept: later calls only suggest.
      locked: { type: Boolean, default: false },
      owner_member_id: { type: Schema.Types.ObjectId, ref: 'TeamMember', default: null },
      last_outcome_key: { type: String, default: null },
      last_outcome_label: { type: String, default: null },
      last_call_id: { type: Schema.Types.ObjectId, ref: 'Call', default: null },
      last_call_at: { type: Date, default: null },
      last_contacted_at: { type: Date, default: null },
      // Calls in a row that didn't reach the person.
      unreached_streak: { type: Number, default: 0 },
      calls: { type: Number, default: 0 },
      next_follow_up_at: { type: Date, default: null },
      // Details collected on calls (e.g. budget, course), newest kept per field.
      details: { type: Schema.Types.Mixed, default: undefined },
      tags: { type: [String], default: undefined },
      notes: [{ _id: false, text: String, by: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date }],
      history: [{ _id: false, at: Date, from: String, to: String, source: String, call_id: { type: Schema.Types.ObjectId, ref: 'Call' }, outcome_key: String, by: { type: Schema.Types.ObjectId, ref: 'User' }, note: String }],
      // Do not call: no calls or messages until a person lifts it.
      dnc: {
        at: { type: Date, default: undefined },
        reason: { type: String, default: undefined },
        by: { type: Schema.Types.ObjectId, ref: 'User', default: undefined },
        source: { type: String, default: undefined }
      },
      updated_at: { type: Date, default: null }
    }
  },
  {
    collection: 'contacts',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

addVirtualId(ContactSchema);

ContactSchema.pre('save', function () {
  if (this.isModified('phone_number') || !this.phone_e164) this.phone_e164 = normalizePhone(this.phone_number);
});

// Updates that change the number keep phone_e164 in step.
ContactSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function () {
  const update = this.getUpdate() || {};
  const phone = update.$set?.phone_number ?? update.phone_number;
  if (phone !== undefined) this.set('phone_e164', normalizePhone(phone));
});

ContactSchema.index({ user_id: 1, phone_number: 1 }, { unique: true });
ContactSchema.index({ user_id: 1, phone_e164: 1 });
ContactSchema.index({ user_id: 1, 'lead.status': 1, 'lead.updated_at': -1 });
ContactSchema.index({ user_id: 1, 'lead.next_follow_up_at': 1 });

module.exports = mongoose.model('Contact', ContactSchema);
