const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SmsMessageSchema = new Schema(
  {
    session_id: {
      type: Schema.Types.ObjectId,
      ref: 'SmsSession',
      required: true
    },
    role: {
      type: String,
      enum: ['user', 'ai', 'human_agent'],
      required: true
    },
    content: {
      type: String,
      required: true
    },
    twilio_message_sid: {
      type: String,
      default: null
    }
  },
  {
    collection: 'sms_messages',
    timestamps: { 
      createdAt: 'created_at', 
      updatedAt: 'updated_at' 
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(SmsMessageSchema);

SmsMessageSchema.index({ session_id: 1, created_at: 1 });

module.exports = mongoose.model('SmsMessage', SmsMessageSchema);
