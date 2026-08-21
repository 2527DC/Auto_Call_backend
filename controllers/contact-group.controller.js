const { db } = require('../models')
const { ContactGroup, Contact } = db;

exports.createGroup = async (req, res) => {
    try {
        const userId = req.user._id;
        const { group_name, group_description, group_contacts } = req.body;

        if (!group_name) {
            return res.status(400).json({ success: false, message: 'Group name is required' });
        }

        if (group_name) {
            const existingGroup = await ContactGroup.findOne({
                user_id: userId,
                group_name: group_name.trim()
            });

            if (existingGroup) {
                return res.status(400).json({ success: false, message: 'Group name already exists' });
            }
        }

        if (!group_contacts || group_contacts.length === 0) {
            return res.status(400).json({ success: false, message: 'Group contacts is required' });
        }

        if (group_contacts && group_contacts.length > 0) {
            const existingContacts = await Contact.find({
                user_id: userId,
                _id: { $in: group_contacts }
            });

            if (!existingContacts || existingContacts.length !== group_contacts.length) {
                return res.status(400).json({ success: false, message: 'One or more contacts are invalid or not found' });
            }
        }

        const group = new ContactGroup({
            user_id: req.user._id,
            group_name,
            group_description,
            group_contacts
        });

        await group.save();
        await group.populate('group_contacts', 'first_name last_name email');

        res.status(201).json({ success: true, data: group, message: 'Group created successfully' });

    } catch (error) {
        console.log('Error while creating group: ', error);
        res.status(500).json({ success: false, message: error.message });
    }
}

exports.getAllGroups = async (req, res) => {
    try {
        const userId = req.user._id;
        const { page = 1, limit = 10, search = '', sortBy = 'created_at', sortOrder = 'desc' } = req.query;
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const query = { user_id: userId };

        if (search) {
            query.$or = [
                { group_name: { $regex: search, $options: 'i' } },
                { group_description: { $regex: search, $options: 'i' } }
            ];
        }

        const groups = await ContactGroup.find(query)
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort(sortOptions)
            .populate('group_contacts', 'first_name last_name email');

        const total = await ContactGroup.countDocuments(query);


        res.status(200).json({
            success: true,
            data: groups,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

exports.getGroupById = async (req, res) => {
    try {
        const userId = req.user._id;
        const groupId = req.params.id;
        const { page = 1, limit = 10, search = '', sortBy = 'created_at', sortOrder = 'desc' } = req.query;
        const sortOptions = {};
        sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const group = await ContactGroup.findOne({ user_id: userId, _id: groupId });

        if (!group) {
            return res.status(404).json({ success: false, message: 'Contact group not found' });
        }

        const query = { user_id: userId, _id: { $in: group.group_contacts } };

        if (search) {
            query.$or = [
                { phone_number: { $regex: search, $options: 'i' } },
                { first_name: { $regex: search, $options: 'i' } },
                { last_name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const contacts = await Contact.find(query)
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .sort(sortOptions);

        const total = await Contact.countDocuments(query);

        const responseData = group.toObject();
        responseData.contacts = contacts;

        res.status(200).json({
            success: true,
            data: responseData,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

exports.updateGroup = async (req, res) => {
    try {
        const userId = req.user._id;
        const groupId = req.params.id;
        const { group_name, group_description, group_contacts } = req.body;

        if (!group_name && !group_description && !group_contacts) {
            return res.status(400).json({ success: false, message: 'No updates provided' });
        }

        const group = await ContactGroup.findOne({ user_id: userId, _id: groupId });

        if (!group) {
            return res.status(404).json({ success: false, message: 'Contact group not found' });
        }

        if (group_name) {
            const existingGroup = await ContactGroup.findOne({
                user_id: userId,
                group_name: group_name.trim(),
                _id: { $ne: groupId }
            });

            if (existingGroup) {
                return res.status(400).json({ success: false, message: 'Group name already exists' });
            }
            group.group_name = group_name;
        }

        if (group_description) {
            group.group_description = group_description;
        }

        if (Array.isArray(group_contacts)) {
            await Contact.updateMany(
                { group_ids: group._id, _id: { $nin: group_contacts }, user_id: req.user._id },
                { $pull: { group_ids: group._id } }
            );

            await Contact.updateMany(
                { _id: { $in: group_contacts }, user_id: req.user._id },
                { $addToSet: { group_ids: group._id } }
            );

            group.group_contacts = group_contacts;
        }

        await group.save();

        res.status(200).json({
            success: true,
            data: group,
            message: 'Group updated successfully'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

exports.deleteGroup = async (req, res) => {
    try {
        const userId = req.user._id;
        const groupId = req.params.id;

        const group = await ContactGroup.findOne({ user_id: userId, _id: groupId });

        if (!group) {
            return res.status(404).json({ success: false, message: 'Contact group not found' });
        }

        await ContactGroup.deleteOne({ _id: groupId });

        await Contact.updateMany(
            { group_ids: groupId, user_id: userId },
            { $pull: { group_ids: groupId } }
        );

        res.status(200).json({
            success: true,
            message: 'Group deleted successfully'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}