const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const NumberPurchaseRequestSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    phone_number_id: {
      type: Schema.Types.ObjectId,
      ref: 'PhoneNumber',
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    payment_status: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending'
    },
    kyc_status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    payment_intent_id: {
      type: String,
      default: null
    },
    payment_gateway: {
      type: String,
      default: null
    },
    kyc_documents: {
      type: Schema.Types.Mixed,
      default: {}
    },
    kyc_form_data: {
      type: Schema.Types.Mixed,
      default: {}
    },
    kyc_files: {
      type: Array,
      default: []
    },
    admin_notes: {
      type: String,
      default: null
    }
  },
  {
    collection: 'number_purchase_requests',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(NumberPurchaseRequestSchema);

module.exports = mongoose.model('NumberPurchaseRequest', NumberPurchaseRequestSchema);
