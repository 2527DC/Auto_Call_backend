const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const WhatsappPhoneNumberSchema = new Schema(
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
    whatsapp_phone_number_id: {
      type: String,
      required: true,
      unique: true
    },
    display_phone_number: {
      type: String,
      required: true
    },
    verified_name: {
      type: String
    },
    quality_rating: {
      type: String
    },
    status: {
      type: String
    },
    code_verification_status: {
      type: String
    },
    deleted_at: {
      type: Date,
      default: null
    }
  },
  {
    collection: 'whatsapp_phone_numbers',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    }
  }
);

addVirtualId(WhatsappPhoneNumberSchema);

module.exports = mongoose.model('WhatsappPhoneNumber', WhatsappPhoneNumberSchema);
