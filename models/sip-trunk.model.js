const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SipTrunkSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    engine: {
      type: String,
      enum: ['elevenlabs_sip', 'deepgram_sip', 'custom'],
      default: 'elevenlabs_sip'
    },
    provider: {
      type: String,
      default: 'twilio'
    },
    sip_host: {
      type: String,
      required: true,
      trim: true
    },
    port: {
      type: Number,
      default: 5061
    },
    transport: {
      type: String,
      enum: ['auto', 'udp', 'tcp', 'tls'],
      default: 'tls'
    },
    username: {
      type: String,
      default: null,
      trim: true
    },
    password: {
      type: String,
      default: null
    },
    auth_realm: {
      type: String,
      default: null,
      trim: true
    },
    default_caller_id: {
      type: String,
      default: null,
      trim: true
    },
    region: {
      type: String,
      default: null,
      trim: true
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    }
  },
  {
    collection: 'sip_trunks',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

addVirtualId(SipTrunkSchema);

SipTrunkSchema.index({ user_id: 1 });

module.exports = mongoose.model('SipTrunk', SipTrunkSchema);
