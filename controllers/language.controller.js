'use strict';

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { db } = require('../models');
const Language = db.Language;
const Setting = db.Setting;

const SORT_ORDER = { ASC: 1, DESC: -1 };
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const DEFAULT_SORT_FIELD = 'sort_order';
const ALLOWED_SORT_FIELDS = ['name', 'locale', 'is_rtl', 'is_active', 'sort_order', 'created_at', 'updated_at'];

const parsePaginationParams = (query) => {
  const page = Math.max(1, parseInt(query.page) || DEFAULT_PAGE);
  const limit = Math.max(1, Math.min(MAX_LIMIT, parseInt(query.limit) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const parseSortParams = (query) => {
  const sortField = ALLOWED_SORT_FIELDS.includes(query.sort_by) ? query.sort_by : DEFAULT_SORT_FIELD;
  const sortOrder = query.sort_order?.toUpperCase() === 'DESC' ? SORT_ORDER.DESC : SORT_ORDER.ASC;
  return { sortField, sortOrder };
};

const buildSearchQuery = (searchTerm) => {
  if (!searchTerm || searchTerm.trim() === '') return {};
  const s = searchTerm.trim();
  return {
    $or: [
      { name: { $regex: s, $options: 'i' } },
      { locale: { $regex: s, $options: 'i' } },
    ],
  };
};

const validateLanguageData = (data) => {
  const errors = [];
  if (!data.name || !String(data.name).trim()) errors.push('Language name is required');
  if (!data.locale || !String(data.locale).trim()) errors.push('Language locale is required');
  return { isValid: errors.length === 0, errors };
};

const validateAndFilterIds = (ids) => {
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return { isValid: false, message: 'Language IDs array is required and must not be empty', validIds: [] };
  }
  const validIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) {
    return { isValid: false, message: 'No valid Language IDs provided', validIds: [] };
  }
  return { isValid: true, validIds };
};

const cleanupFiles = (files) => {
  if (!files) return;
  const fileArrays = Array.isArray(files) ? [files] : Object.values(files);
  fileArrays.forEach(arr => {
    arr.forEach(file => {
      if (file?.path && !file.path.startsWith('http') && fs.existsSync(file.path)) {
        try { fs.unlinkSync(file.path); } catch (_) { }
      }
    });
  });
};

const getTranslationFilePath = (locale, type) => path.join('uploads', 'languages', locale, `${type}.json`);

const moveFileToLocaleDir = (file, locale) => {
  if (!file || !file.path || file.path.startsWith('http')) return file?.path || null;
  const targetDir = path.join(process.cwd(), 'uploads', 'languages', locale);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const newPath = path.join(targetDir, file.filename);
  try {
    fs.renameSync(file.path, newPath);
    return path.join('uploads', 'languages', locale, file.filename).replace(/\\/g, '/');
  } catch (err) {
    console.error('Error moving file:', err);
    return file.path.replace(/\\/g, '/');
  }
};

const ensureDirectoryExists = (filePath) => {
  const dir = path.dirname(path.join(process.cwd(), filePath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const readTranslationFile = (filePath) => {
  try {
    const abs = path.join(process.cwd(), filePath);
    if (fs.existsSync(abs)) return JSON.parse(fs.readFileSync(abs, 'utf8'));
    return {};
  } catch (err) {
    console.error(`Error reading translation file ${filePath}:`, err);
    return {};
  }
};

const writeTranslationFile = (filePath, json) => {
  try {
    ensureDirectoryExists(filePath);
    fs.writeFileSync(path.join(process.cwd(), filePath), JSON.stringify(json, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing translation file ${filePath}:`, err);
    return false;
  }
};

const processTranslationUpload = async (files, fieldName, defaultData) => {
  if (files && files[fieldName] && files[fieldName][0]) {
    try {
      const filePath = files[fieldName][0].path;
      let content;
      if (filePath.startsWith('http')) {
        const resp = await axios.get(filePath);
        content = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
      } else {
        content = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
      }
      return JSON.parse(content);
    } catch (err) {
      console.error(`Error processing uploaded translation file ${fieldName}:`, err);
    }
  }
  return defaultData;
};

const loadEnglishTranslations = () => {
  const localesPath = path.join(process.cwd(), 'locales', 'en');
  const read = (name) => {
    try {
      const p = path.join(localesPath, `${name}.json`);
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
    } catch { return {}; }
  };
  return { front: read('front') };
};

exports.createLanguage = async (req, res) => {
  try {
    const languageData = req.body;
    const validation = validateLanguageData(languageData);
    if (!validation.isValid) {
      cleanupFiles(req.files);
      return res.status(400).json({ success: false, message: 'Language validation failed', errors: validation.errors });
    }

    const { name, locale, is_rtl, is_active, is_default } = languageData;
    const languageLocale = locale.trim();

    const existingLanguage = await Language.findOne({ locale: languageLocale });
    if (existingLanguage) {
      cleanupFiles(req.files);
      return res.status(409).json({ success: false, message: 'A language with this locale already exists' });
    }

    const englishDefaults = loadEnglishTranslations();

    let translationType = 'front';
    if (req.files && req.files.front_translation_file && req.files.front_translation_file[0]) {
      translationType = path.parse(req.files.front_translation_file[0].originalname).name;
    }

    const frontFile = getTranslationFilePath(languageLocale, translationType);

    const frontContent = await processTranslationUpload(req.files, 'front_translation_file', languageData.front_translation_json || englishDefaults.front);

    writeTranslationFile(frontFile, frontContent);
    if (req.files && req.files.front_translation_file && req.files.front_translation_file[0]) {
      try { fs.unlinkSync(req.files.front_translation_file[0].path); } catch (e) {}
    }

    let flagPath = null;
    if (req.files && req.files.flag && req.files.flag[0]) {
      flagPath = moveFileToLocaleDir(req.files.flag[0], languageLocale);
    }

    if (is_default === true || is_default === 'true') {
      await Language.updateMany({}, { $set: { is_default: false } });
    }

    const language = await Language.create({
      name: name.trim(),
      locale: languageLocale,
      flag: flagPath,
      front_translation_file: frontFile,
      is_rtl: is_rtl !== undefined ? is_rtl : false,
      is_active: is_active !== undefined ? is_active : true,
      is_default: is_default === true || is_default === 'true',
    });

    let setting = await Setting.findOne();
    if (!setting) {
      setting = await Setting.create({});
    }

    return res.status(201).json({ success: true, message: 'Language created successfully', data: language });
  } catch (error) {
    console.error('Error creating language:', error);
    cleanupFiles(req.files);
    return res.status(500).json({ success: false, message: 'Failed to create language', error: error.message });
  }
};

exports.getLanguages = async (req, res) => {
  try {
    const { search, is_active } = req.query;
    const { page, limit, skip } = parsePaginationParams(req.query);
    const { sortField, sortOrder } = parseSortParams(req.query);

    const searchQuery = buildSearchQuery(search);
    
    if (is_active !== undefined) searchQuery.is_active = is_active === 'true';

    const [languages, total] = await Promise.all([
      Language.find(searchQuery).sort({ [sortField]: sortOrder }).skip(skip).limit(limit),
      Language.countDocuments(searchQuery),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        languages,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching languages:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch languages', error: error.message });
  }
};

exports.getLanguageById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid language ID' });
    }
    const language = await Language.findOne({ _id: id });
    if (!language) {
      return res.status(404).json({ success: false, message: 'Language not found' });
    }
    return res.status(200).json({ success: true, data: language });
  } catch (error) {
    console.error('Error fetching language:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch language', error: error.message });
  }
};

exports.updateLanguage = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      cleanupFiles(req.files);
      return res.status(400).json({ success: false, message: 'Invalid language ID' });
    }

    const language = await Language.findOne({ _id: id });
    if (!language) {
      cleanupFiles(req.files);
      return res.status(404).json({ success: false, message: 'Language not found' });
    }

    const validation = validateLanguageData({ ...language.toObject(), ...updateData });
    if (!validation.isValid) {
      cleanupFiles(req.files);
      return res.status(400).json({ success: false, message: 'Language validation failed', errors: validation.errors });
    }

    if (updateData.locale) {
      const newLocale = updateData.locale.trim();
      if (newLocale !== language.locale) {
        const conflict = await Language.findOne({ locale: newLocale, _id: { $ne: id } });

        if (conflict) {
          cleanupFiles(req.files);
          return res.status(409).json({
            success: false,
            message: 'A language with this locale already exists'
          });
        }

        language.locale = newLocale;
      }
    }

    if (req.files?.flag?.[0]) {
      language.flag = moveFileToLocaleDir(req.files.flag[0], language.locale);
    }

    if (updateData.name !== undefined) {
      language.name = updateData.name.trim();
    }

    if (
      updateData.flag !== undefined &&
      (!req.files || !req.files.flag)
    ) {
      language.flag = updateData.flag;
    }

    if (updateData.is_rtl !== undefined) {
      language.is_rtl = updateData.is_rtl;
    }

    if (updateData.sort_order !== undefined) {
      language.sort_order = updateData.sort_order;
    }

    if (updateData.is_active !== undefined) {
      const isActive =
        updateData.is_active === true ||
        updateData.is_active === 'true';

      if (language.is_default && !isActive) {
        cleanupFiles(req.files);
        return res.status(400).json({
          success: false,
          message:
            'Default language cannot be deactivated. Change the default language first.'
        });
      }

      language.is_active = isActive;
    }

    if (updateData.is_default !== undefined) {
      const isDefault =
        updateData.is_default === true ||
        updateData.is_default === 'true';

      if (isDefault) {
        if (!language.is_active && updateData.is_active !== true && updateData.is_active !== 'true') {
          cleanupFiles(req.files);
          return res.status(400).json({
            success: false,
            message: 'A deactivated language cannot be set as default.'
          });
        }

        await Language.updateMany(
          {
            _id: { $ne: id }
          },
          {
            $set: { is_default: false }
          }
        );

        language.is_default = true;


      } else {
        const defaultLanguages = await Language.countDocuments({
          is_default: true
        });

        if (language.is_default && defaultLanguages <= 1) {
          cleanupFiles(req.files);
          return res.status(400).json({
            success: false,
            message:
              'At least one language must remain as default.'
          });
        }

        language.is_default = false;
      }
    }

    let translationType = language.front_translation_file ? path.parse(language.front_translation_file).name : 'front';
    if (req.files && req.files.front_translation_file && req.files.front_translation_file[0]) {
      translationType = path.parse(req.files.front_translation_file[0].originalname).name;
      language.front_translation_file = getTranslationFilePath(language.locale, translationType);
    }

    const frontContent = await processTranslationUpload(
      req.files,
      'front_translation_file',
      updateData.front_translation_json
    );

    if (frontContent !== undefined) {
      writeTranslationFile(
        language.front_translation_file,
        frontContent
      );
    }
    
    if (req.files && req.files.front_translation_file && req.files.front_translation_file[0]) {
      try { fs.unlinkSync(req.files.front_translation_file[0].path); } catch (e) {}
    }

    await language.save();

    cleanupFiles(req.files);

    return res.status(200).json({
      success: true,
      message: 'Language updated successfully',
      data: language
    });
  } catch (error) {
    console.error('Error updating language:', error);

    cleanupFiles(req.files);

    return res.status(500).json({
      success: false,
      message: 'Failed to update language',
      error: error.message
    });
  }
};

exports.deleteLanguages = async (req, res) => {
  try {
    const { ids } = req.body;
    const validation = validateAndFilterIds(ids);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const { validIds } = validation;
    const languages = await Language.find({ _id: { $in: validIds } });

    if (languages.length === 0) {
      return res.status(404).json({ success: false, message: 'No languages found with the provided IDs' });
    }

    const foundIds = languages.map(l => l._id.toString());
    const notFoundIds = validIds.filter(id => !foundIds.includes(id.toString()));
    const deletableIds = [];
    const usedIds = [];

    for (const l of languages) {
      if (l.is_default) usedIds.push(l._id.toString());
      else deletableIds.push(l._id.toString());
    }

    if (deletableIds.length > 0) {
      const languagesToDelete = languages.filter(l => deletableIds.includes(l._id.toString()));
      await Language.deleteMany({ _id: { $in: deletableIds } });
      
      for (const lang of languagesToDelete) {
        const langDir = path.join(process.cwd(), 'uploads', 'languages', lang.locale);
        if (fs.existsSync(langDir)) {
          try {
            fs.rmSync(langDir, { recursive: true, force: true });
          } catch (e) {
            console.error(`Failed to delete folder ${langDir}:`, e);
          }
        }
      }
    }

    const response = {
      success: true,
      message: `${deletableIds.length} language(s) deleted successfully`,
      data: { deletedCount: deletableIds.length, deletedIds: deletableIds },
    };

    if (usedIds.length > 0) {
      response.data.usedIds = usedIds;
      response.message += `, ${usedIds.length} language(s) are set as system default and cannot be deleted`;
    }
    if (notFoundIds.length > 0) {
      response.data.notFoundIds = notFoundIds;
      response.message += `, ${notFoundIds.length} language(s) not found`;
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error deleting languages:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete languages', error: error.message });
  }
};

exports.getTranslations = async (req, res) => {
  try {
    const { locale: identifier } = req.params;
    const query = {};
    if (mongoose.Types.ObjectId.isValid(identifier)) query._id = identifier;
    else query.locale = identifier;

    const language = await Language.findOne(query);
    if (!language) {
      return res.status(404).json({ success: false, message: 'Language not found' });
    }

    const dynamicKey = language.front_translation_file ? path.parse(language.front_translation_file).name : 'front';
    return res.status(200).json({
      success: true,
      data: {
        [dynamicKey]: readTranslationFile(language.front_translation_file)
      },
    });
  } catch (error) {
    console.error('Error fetching translations:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch translations', error: error.message });
  }
};

exports.updateTranslations = async (req, res) => {
  try {
    const { locale: identifier } = req.params;
    const { translations } = req.body;

    if (!translations || typeof translations !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid translations format' });
    }

    const query = {};
    if (mongoose.Types.ObjectId.isValid(identifier)) query._id = identifier;
    else query.locale = identifier;

    const language = await Language.findOne(query);
    if (!language) {
      return res.status(404).json({ success: false, message: 'Language not found' });
    }

    let updatedAny = false;
    const dynamicKey = language.front_translation_file ? path.parse(language.front_translation_file).name : 'front';
    
    if (translations[dynamicKey] && typeof translations[dynamicKey] === 'object') {
      const filePath = language.front_translation_file;
      if (filePath) {
        const existing = readTranslationFile(filePath) || {};
        writeTranslationFile(filePath, { ...existing, ...translations[dynamicKey] });
        updatedAny = true;
      }
    }

    if (!updatedAny) {
      return res.status(400).json({ success: false, message: `No valid translations provided (${dynamicKey})` });
    }

    return res.status(200).json({ success: true, message: 'Translations updated successfully' });
  } catch (error) {
    console.error('Error updating translations:', error);
    return res.status(500).json({ success: false, message: 'Failed to update translations', error: error.message });
  }
};

exports.toggleLanguageStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid language ID' });
    }

    const language = await Language.findOne({ _id: id });
    if (!language) {
      return res.status(404).json({ success: false, message: 'Language not found' });
    }

    if (language.is_active && language.is_default) {
      return res.status(400).json({ success: false, message: 'Default language cannot be deactivated. Change the default language first.' });
    }

    language.is_active = !language.is_active;
    await language.save();

    return res.status(200).json({
      success: true,
      message: `Language ${language.is_active ? 'activated' : 'deactivated'} successfully`,
      data: language,
    });
  } catch (error) {
    console.error('Error toggling language status:', error);
    return res.status(500).json({ success: false, message: 'Failed to toggle language status', error: error.message });
  }
};

exports.toggleDefaultLanguage = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid language ID' });
    }

    const language = await Language.findOne({ _id: id });
    if (!language) {
      return res.status(404).json({ success: false, message: 'Language not found' });
    }

    if (!language.is_active) {
      return res.status(400).json({ success: false, message: 'A deactivated language cannot be set as default.' });
    }

    await Language.updateMany({ _id: { $ne: id } }, { $set: { is_default: false } });
    language.is_default = true;
    await language.save();

    let setting = await Setting.findOne();
    if (!setting) {
      setting = await Setting.create({});
    }

    return res.status(200).json({ success: true, message: 'Default language updated successfully', data: language });
  } catch (error) {
    console.error('Error toggling default language:', error);
    return res.status(500).json({ success: false, message: 'Failed to toggle default language', error: error.message });
  }
};
