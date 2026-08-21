const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const WhatsAppLogSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    waba_id: {
      type: Schema.Types.ObjectId,
      ref: 'WhatsappWaba'
    },
    template_id: {
      type: Schema.Types.ObjectId,
      ref: 'WhatsAppTemplate'
    },
    to_number: {
      type: String,
      required: true
    },
    message_sid: {
      type: String,
      unique: true,
      sparse: true
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read', 'failed'],
      default: 'sent'
    },
    direction: {
      type: String,
      enum: ['outbound', 'inbound'],
      default: 'outbound'
    },
    call_id: {
      type: Schema.Types.ObjectId,
      ref: 'Call'
    },
    campaign_id: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign'
    },
    error_message: {
      type: String
    },
    sent_at: {
      type: Date,
      default: Date.now
    }
  },
  {
    collection: 'whatsapp_logs',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  }
);

addVirtualId(WhatsAppLogSchema);

module.exports = mongoose.model('WhatsAppLog', WhatsAppLogSchema);
