const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const ContactGroupSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    group_name: {
      type: String,
      required: true,
      trim: true
    },
    group_description: {
      type: String,
      default: '',
      trim: true
    },
    group_contacts: [{
      type: Schema.Types.ObjectId,
      ref: 'Contact'
    }]
  },
  {
    collection: 'contact_groups',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

addVirtualId(ContactGroupSchema);

ContactGroupSchema.index({ user_id: 1, group_name: 1 }, { unique: true });

module.exports = mongoose.model('ContactGroup', ContactGroupSchema);