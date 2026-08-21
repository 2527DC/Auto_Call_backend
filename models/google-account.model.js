const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const GoogleAccountSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    access_token: {
      type: String,
      required: true
    },
    refresh_token: {
      type: String,
      required: true
    },
    expires_at: {
      type: Date,
      required: true
    },
    scopes: {
      type: [String],
      default: []
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'expired'],
      default: 'active'
    },
    deleted_at: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'google_accounts',
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(GoogleAccountSchema);

GoogleAccountSchema.index({ user_id: 1, email: 1 }, { unique: true });
GoogleAccountSchema.index({ deleted_at: 1 });

module.exports = mongoose.model('GoogleAccount', GoogleAccountSchema);
