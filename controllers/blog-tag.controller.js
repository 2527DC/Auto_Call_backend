const BlogTag = require('../models/blog-tag.model');

exports.create = async (req, res) => {
  try {
    const tag = new BlogTag(req.body);
    await tag.save();
    
    res.status(201).json({
      message: 'Tag created successfully',
      tag
    });
  } catch (error) {
    console.error('Create tag error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    
    const query = {};
    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }

    const tags = await BlogTag.find(query)
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await BlogTag.countDocuments(query);

    res.status(200).json({
      tags,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
      total
    });
  } catch (error) {
    console.error('Get all tags error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const tag = await BlogTag.findById(req.params.id);
      
    if (!tag) {
      return res.status(404).json({ message: 'Tag not found' });
    }
    res.status(200).json(tag);
  } catch (error) {
    console.error('Get tag by id error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const tag = await BlogTag.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!tag) {
      return res.status(404).json({ message: 'Tag not found' });
    }

    res.status(200).json({
      message: 'Tag updated successfully',
      tag
    });
  } catch (error) {
    console.error('Update tag error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.delete = async (req, res) => {
  try {
    const tag = await BlogTag.findByIdAndDelete(req.params.id);
    if (!tag) {
      return res.status(404).json({ message: 'Tag not found' });
    }

    res.status(200).json({ message: 'Tag deleted successfully' });
  } catch (error) {
    console.error('Delete tag error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
