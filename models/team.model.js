const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const TeamSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    name: {
      type: String,
      required: true,
      trim: true
    },

    description: {
      type: String,
      trim: true
    },

    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },

    sort_order: {
      type: Number,
      default: 0
    },

    deleted_at: {
      type: Date,
      default: null,
      index: true
    },
    isAdmin: {
      type: Boolean,
      default: false
    }
  },
  {
    collection: 'teams',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

addVirtualId(TeamSchema);

module.exports = mongoose.model('Team', TeamSchema);
