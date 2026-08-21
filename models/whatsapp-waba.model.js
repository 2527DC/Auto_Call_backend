const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const WhatsappWabaSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    whatsapp_business_account_id: {
      type: String,
      required: true,
      unique: true
    },
    business_id: {
      type: String
    },
    name: {
      type: String
    },
    status: {
      type: String,
      enum: ['active', 'pending', 'disabled'],
      default: 'pending'
    },
    access_token: {
      type: String,
      required: true
    },
    currency: {
      type: String,
      default: 'USD'
    },
    timezone_id: {
      type: String
    },
    message_template_namespace: {
      type: String
    },
    deleted_at: {
      type: Date,
      default: null
    }
  },
  {
    collection: 'whatsapp_wabas',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    }
  }
);

addVirtualId(WhatsappWabaSchema);

module.exports = mongoose.model('WhatsappWaba', WhatsappWabaSchema);
