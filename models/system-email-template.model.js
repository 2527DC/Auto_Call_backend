const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SystemEmailTemplateSchema = new Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true
    },
    subject: {
      type: String,
      required: true
    },
    content: {
      type: String,
      required: true
    },
    status: {
      type: Boolean,
      default: true
    }
  },
  {
    collection: 'system_email_templates',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(SystemEmailTemplateSchema);

SystemEmailTemplateSchema.index({ slug: 1 });

module.exports = mongoose.model('SystemEmailTemplate', SystemEmailTemplateSchema);
