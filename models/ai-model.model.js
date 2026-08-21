const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const AIModelSchema = new Schema(
  {
    name: {
      type: String,
      unique: true,
      trim: true,
      required: true
    },
    display_name: {
      type: String,
      required: true,
      trim: true
    },
    provider: {
      type: String,
      required: true,
      enum: ['openai', 'anthropic', 'google', 'gemini', 'cohere', 'mistral', 'groq', 'deepseek', 'xai', 'custom'],
      lowercase: true
    },
    model_id: {
      type: String,
      required: true,
      trim: true
    },
    api_endpoint: {
      type: String,
      default: null,
      trim: true
    },
    api_version: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },
    is_default: {
      type: Boolean,
      default: false
    },
    description: {
      type: String,
      default: ''
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    collection: 'aimodels',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(AIModelSchema);

AIModelSchema.index({ provider: 1, status: 1 });
AIModelSchema.index({ name: 1 });
AIModelSchema.index({ status: 1 });

module.exports = mongoose.model('AIModel', AIModelSchema);
