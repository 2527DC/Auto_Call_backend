const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const violenceWordSchema = new Schema({
  word: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  severity_level: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  is_active: {
    type: Boolean,
    default: true
  },
  user_id : {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  collection: 'violence_words',
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

addVirtualId(violenceWordSchema);

module.exports = mongoose.model('ViolenceWord', violenceWordSchema);
