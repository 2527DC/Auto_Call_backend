const { db } = require('../models');
const Template = db.Template;
const Category = db.Category;

exports.getAllTemplates = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';
        const sortField = req.query.sort_by || 'created_at';
        const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 1 : -1;
        const allowedSortFields = ['name', 'created_at', 'updated_at'];
        const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

        let query = {};
        if (search) {
            query = {
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { content: { $regex: search, $options: 'i' } }
                ]
            };
        }

        const [templates, total] = await Promise.all([
            Template.find(query).sort({ [safeSortField]: sortOrder }).skip(skip).limit(limit).populate('user_id', 'name').populate('category', 'name'),
            Template.countDocuments(query),
        ]);
        return res.status(200).json({
            message: 'Templates fetched successfully.',
            total,
            totalPages: Math.ceil(total / limit),
            page,
            limit,
            templates,
        });
    } catch (error) {
        console.error('Error in getAllTemplates : ', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

exports.getSelfTemplates = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const category = req.query.category || '';
    const sortField = req.query.sort_by || 'created_at';
    const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 1 : -1;

    try {
        const allowedSortFields = ['name', 'created_at', 'updated_at'];
        const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

        let baseQuery = {
            $or: [
                { user_id: req.user._id },
                { is_system: true },
                { is_public: true }
            ]
        };

        if (category) {
            baseQuery = {
                ...baseQuery,
                category: category
            };
        }

        let query = baseQuery;
        if (search) {
            query = {
                $and: [
                    baseQuery,
                    {
                        $or: [
                            { name: { $regex: search, $options: 'i' } },
                            { content: { $regex: search, $options: 'i' } }
                        ]
                    }
                ]
            };
        }

        const [templates, total] = await Promise.all([
            Template.find(query).sort({ [safeSortField]: sortOrder }).skip(skip).limit(limit).populate('category', 'name'),
            Template.countDocuments(query),
        ]);

        return res.status(200).json({
            message: 'Templates fetched successfully.',
            total,
            totalPages: Math.ceil(total / limit),
            page,
            limit,
            templates,
        });
    } catch (error) {
        console.error('Error in getSelfTemplates : ', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.createTemplate = async (req, res) => {
    const { name, category, content, system_prompt, welcome_message, goodbye_message, communication_style, behavior_style, is_public } = req.body;
    try {
        if (!name || !category || !content || !system_prompt) {
            return res.status(400).json({ message: 'Name, category, content and system_prompt are required.' });
        }

        const existingTemplate = await Template.findOne({ name });
        if (existingTemplate) {
            return res.status(400).json({ message: 'Template already exists.' });
        }

        const trimName = name.trim();
        if (trimName.length < 3) {
            return res.status(400).json({ message: 'Template name must be at least 3 characters long. ' })
        }

        const existingCategory = await Category.findById(category);
        if (!existingCategory) {
            return res.status(400).json({ message: 'Category does not exist. ' })
        }

        if (existingCategory.user_id.toString() !== req.user._id.toString() && existingCategory.is_system === false) {
            return res.status(403).json({ message: 'You do not have permission to create template in this category. ' });
        }

        const template = await Template.create({
            name: trimName,
            category,
            content: content.trim(),
            system_prompt: system_prompt.trim(),
            welcome_message: welcome_message?.trim() || '',
            goodbye_message: goodbye_message?.trim() || '',
            communication_style,
            behavior_style,
            is_public: is_public || false,
            user_id: req.user._id
        });

        res.status(201).json({ message: 'Template created successfully.', template });
    } catch (error) {
        console.error('Error in createTemplate:', error);

        return res.status(500).json({ message: 'Internal server error' });
    }
}

exports.updateTemplate = async (req, res) => {
    const { id } = req.params;
    const { name, category, content, system_prompt, welcome_message, goodbye_message, communication_style, behavior_style, is_public } = req.body;

    try {

        if (!id) {
            return res.status(400).json({ message: 'Template ID is required. ' })
        }

        const template = await Template.findById(id);
        if (!template) {
            return res.status(404).json({ message: 'Template not found. ' })
        }

        if (template.is_system === true) {
            return res.status(403).json({ message: 'You do not have permission to update system generated template.' });
        }

        if (template.user_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'You do not have permission to update this template.' });
        }

        if (name) {
            const trimmedName = name?.trim();
            if (trimmedName !== template.name) {
                const existingTemplate = await Template.findOne({ name: { $regex: `^${trimmedName}$`, $options: 'i' }, _id: { $ne: id } })
                if (existingTemplate) {
                    return res.status(400).json({ message: 'Template with this name already exists. ' });
                }
                template.name = trimmedName;
            }
        }

        if (category) {
            const existingCategory = await Category.findById(category);
            if (!existingCategory) {
                return res.status(400).json({ message: 'Category does not exist. ' });
            }
            if (existingCategory.user_id.toString() !== req.user._id.toString() && existingCategory.is_system === false) {
                return res.status(403).json({ message: 'You do not have permission to create template in this category. ' });
            }
            template.category = category;
        }

        if (content) template.content = content.trim();
        if (system_prompt) template.system_prompt = system_prompt.trim();
        if (welcome_message) template.welcome_message = welcome_message.trim();
        if (goodbye_message) template.goodbye_message = goodbye_message.trim();
        if (communication_style) template.communication_style = communication_style;
        if (behavior_style) template.behavior_style = behavior_style;
        if (is_public !== undefined) template.is_public = is_public;

        await template.save();

        const updatedTemplate = await Template.findById(id).populate('category', 'name');

        return res.status(200).json({ message: 'Template updated successfully.', template: updatedTemplate });

    } catch (error) {
        console.error('Error in updateTemplate : ', error);
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Template with this name already exists. ' });
        }
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.deleteTemplate = async (req, res) => {
    const { ids } = req.body;

    try {
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'Template IDs array is required. ' });
        }

        const templates = await Template.find({ _id: { $in: ids }, user_id: req.user._id });
        if (templates.length === 0) {
            return res.status(403).json({ message: 'You do not have permission to delete these templates.' });
        }
        const targetIds = templates.map(t => t._id);

        const result = await Template.deleteMany({ _id: { $in: targetIds } });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'No templates found. ' });
        }

        const response = { message: `${result.deletedCount} template(s) deleted successfully.`, deletedCount: result.deletedCount };

        return res.status(200).json(response);
    } catch (error) {
        console.error('Error in deleteTemplate : ', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};
