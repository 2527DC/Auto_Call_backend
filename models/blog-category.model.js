const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const BlogCategorySchema = new Schema(
  {
    name: {
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
      default: ''
    },
    parent_id: {
      type: Schema.Types.ObjectId,
      ref: 'BlogCategory',
      default: null
    },
    image: {
      type: String,
      default: null
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
    status: {
      type: Boolean,
      default: true
    }
  },
  {
    collection: 'blog_categories',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(BlogCategorySchema);

BlogCategorySchema.virtual('children', {
  ref: 'BlogCategory',
  localField: '_id',
  foreignField: 'parent_id'
});

BlogCategorySchema.index({ slug: 1 });
BlogCategorySchema.index({ parent_id: 1 });
BlogCategorySchema.index({ status: 1 });

module.exports = mongoose.model('BlogCategory', BlogCategorySchema);