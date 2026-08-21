const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const FormFieldSchema = new Schema({
  label: {
    type: String,
    required: true
  },
  key: {
    type: String,
    required: true
  },
  question: {
    type: String,
    required: true
  },
  required: {
    type: Boolean,
    default: true
  },
  type: {
    type: String,
    enum: ['text', 'number', 'date', 'time', 'email'],
    default: 'text'
  }
}, { _id: true });

const FormSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      default: ''
    },
    fields: [FormFieldSchema],
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    }
  },
  {
    collection: 'forms',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(FormSchema);

FormSchema.index({ user_id: 1 });
FormSchema.index({ name: 1 });

module.exports = mongoose.model('Form', FormSchema);
