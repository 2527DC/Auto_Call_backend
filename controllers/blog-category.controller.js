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
      if (req.files.image) {
        req.body.image = `/uploads/blog-categories/${req.files.image[0].filename}`;
      }
      if (req.files.meta_image) {
        req.body.meta_image = `/uploads/blog-categories/${req.files.meta_image[0].filename}`;
      }
    }

    const category = new BlogCategory(req.body);
    await category.save();

    const populatedCategory = await BlogCategory.findById(category._id)
      .populate('parent_id');

    res.status(201).json({
      message: 'Category created successfully',
      category: populatedCategory
    });
  } catch (error) {
    console.error('Create category error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Category slug already exists' });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { search, status } = req.query;

    const query = {};
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    if (status !== undefined) {
      query.status = status === 'true';
    }

    const categories = await BlogCategory.find(query)
      .select('name description image status parent_id')
      .sort({ created_at: -1 })
      .lean();

    const catMap = {};
    categories.forEach(cat => {
      cat.children = [];
      catMap[cat._id] = cat;
    });

    const tree = [];
    categories.forEach(cat => {
      const pId = cat.parent_id;
      delete cat.parent_id;
      if (pId && catMap[pId]) {
        catMap[pId].children.push(cat);
      } else {
        tree.push(cat);
      }
    });

    res.status(200).json({ categories: tree });
  } catch (error) {
    console.error('Get all categories error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const category = await BlogCategory.findById(req.params.id)
      .populate('parent_id');

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.status(200).json(category);
  } catch (error) {
    console.error('Get category by id error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.update = async (req, res) => {
  try {
    const existingCategory = await BlogCategory.findById(req.params.id);
    if (!existingCategory) {
      return res.status(404).json({ message: 'Category not found' });
    }

    if (req.files) {
      if (req.files.image) {
        deleteFile(existingCategory.image);
        req.body.image = `/uploads/blog-categories/${req.files.image[0].filename}`;
      }
      if (req.files.meta_image) {
        deleteFile(existingCategory.meta_image);
        req.body.meta_image = `/uploads/blog-categories/${req.files.meta_image[0].filename}`;
      }
    }

    const category = await BlogCategory.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
    .populate('parent_id');

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    res.status(200).json({
      message: 'Category updated successfully',
      category
    });
  } catch (error) {
    console.error('Update category error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Category slug already exists' });
    }
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.delete = async (req, res) => {
  try {
    const hasChildren = await BlogCategory.exists({ parent_id: req.params.id });
    if (hasChildren) {
      return res.status(400).json({ message: 'Cannot delete category with sub-categories. Please delete or reassign them first.' });
    }

    const category = await BlogCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    deleteFile(category.image);
    deleteFile(category.meta_image);

    await BlogCategory.findByIdAndDelete(req.params.id);

    res.status(200).json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
