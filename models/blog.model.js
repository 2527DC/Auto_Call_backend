const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const BlogSchema = new Schema(
  {
    title: {
      type: String,
      required: true
    },
    slug: {
      type: String,
      required: true,
      unique: true
    },
    description: {
      type: String,
      required: [true, 'Description is required']
    },
    content: {
      type: String,
      required: [true, 'Content is required']
    },
    thumbnail: {
      type: String,
      required: [true, 'Thumbnail is required']
    },
    meta_title: {
      type: String,
      default: ''
    },
    meta_description: {
      type: String,
      default: ''
    },
    meta_image: {
      type: String,
      default: null
    },
    categories: {
      type: [
        { type: Schema.Types.ObjectId, ref: 'BlogCategory' }
      ],
      validate: [v => Array.isArray(v) && v.length > 0, 'At least one category is required']
    },
    tags: {
      type: [
        { type: Schema.Types.ObjectId, ref: 'BlogTag' }
      ],
      validate: [v => Array.isArray(v) && v.length > 0, 'At least one tag is required']
    },
    status: {
      type: Boolean,
      default: true
    }
  },
  {
    collection: 'blogs',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(BlogSchema);

BlogSchema.index({ slug: 1 });
BlogSchema.index({ status: 1 });

module.exports = mongoose.model('Blog', BlogSchema);