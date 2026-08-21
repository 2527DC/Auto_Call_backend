'use strict';

const { db } = require('../models');
const KnowledgeBase = db.KnowledgeBase;
const User = db.User;
const Setting = db.Setting;
const storageService = require('../services/storageService');
const urlFetcherService = require('../services/urlFetcherService');
const fs = require('fs');
const path = require('path');
const { getUserLimits, checkFeatureLimit } = require('../utils/limitHelper');

const checkStorageLimit = async (userId, newFileSize) => {
  const user = await User.findById(userId).select('storage_used').lean();
  const limits = await getUserLimits(userId);

  const limitMB = limits.storage_limit;
  if (limitMB === -1 || limitMB === null || limitMB === undefined) return;

  const limitBytes = limitMB * 1024 * 1024;
  const usedBytes = user?.storage_used || 0;

  if (usedBytes + newFileSize > limitBytes) {
    throw new Error(`Storage limit reached. Remaining: ${((limitBytes - usedBytes) / (1024 * 1024)).toFixed(2)} MB`);
  }
};

const updateUserStorage = async (userId, sizeChange) => {
  await User.findByIdAndUpdate(userId, { $inc: { storage_used: sizeChange } });
};

exports.getKnowledgeBase = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, type, page = 1, limit = 10 } = req.query;

    const query = { user_id: userId };
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    if (type && type !== 'All') {
      query.type = type.toLowerCase();
    }

    const total = await KnowledgeBase.countDocuments(query);
    const items = await KnowledgeBase.find(query)
      .sort({ created_at: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const user = await User.findById(userId).select('storage_used').lean();
    const limits = await getUserLimits(userId);

    const storageUsedBytes = user?.storage_used || 0;
    const storageLimitMB = limits.storage_limit === -1 ? 'Unlimited' : limits.storage_limit;

    res.json({
      data: items,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      storageUsed: (storageUsedBytes / (1024 * 1024)).toFixed(2),
      storageLimit: storageLimitMB === 'Unlimited' ? 'Unlimited' : storageLimitMB.toFixed(2),
    });
  } catch (error) {
    console.error('Get KB Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.createKnowledgeBase = async (req, res) => {
  try {
    const { type, name, url, content } = req.body;
    const userId = req.user.id;
    let kbData = {
      user_id: userId,
      name: name,
      type: type
    };
    let fileSize = 0;
    let buffer;
    let fileName;

    const currentKbCount = await KnowledgeBase.countDocuments({ user_id: userId });
    await checkFeatureLimit(userId, 'Knowledge Base', 'knowledgebase_limit', currentKbCount);

    if (type === 'url') {
      if (!url) return res.status(400).json({ message: 'URL is required' });
      const fetched = await urlFetcherService.fetchContent(url);
      fileName = `${Date.now()}-url-content.txt`;
      buffer = Buffer.from(fetched.content, 'utf-8');
      fileSize = buffer.length;
      kbData.name = name || fetched.title || url;
      kbData.url = url;
      kbData.content = fetched.content.substring(0, 5000);
    } else if (type === 'file') {
      if (!req.file) return res.status(400).json({ message: 'File is required' });
      fileSize = req.file.size;
      kbData.name = name || req.file.originalname;
    } else if (type === 'text') {
      if (!content) return res.status(400).json({ message: 'Content is required' });
      fileName = `${Date.now()}-text-doc.txt`;
      buffer = Buffer.from(content, 'utf-8');
      fileSize = buffer.length;
      kbData.name = name || 'Untitled Text';
      kbData.content = content.substring(0, 5000);
    } else {
      return res.status(400).json({ message: 'Invalid type' });
    }

    await checkStorageLimit(userId, fileSize);

    const uploadSource = type === 'file' ? req.file : { buffer, originalname: fileName, mimetype: 'text/plain' };
    const filePath = await storageService.uploadFile(uploadSource, userId);

    kbData.file_path = filePath;
    kbData.file_size = fileSize;

    const kb = await KnowledgeBase.create(kbData);
    await updateUserStorage(userId, fileSize);

    res.status(201).json({ message: 'Knowledge base item created successfully', data: kb });
  } catch (error) {
    console.error('Create KB Error:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(400).json({ message: error.message || 'Failed to create knowledge base item' });
  }
};

exports.bulkDeleteKnowledgeBase = async (req, res) => {
  try {
    const { ids } = req.body;
    const userId = req.user.id;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'IDs array is required' });
    }

    const items = await KnowledgeBase.find({ _id: { $in: ids }, user_id: userId });
    const settings = await Setting.findOne().select('restore_storage_on_delete').lean();
    const shouldRestore = settings?.restore_storage_on_delete !== false;

    let totalSize = 0;

    for (const item of items) {
      if (item.file_path) {
        await storageService.deleteFile(item.file_path);
      }
      totalSize += item.file_size || 0;
    }

    await KnowledgeBase.deleteMany({ _id: { $in: ids }, user_id: userId });

    if (shouldRestore) {
      await updateUserStorage(userId, -totalSize);
    }

    res.json({ message: `${items.length} items deleted successfully` });
  } catch (error) {
    console.error('Bulk Delete KB Error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.editKnowledgeBase = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { name, content } = req.body;

    const kb = await KnowledgeBase.findOne({ _id: id, user_id: userId });
    if (!kb) {
      return res.status(404).json({ message: 'Knowledge base item not found' });
    }

    let updateData = {};
    if (name) updateData.name = name;

    let fileSizeDiff = 0;

    if (kb.type === 'text' && content) {
      const newContent = content.substring(0, 5000);
      const newContentBuffer = Buffer.from(newContent, 'utf-8');

      fileSizeDiff = newContentBuffer.length - (kb.file_size || 0);

      if (fileSizeDiff > 0) {
        await checkStorageLimit(userId, fileSizeDiff);
      }

      updateData.content = newContent;
      updateData.file_size = newContentBuffer.length;
    }

    if (kb.type === 'url') {
      const updatedUrl = req.body.url || kb.url;

      if (!updatedUrl) {
        return res.status(400).json({ message: 'URL is required' });
      }

      const fetched = await urlFetcherService.fetchContent(updatedUrl);

      const newContent = fetched.content.substring(0, 5000);
      const newBuffer = Buffer.from(newContent, 'utf-8');

      fileSizeDiff = newBuffer.length - (kb.file_size || 0);

      if (fileSizeDiff > 0) {
        await checkStorageLimit(userId, fileSizeDiff);
      }

      const fileName = `${Date.now()}-url-content.txt`;

      const uploadSource = {
        buffer: newBuffer,
        originalname: fileName,
        mimetype: 'text/plain'
      };

      const filePath = await storageService.uploadFile(uploadSource, userId);

      updateData.url = updatedUrl;
      updateData.content = newContent;
      updateData.file_path = filePath;
      updateData.file_size = newBuffer.length;
      updateData.name = name || fetched.title || updatedUrl;

      if (kb.file_path) {
        await storageService.deleteFile(kb.file_path);
      }
    }

    if (kb.type === 'file' && req.file) {
      const newFileSize = req.file.size;
      fileSizeDiff = newFileSize - (kb.file_size || 0);

      if (fileSizeDiff > 0) {
        await checkStorageLimit(userId, fileSizeDiff);
      }

      const filePath = await storageService.uploadFile(req.file, userId);
      updateData.file_path = filePath;
      updateData.file_size = newFileSize;
      updateData.name = name || req.file.originalname;

      if (kb.file_path) {
        await storageService.deleteFile(kb.file_path);
      }
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    Object.assign(kb, updateData);
    await kb.save();

    if (fileSizeDiff !== 0) {
      await updateUserStorage(userId, fileSizeDiff);
    }

    res.json({ message: 'Knowledge base item updated successfully', data: kb });
  } catch (error) {
    console.error('Edit KB Error:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(400).json({ message: error.message || 'Failed to edit knowledge base item' });
  }
};
