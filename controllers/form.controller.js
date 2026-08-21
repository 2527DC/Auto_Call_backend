'use strict';

const { db } = require('../models');
const Form = db.Form;
const FormResponse = db.FormResponse;

exports.getForms = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', status, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    
    const query = { user_id: req.user._id };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (status && status !== 'all') {
      query.status = status;
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const forms = await Form.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));
      
    const total = await Form.countDocuments(query);
    const totalPages = Math.ceil(total / parseInt(limit));

    return res.status(200).json({ 
      success: true, 
      data: forms,
      pagination: {
        total,
        page: parseInt(page),
        pages: totalPages
      }
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getForm = async (req, res) => {
  try {
    const form = await Form.findOne({ _id: req.params.id, user_id: req.user._id });
    if (!form) {
      return res.status(404).json({ success: false, message: 'Form not found' });
    }

    return res.status(200).json({ success: true, data: form });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createForm = async (req, res) => {
  try {
    const formData = { ...req.body, user_id: req.user._id };
    const form = await Form.create(formData);

    return res.status(201).json({ success: true, data: form });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateForm = async (req, res) => {
  try {
    const form = await Form.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user._id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!form) {
      return res.status(404).json({ success: false, message: 'Form not found' });
    }
    return res.status(200).json({ success: true, data: form });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteForm = async (req, res) => {
  try {
    const { formIds } = req.body;

    if (!Array.isArray(formIds) || formIds.length === 0) {
      return res.status(400).json({ success: false, message: 'formIds must be a non-empty array' });
    }

    const forms = await Form.find({ _id: { $in: formIds }, user_id: req.user._id }).select('_id');
    if (!forms.length) {
      return res.status(404).json({ success: false, message: 'No forms found' });
    }

    const formObjectIds = forms.map((form) => form._id);

    await Form.deleteMany({ _id: { $in: formObjectIds } });
    await FormResponse.deleteMany({ form_id: { $in: formObjectIds } });

    return res.status(200).json({
      success: true,
      message: `${formObjectIds.length} Forms deleted successfully`,
      deleted_count: formObjectIds.length
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getFormResponses = async (req, res) => {
  try {
    const { sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    const responses = await FormResponse.find({ form_id: req.params.id, user_id: req.user._id })
      .populate('call_id')
      .sort(sortOptions);

    return res.status(200).json({ success: true, data: responses });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};