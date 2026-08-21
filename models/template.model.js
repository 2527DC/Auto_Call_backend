const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const TemplateSchema = new Schema(
  {
    name: {
      type: String,
      required: true
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: true
    },
    content: {
      type: String,
      required: true
    },
    system_prompt: {
      type: String,
      required: true
    },
    welcome_message: {
      type: String,
      default:''
    },
    goodbye_message: {
      type: String,
      default:''
    },
    communication_style: {
      type: String,
      enum: ['formal', 'casual', 'professional'],
    },
    behavior_style: {
      type: String,
    },
    is_public: {
      type: Boolean,
      default: false
    },
    is_system: {
      type: Boolean,
      default: false
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    collection: 'templates',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
)

addVirtualId(TemplateSchema);

TemplateSchema.index({ name: 1 }, {
  unique: true,
  collation: { locale: 'en', strength: 2 }
});

module.exports = mongoose.model('Template', TemplateSchema);