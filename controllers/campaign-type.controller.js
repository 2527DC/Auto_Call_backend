const { db } = require('../models');
const CampaignType = db.CampaignType;

exports.createCampaignType = async (req, res) => {
    const { name, description, status } = req.body;
    const userId = req.user.id;

    try {   
        if (!name) {
            return res.status(400).json({ message: 'Name is required.' });
        }

        const trimmedName = name.trim();

        const existingCampaignType = await CampaignType.findOne({ name: { $regex: `^${trimmedName}$`, $options: 'i' }, userId });
        if (existingCampaignType) {
            return res.status(409).json({ message: 'Campaign type with this name already exists.' });
        }

        const campaignType = await CampaignType.create({
            name: trimmedName,
            description: description?.trim() || '',
            status: status !== undefined ? status : true,
            user_id: userId
        });

        res.status(201).json({ message: 'Campaign type created successfully', campaignType });
    } catch (error) {
        console.error('Error in createCampaignType:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.getAllCampaignTypes = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const sortField = req.query.sortBy || req.query.sort_by || 'created_at';
    const sortOrderStr = req.query.sortOrder || req.query.sort_order || 'desc';
    const sortOptions = {};
    sortOptions[sortField] = (sortOrderStr === 'desc' || sortOrderStr === 'DESC' || sortOrderStr === '-1') ? -1 : 1;
    const userId = req.user.id;

    try {

        let query = { user_id: userId }

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
            ];
        }

        const [campaignTypes, total] = await Promise.all([
            CampaignType.find(query).sort(sortOptions).skip(skip).limit(limit),
            CampaignType.countDocuments(query),
        ]);

        res.status(200).json({
            message: 'All campaign types fetched successfully.',
            total,
            totalPages: Math.ceil(total / limit),
            page,
            limit,
            campaignTypes,
        });
    } catch (error) {
        console.error('Error in getAllCampaignTypes:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.getCampaignTypeById = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {

        if (!id) return res.status(400).json({ message: 'Campaign type ID is required.' });

        const campaignType = await CampaignType.findOne({ _id: id, user_id: userId });

        if (!campaignType) return res.status(404).json({ message: 'Campaign type not found.' });

        res.status(200).json({ message: 'Campaign type fetched successfully.', campaignType });
    } catch (error) {
        console.error('Error in getCampaignTypeById:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.updateCampaignType = async (req, res) => {
    const { id } = req.params;
    const { name, description, status } = req.body;
    const userId = req.user.id;

    try {
        if (!id) {
            return res.status(400).json({ message: 'Campaign type ID is required.' });
        }

        const campaignType = await CampaignType.findOne({ _id: id, user_id: userId });
        if (!campaignType) {
            return res.status(404).json({ message: 'Campaign type not found.' });
        }

        if (name === undefined && description === undefined && status === undefined) {
            return res.status(400).json({ message: 'At least one field required to update' });
        }

        const updateData = {}

        if (name !== undefined) {

            const trimmedName = name.trim();

            if (!trimmedName) {
                return res.status(400).json({ message: 'Name is required.' });
            }

            const existingCampaignType = await CampaignType.findOne({
                name: { $regex: `^${trimmedName}$`, $options: 'i' }, userId, _id: { $ne: id }
            });

            if (existingCampaignType) {
                return res.status(409).json({
                    message: 'Campaign type with this name already exists.'
                });
            }

            updateData.name = trimmedName;
        }

        if (description !== undefined) {
            updateData.description = description.trim();
        }

        if (status !== undefined) {
            updateData.status = Boolean(status);
        }


        await CampaignType.updateOne(
            { _id: id, user_id: userId },
            {
                $set: updateData
            }
        );

        const updatedCampaignType = await CampaignType.findOne({ _id: id, user_id: userId });

        return res.status(200).json({ message: 'Campaign type updated successfully', campaignType: updatedCampaignType, });
    } catch (error) {
        console.error('Error in updateCampaignType:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.updateCampaignStatus = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        if (!id) return res.status(400).json({ message: 'Id is required.' });

        const campaignType = await CampaignType.findOne({ _id: id, user_id: userId });
        if (!campaignType) return res.status(404).json({ message: 'Campaign type not found.' });

        await campaignType.updateOne({ status: Boolean(campaignType.status) === true ? false : true });
        res.status(200).json({ message: `Campaign type ${campaignType.status ? 'deactivated' : 'activated'} successfully.` });
    } catch (error) {
        console.error('Error in updateCampaignStatus:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.deleteCampaignType = async (req, res) => {
    const { ids } = req.body;
    const userId = req.user.id;

    try {
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'Campaign type IDs array is required' });
        }

        const result = await CampaignType.deleteMany({ _id: { $in: ids }, user_id: userId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'No campaign types found.' });
        }

        const response = { message: `${result.deletedCount} campaign type(s) deleted successfully`, deletedCount: result.deletedCount };

        return res.status(200).json(response);
    } catch (error) {
        console.error('Error in deleteCampaignType:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};