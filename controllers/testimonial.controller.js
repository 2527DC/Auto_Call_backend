'use strict';

const { db } = require('../models');
const Testimonial = db.Testimonial;
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const DEFAULT_SORT_FIELD = 'created_at';
const DEFAULT_SORT_ORDER = -1;
const MAX_LIMIT = 100;

const ALLOWED_SORT_FIELDS = [
  'id',
  'title',
  'description',
  'status',
  'user_name',
  'user_post',
  'created_at',
  'updated_at'
];

const parsePaginationParams = (query) => {
  const page = Math.max(1, parseInt(query.page) || DEFAULT_PAGE);
  const limit = Math.max(1, Math.min(MAX_LIMIT, parseInt(query.limit) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

const parseSortParams = (query) => {
  const sortField = ALLOWED_SORT_FIELDS.includes(query.sort_by)
    ? query.sort_by
    : DEFAULT_SORT_FIELD;

  const sortOrder = query.sort_order?.toUpperCase() === 'ASC' ? 1 : -1;

  return { sortField, sortOrder };
};

const buildSearchQuery = (searchTerm) => {
  if (!searchTerm || searchTerm.trim() === '') {
    return {};
  }

  const sanitizedSearch = searchTerm.trim();

  return {
    $or: [
      { title: { $regex: sanitizedSearch, $options: 'i' } },
      { description: { $regex: sanitizedSearch, $options: 'i' } },
      { user_name: { $regex: sanitizedSearch, $options: 'i' } },
      { user_post: { $regex: sanitizedSearch, $options: 'i' } }
    ]
  };
};

const deleteFile = (filePath) => {
  if (!filePath) return;
  try {
    const absolutePath = path.join(__dirname, '..', filePath);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch (error) {
    console.error('Error deleting file:', error);
  }
};

exports.getAllTestimonials = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req.query);
    const { sortField, sortOrder } = parseSortParams(req.query);
    const searchTerm = req.query.search || '';

    const searchQuery = buildSearchQuery(searchTerm);

    const [testimonials, totalCount] = await Promise.all([
      Testimonial.find(searchQuery)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit),
      Testimonial.countDocuments(searchQuery)
    ]);

    return res.status(200).json({
      message: 'Testimonials fetched successfully.',
      testimonials,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit
    });
  } catch (error) {
    console.error('Error in getAllTestimonials:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getActiveTestimonials = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaginationParams(req.query);
    const query = { status: true };

    const [testimonials, totalCount] = await Promise.all([
      Testimonial.find(query)
        .select('-status')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit),
      Testimonial.countDocuments(query)
    ]);

    return res.status(200).json({
      message: 'Active testimonials fetched successfully.',
      testimonials,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      page,
      limit
    });
  } catch (error) {
    console.error('Error in getActiveTestimonials:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getTestimonialById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Valid testimonial ID is required' });
    }

    const testimonial = await Testimonial.findById(id);

    if (!testimonial) {
      return res.status(404).json({ message: 'Testimonial not found' });
    }

    return res.status(200).json({
      message: 'Testimonial fetched successfully.',
      testimonial
    });
  } catch (error) {
    console.error('Error in getTestimonialById:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createTestimonial = async (req, res) => {
  try {
    const {
      title,
      description,
      status,
      rating,
      user_name,
      user_post
    } = req.body;

    if (!title || !description || !user_name || !user_post) {
      return res.status(400).json({ message: 'All fields (title, description, user_name, user_post) are required.' });
    }

    const trimmedTitle = title.trim();
    const existingTestimonial = await Testimonial.findOne({
      title: { $regex: `^${trimmedTitle}$`, $options: 'i' }
    });

    if (existingTestimonial) {
      return res.status(409).json({ message: 'Testimonial with this title already exists' });
    }

    const newTestimonial = await Testimonial.create({
      title: trimmedTitle,
      description: description.trim(),
      status: status !== undefined ? status : true,
      user_name: user_name.trim(),
      user_post: user_post.trim(),
      rating: rating,
      user_image: req.file ? `/uploads/testimonials/${req.file.filename}` : null
    });

    return res.status(201).json({
      message: 'Testimonial created successfully',
      testimonial: newTestimonial
    });
  } catch (error) {
    console.error('Error in createTestimonial:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateTestimonial = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      status,
      user_name,
      rating,
      user_post
    } = req.body;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Valid testimonial ID is required' });
    }

    const testimonial = await Testimonial.findById(id);
    if (!testimonial) {
      return res.status(404).json({ message: 'Testimonial not found' });
    }

    if (!title || !description || !user_name || !user_post) {
      return res.status(400).json({ message: 'All fields (title, description, user_name, user_post) are required.' });
    }

    const trimmedTitle = title.trim();
    const duplicateTestimonial = await Testimonial.findOne({
      title: { $regex: `^${trimmedTitle}$`, $options: 'i' },
      _id: { $ne: id }
    });

    if (duplicateTestimonial) {
      return res.status(409).json({ message: 'Testimonial with this title already exists' });
    }

    const updateData = {
      title: trimmedTitle,
      description: description.trim(),
      user_name: user_name.trim(),
      user_post: user_post.trim(),
      rating: rating
    };

    if (status !== undefined) {
      updateData.status = status;
    }

    if (req.file) {
      const oldImage = testimonial.user_image;
      updateData.user_image = `/uploads/testimonials/${req.file.filename}`;
      if (oldImage) deleteFile(oldImage);
    }

    const updatedTestimonial = await Testimonial.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    );

    return res.status(200).json({
      message: 'Testimonial updated successfully',
      testimonial: updatedTestimonial
    });
  } catch (error) {
    console.error('Error in updateTestimonial:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateTestimonialStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Valid testimonial ID is required' });
    }

    if (status === undefined) {
      return res.status(400).json({ message: 'Status is required' });
    }

    const testimonial = await Testimonial.findById(id);
    if (!testimonial) {
      return res.status(404).json({ message: 'Testimonial not found' });
    }

    testimonial.status = status;
    await testimonial.save();

    return res.status(200).json({
      message: `Testimonial ${status ? 'activated' : 'deactivated'} successfully`,
      testimonial: {
        id: testimonial._id,
        status: testimonial.status
      }
    });
  } catch (error) {
    console.error('Error in updateTestimonialStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteTestimonial = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Testimonial IDs array is required' });
    }

    const testimonials = await Testimonial.find({ _id: { $in: ids } });

    if (testimonials.length === 0) {
      return res.status(404).json({ message: 'No testimonials found' });
    }

    for (const testimonial of testimonials) {
      if (testimonial.user_image) {
        deleteFile(testimonial.user_image);
      }
    }

    const result = await Testimonial.deleteMany({ _id: { $in: ids } });

    return res.status(200).json({
      message: `${result.deletedCount} testimonial(s) deleted successfully`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error in deleteTestimonial:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
