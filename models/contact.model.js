const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const ContactSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    phone_number: {
      type: String,
      required: true,
      trim: true
    },
    first_name: {
      type: String,
      default: '',
      trim: true
    },
    last_name: {
      type: String,
      default: '',
      trim: true
    },
    email: {
      type: String,
      default: '',
      trim: true
    },
    group_ids: [{
      type: Schema.Types.ObjectId,
      ref: 'ContactGroup'
    }],
    is_blocked: {
      type: Boolean,
      default: false
    }
  },
  {
    collection: 'contacts',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

addVirtualId(ContactSchema);

ContactSchema.index({ user_id: 1, phone_number: 1 }, { unique: true });

module.exports = mongoose.model('Contact', ContactSchema);
