const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const KnowledgeBaseSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    name: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['file', 'url', 'text'],
      required: true
    },
    file_path: {
      type: String,
      default: null
    },
    file_size: {
      type: Number,
      default: 0
    },
    url: {
      type: String,
      default: null
    },
    content: {
      type: String,
      default: null
    }
  },
  {
    collection: 'knowledge_base',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(KnowledgeBaseSchema);

module.exports = mongoose.model('KnowledgeBase', KnowledgeBaseSchema);
