const { db } = require('../models')

exports.create = async (req, res) => {
    try {
        const { name, description, content } = req.body

        if (!name || !content) {
            return res.status(400).json({ success: false, message: 'Name and content are required' })
        }

        const templateNameExists = await db.SMSTemplate.findOne({
            name,
            user_id: req.user.id
        })

        if (templateNameExists) {
            return res.status(400).json({ success: false, message: 'Template name already exists' })
        }

        const SMSTemplate = await db.SMSTemplate.create({
            name,
            description,
            content,
            status: 'active',
            user_id: req.user.id
        })

        return res.status(201).json({ success: true, message: 'SMS Template created successfully', data: SMSTemplate })
    } catch (error) {
        console.log('Error While Creating SMS Template in database', error)
        return res.status(500).json({ success: false, message: 'Internal server error' })
    }
}

exports.getSelf = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '', sort = 'created_at', order = 'desc' } = req.query;
        const user_id = req.user.id || req.user._id;
        const query = { user_id };

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { content: { $regex: search, $options: 'i' } }
            ];
        }

        const sortOptions = {};
        sortOptions[sort] = order === 'asc' ? 1 : -1;

        const templates = await db.SMSTemplate.find(query)
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort(sortOptions);

        const total = await db.SMSTemplate.countDocuments(query);

        return res.status(200).json({
            success: true,
            data: templates,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error While Fetching Self SMS Templates:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.getAll = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '', sort = 'created_at', order = 'desc' } = req.query;
        const query = {
            $or: [
                { is_system: true },
                { user_id: req.user._id }
            ]
        };

        if (search) {
            query.$and = [
                {
                    $or: [
                        { name: { $regex: search, $options: 'i' } },
                        { content: { $regex: search, $options: 'i' } }
                    ]
                }
            ];
        }

        const sortOptions = {};
        sortOptions[sort] = order === 'asc' ? 1 : -1;

        const templates = await db.SMSTemplate.find(query)
            .populate('user_id', 'name email')
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort(sortOptions);

        const total = await db.SMSTemplate.countDocuments(query);

        return res.status(200).json({
            success: true,
            data: templates,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error While Fetching All SMS Templates:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

exports.update = async (req, res) => {
    try {
        const { id } = req.params
        const { name, description, content, status } = req.body

        const SMSTemplate = await db.SMSTemplate.findById(id)
    
        if (!SMSTemplate) {
            return res.status(404).json({ success: false, message: 'SMS Template not found' })
        }
    
        if (SMSTemplate.user_id.toString() !== req.user.id.toString()) {
            return res.status(401).json({ success: false, message: 'Unauthorized' })
        }
    
        if (name) {
            const templateNameExists = await db.SMSTemplate.findOne({
                name,
                user_id: req.user.id,
                _id: { $ne: id }
            })
    
            if (templateNameExists) {
                return res.status(400).json({ success: false, message: 'Template name already exists' })
            }
            SMSTemplate.name = name
        }
    
        if (description !== undefined) {
            SMSTemplate.description = description
        }
    
        if (content) {
            SMSTemplate.content = content
        }
            
        if (status) {
            SMSTemplate.status = status
        }

        await SMSTemplate.save()

        return res.status(200).json({ success: true, message: 'SMS Template updated successfully', data: SMSTemplate })
    } catch (error) {
        console.log('Error While Updating SMS Template in database', error)
        return res.status(500).json({ success: false, message: 'Internal server error' })
    }
}

exports.delete = async (req, res) => {
    try {
        const { id } = req.params

        const template = await db.SMSTemplate.findById(id)
        if (!template) {
            return res.status(404).json({ success: false, message: 'SMS Template not found' })
        }

        if (template.user_id.toString() !== req.user.id.toString()) {
            return res.status(401).json({ success: false, message: 'Unauthorized' })
        }

        await db.SMSTemplate.deleteOne({ _id: id })

        return res.status(200).json({ success: true, message: 'SMS Template deleted successfully' })
    } catch (error) {
        console.log('Error While Deleting SMS Template in database', error)
        return res.status(500).json({ success: false, message: 'Internal server error' })
    }
}