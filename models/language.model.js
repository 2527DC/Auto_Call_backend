'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const LanguageSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    locale: {
      type: String,
      required: true,
      trim: true
    },
    flag: {
      type: String,
      default: null
    },
    front_translation_file: {
      type: String,
      default: null
    },

    is_rtl: {
      type: Boolean,
      default: false
    },
    is_active: {
      type: Boolean,
      default: true
    },
    sort_order: {
      type: Number,
      default: 0
    },
    is_default: {
      type: Boolean,
      default: false
    }
  },
  {
    collection: 'languages',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

LanguageSchema.index(
  { locale: 1 },
  { unique: true }
);

addVirtualId(LanguageSchema);

module.exports = mongoose.model('Language', LanguageSchema);
