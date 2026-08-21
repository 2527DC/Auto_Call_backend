const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const CategorySchema = new Schema(
  {
    name: {
      type: String,
      required: true
    },
    description: {
      type: String,
      default: ""
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    is_system: {
      type: Boolean,
      default: false
    }
  },
  {
    collection: 'categories',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(CategorySchema);

CategorySchema.index({ name: 1 }, {
  unique: true,
  collation: { locale: 'en', strength: 2 }
});

module.exports = mongoose.model('Category', CategorySchema);