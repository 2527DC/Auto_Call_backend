const Blog = require('../models/blog.model');
const BlogCategory = require('../models/blog-category.model');
const fs = require('fs');
const path = require('path');

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

exports.create = async (req, res) => {
  try {
    if (req.files) {
      if (req.files.thumbnail) {
        req.body.thumbnail = `uploads/blogs/${req.files.thumbnail[0].filename}`;
      }
      if (req.files.meta_image) {
        req.body.meta_image = `uploads/blogs/${req.files.meta_image[0].filename}`;
      }
    }
    
    const blog = new Blog(req.body);
    await blog.save();
    
    const populatedBlog = await Blog.findById(blog._id)
      .populate('categories', 'name')
      .populate('tags', 'title');

    res.status(201).json({
      message: 'Blog created successfully',
      blog: populatedBlog
    });
  } catch (error) {
    console.error('Create blog error:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: 'Validation error', errors: messages });
    }
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Blog slug already exists' });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, category } = req.query;
    
    const query = {};
    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }
    if (status !== undefined) {
      query.status = status === 'true';
    }
    if (category) {
      if (category.match(/^[0-9a-fA-F]{24}$/)) {
        query.categories = category;
      } else {
        const cat = await BlogCategory.findOne({ $or: [{ slug: category }, { name: category }] });
        if (cat) {
          query.categories = cat._id;
        } else {
          query.categories = null;
        }
      }
    }

    const blogs = await Blog.find(query)
      .select('title description content thumbnail meta_image categories tags slug meta_title meta_description status created_at')
      .populate('categories', 'name')
      .populate('tags', 'title')
      .sort({ created_at: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Blog.countDocuments(query);

    res.status(200).json({
      blogs,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
      total
    });
  } catch (error) {
    console.error('Get all blogs error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id)
      .select('title description content thumbnail meta_image categories tags slug meta_title meta_description status created_at')
      .populate('categories', 'name')
      .populate('tags', 'title');
      
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }
    res.status(200).json(blog);
  } catch (error) {
    console.error('Get blog by id error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getBySlug = async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug })
      .select('title description content thumbnail categories tags slug meta_title meta_description created_at status')
      .populate('categories', 'name')
      .populate('tags', 'title');
      
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }
    res.status(200).json(blog);
  } catch (error) {
    console.error('Get blog by slug error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const existingBlog = await Blog.findById(req.params.id);
    if (!existingBlog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    if (req.files) {
      if (req.files.thumbnail) {
        deleteFile(existingBlog.thumbnail);
        req.body.thumbnail = `uploads/blogs/${req.files.thumbnail[0].filename}`;
      }
      if (req.files.meta_image) {
        deleteFile(existingBlog.meta_image);
        req.body.meta_image = `uploads/blogs/${req.files.meta_image[0].filename}`;
      }
    }

    const blog = await Blog.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
    .populate('categories', 'name')
    .populate('tags', 'title');

    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    res.status(200).json({
      message: 'Blog updated successfully',
      blog
    });
  } catch (error) {
    console.error('Update blog error:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: 'Validation error', errors: messages });
    }
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Blog slug already exists' });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.delete = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    deleteFile(blog.thumbnail);
    deleteFile(blog.meta_image);

    await Blog.findByIdAndDelete(req.params.id);

    res.status(200).json({ message: 'Blog deleted successfully' });
  } catch (error) {
    console.error('Delete blog error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
