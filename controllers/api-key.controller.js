const { db } = require('../models');
const { encryptToken } = require('../utils/encryption');
const crypto = require('crypto');

exports.create = async (req, res) => {
    try {
        const { name, permissions } = req.body;
        const user_id = req.user.id || req.user._id;

        if (!name || !permissions || !Array.isArray(permissions)) {
            return res.status(400).json({ success: false, message: 'Name and permissions (array) are required' });
        }

        if (Array.isArray(permissions)) {
            if (permissions.length === 0) {
                return res.status(400).json({ success: false, message: 'At least one permission is required' });
            }

            const validPermisison = await db.RolePermission.find({
                role_id: req.user.roleId,
                permission_id: { $in: permissions }
            })

            if (validPermisison.length === 0) {
                return res.status(400).json({ success: false, message: 'Invalid permission(s) specified' });
            }
        }

        const setting = await db.Setting.findOne();
        const prefixString = setting && setting.apikey_prefix ? setting.apikey_prefix : 'ACC-';

        const randomString = crypto.randomBytes(32).toString('hex');
        const apiKey = `${prefixString}${randomString}`;

        const encryptedKey = encryptToken(apiKey);

        const newApiKey = new db.ApiKey({
            user_id,
            name,
            prefix: setting ? setting._id : null,
            encrypted_key: encryptedKey,
            permissions
        });

        await newApiKey.save();

        res.status(201).json({
            success: true,
            message: 'API Key created successfully. Please copy it now as it will not be shown again.',
            data: {
                _id: newApiKey._id,
                name: newApiKey.name,
                prefix: newApiKey.prefix,
                permissions: newApiKey.permissions,
                created_at: newApiKey.created_at,
                raw_key: apiKey
            }
        });
    } catch (error) {
        console.error('Error creating API key:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getSelf = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '', sortBy = 'created_at', sortOrder = 'desc' } = req.query;
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
        const user_id = req.user._id || req.user.id;
        const query = { user_id };

        if (search) {
            query.name = { $regex: search, $options: 'i' };
        }

        const apiKeys = await db.ApiKey.find(query)
            .populate('permissions')
            .select('-prefix -encrypted_key')
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort(sortOptions);

        const total = await db.ApiKey.countDocuments(query);

        res.status(200).json({
            success: true,
            apiKeys,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching self API keys:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getAll = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '', sortBy = 'created_at', sortOrder = 'desc' } = req.query;
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
        const query = {};

        if (search) {
            query.name = { $regex: search, $options: 'i' };
        }

        const apiKeys = await db.ApiKey.find(query)
            .populate('permissions')
            .select('-prefix -encrypted_key')
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort(sortOptions);

        const total = await db.ApiKey.countDocuments(query);

        res.status(200).json({
            success: true,
            apiKeys,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching API keys:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.updateStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const apiKey = await db.ApiKey.findById(id);
        if (!apiKey) {
            return res.status(404).json({ success: false, message: 'API Key not found' });
        }
        const isAdmin = req.user.roleId && (req.user.roleId.name === 'super_admin' || req.user.roleId.name === 'admin');
        if (!isAdmin) {
            return res.status(403).json({ success: false, message: 'Only admin can change status' });
        }

        const newStatus = !apiKey.is_active;

        await db.ApiKey.updateOne(
            { _id: id },
            { $set: { is_active: newStatus } }
        )

        res.status(200).json({ success: true, message: 'API Key status updated successfully' });
    } catch (error) {
        console.error('Error updating API key status:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.regenerate = async (req, res) => {
    try {
        const { id } = req.params;

        const setting = await db.Setting.findOne();
        const prefixString = setting && setting.apikey_prefix ? setting.apikey_prefix : 'ACC-';

        const apiKey = await db.ApiKey.findById(id);
        if (!apiKey) {
            return res.status(404).json({ success: false, message: 'API Key not found' });
        }
        if (apiKey.user_id.toString() !== req.user.id.toString()) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const randomString = crypto.randomBytes(32).toString('hex');
        const newApiKey = `${prefixString}${randomString}`;

        const encryptedKey = encryptToken(newApiKey);

        await db.ApiKey.updateOne(
            { _id: id, user_id: req.user.id },
            { $set: { encrypted_key: encryptedKey, updated_at: new Date() } }
        )

        res.status(201).json({
            success: true,
            message: 'API Key Regenerate successfully. Please copy it now as it will not be shown again.',
            data: {
                _id: id,
                name: apiKey.name,
                prefix: apiKey.prefix,
                permissions: apiKey.permissions,
                raw_key: newApiKey
            }
        });
    } catch (error) {
        console.error('Error regenerating API key:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.delete = async (req, res) => {
    try {
        const { id } = req.params;
        const apiKey = await db.ApiKey.findById(id);
        if (!apiKey) {
            return res.status(404).json({ success: false, message: 'API Key not found' });
        }
        if (apiKey.user_id.toString() !== req.user.id.toString()) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        await db.ApiKey.deleteOne({ _id: id, user_id: req.user.id })

        res.status(200).json({ success: true, message: 'API Key deleted successfully' });
    } catch (error) {
        console.error('Error deleting API key:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getById = async (req, res) => {
    try {
        const { id } = req.params;

        const apiKey = await db.ApiKey.findById(id).populate('permissions').select('-prefix -encrypted_key');

        if (!apiKey) {
            return res.status(404).json({ success: false, message: 'API Key not found' });
        }

        res.status(200).json({ success: true, apiKeys: [apiKey] });
    } catch (error) {
        console.error('Error fetching API key:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};