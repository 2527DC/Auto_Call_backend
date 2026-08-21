const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const VoiceSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    voice_id: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    provider: {
      type: String,
      default: 'elevenlabs'
    },
    category: {
      type: String,
      default: 'Predefined'
    },
    preview_url: {
      type: String,
      default: null
    },
    labels: {
      gender: { type: String, default: null },
      age: { type: String, default: null },
      accent: { type: String, default: null },
      description: { type: String, default: null }
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    }
  },
  {
    collection: 'voices',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(VoiceSchema);

VoiceSchema.index({ voice_id: 1 }, { unique: true });
VoiceSchema.index({ status: 1 });

module.exports = mongoose.model('Voice', VoiceSchema);
