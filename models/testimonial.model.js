const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const testimonialSchema = new Schema({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  user_name: {
    type: String,
    required: true
  },
  user_post: {
    type: String,
    required: true
  },
  rating: {
    type: Number
  },
  user_image: {
    type: String,
    default: null
  },
  status: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'testimonials'
});

addVirtualId(testimonialSchema);

module.exports = mongoose.model('Testimonial', testimonialSchema);
