const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SMSTemplateSchema = new Schema(
  {
    name : {
        type: String,
        required: true,
        trim: true
    },
    description : {
        type: String,
    },
    content : {
        type: String,
        required: true,
        trim: true
    },
    user_id : {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status : {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    is_system : {
      type: Boolean,
      default: false
    }
  },
  {
    collection: 'sms_templates',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
)

addVirtualId(SMSTemplateSchema)

SMSTemplateSchema.index({ user_id: 1, name: 1 })    

module.exports = mongoose.model('SMSTemplate', SMSTemplateSchema)