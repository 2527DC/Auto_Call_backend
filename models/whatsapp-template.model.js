const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const VariableSchema = new Schema(
  {
    key: { type: String, required: true },
    example: { type: String, required: true }
  },
  { _id: false }
);

const HeaderSchema = new Schema(
  {
    format: {
      type: String,
      enum: ["none", "text", "media"],
      default: "none"
    },
    text: { type: String },
    media_type: {
      type: String,
      enum: ["image", "video", "document"]
    },
    media_url: { type: String },
    handle: { type: String },
    original_filename: { type: String },
  },
  { _id: false }
);



const WhatsAppTemplateSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    waba_id: {
      type: Schema.Types.ObjectId,
      ref: 'WhatsappWaba',
      required: true
    },
    template_name: {
      type: String,
      required: true,
      lowercase: true
    },
    language: {
      type: String,
      default: 'en_US'
    },
    category: {
      type: String,
      enum: ['UTILITY'],
      required: true
    },
    status: {
      type: String,
      enum: ['draft', 'pending', 'approved', 'rejected'],
      default: 'draft'
    },
    header: HeaderSchema,
    message_body: {
      type: String,
      required: true
    },
    body_variables: [VariableSchema],
    footer_text: {
      type: String
    },
    meta_template_id: {
      type: String
    },
    rejection_reason: {
      type: String
    },
    parameter_mapping: {
      type: Map,
      of: String,
      default: {}
    },
    deleted_at: {
      type: Date,
      default: null
    }
  },
  {
    collection: 'whatsapp_templates',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  }
);

addVirtualId(WhatsAppTemplateSchema);

module.exports = mongoose.model('WhatsAppTemplate', WhatsAppTemplateSchema);