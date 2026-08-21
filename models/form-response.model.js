const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const FormResponseSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    form_id: {
      type: Schema.Types.ObjectId,
      ref: 'Form',
      required: true
    },
    call_id: {
      type: Schema.Types.ObjectId,
      ref: 'Call',
      default: null
    },
    flow_id: {
      type: Schema.Types.ObjectId,
      ref: 'Flow',
      default: null
    },
    responses: {
      type: Schema.Types.Mixed,
      default: {}
    },
    status: {
      type: String,
      enum: ['partial', 'completed'],
      default: 'partial'
    }
  },
  {
    collection: 'form_responses',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(FormResponseSchema);

FormResponseSchema.index({ user_id: 1 });
FormResponseSchema.index({ form_id: 1 });
FormResponseSchema.index({ call_id: 1 });

module.exports = mongoose.model('FormResponse', FormResponseSchema);
