const { db } = require('../models');
const Category = db.Category;

exports.getAllCategories = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';
        const sortField = req.query.sortBy || req.query.sort_by || 'created_at';
        const sortOrderStr = req.query.sortOrder || req.query.sort_order || 'desc';
        const sortOptions = {};
        sortOptions[sortField] = (sortOrderStr === 'desc' || sortOrderStr === 'DESC' || sortOrderStr === '-1') ? -1 : 1;

        let query = {};
        if (search) {
            query = {
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { description: { $regex: search, $options: 'i' } }
                ]
            };
        }

        const [categories, total] = await Promise.all([
            Category.find(query).sort(sortOptions).skip(skip).limit(limit).populate('user_id', 'name'),
            Category.countDocuments(query),
        ]);
        return res.status(200).json({
            message: 'Categories fetched successfully.',
            total,
            totalPages: Math.ceil(total / limit),
            page,
            limit,
            categories,
        });
    } catch (error) {
        console.error('Error in getAllCategories : ', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

exports.getSelfCategories = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const sortField = req.query.sortBy || req.query.sort_by || 'created_at';
    const sortOrderStr = req.query.sortOrder || req.query.sort_order || 'desc';
    const sortOptions = {};
    sortOptions[sortField] = (sortOrderStr === 'desc' || sortOrderStr === 'DESC' || sortOrderStr === '-1') ? -1 : 1;
    try {

        const baseQuery = {
            $or: [
                { user_id: req.user._id },
                { is_system: true }
            ]
        };

        let query = baseQuery;
        if (search) {
            query = {
                $and: [
                    baseQuery,
                    {
                        $or: [
                            { name: { $regex: search, $options: 'i' } },
                            { description: { $regex: search, $options: 'i' } }
                        ]
                    }
                ]
            };
        }

        const [categories, total] = await Promise.all([
            Category.find(query).sort(sortOptions).skip(skip).limit(limit),
            Category.countDocuments(query),
        ]);

        return res.status(200).json({
            message: 'Categories fetched successfully.',
            total,
            totalPages: Math.ceil(total / limit),
            page,
            limit,
            categories,
        });
    } catch (error) {
        console.error('Error in getSelfCategories : ', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.createCategory = async (req, res) => {
    const { name, description } = req.body;
    try {
        if (!name) {
            return res.status(400).json({ message: 'Name is required.' });
        }

        const existingCategory = await Category.findOne({ name });
        if (existingCategory) {
            return res.status(400).json({ message: 'Category already exists.' });
        }

        const trimName = name.trim();

        const category = await Category.create({
            name: trimName,
            description: description ? description.trim() : '',
            user_id: req.user._id
        });

        res.status(201).json({ message: 'Category created successfully.', category });
    } catch (error) {
        console.error('Error in createCategory:', error);

        return res.status(500).json({ message: 'Internal server error' });
    }
}

exports.updateCategory = async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;

    try {

        if (!id) {
            return res.status(400).json({ message: 'Category ID is required. ' })
        }

        const category = await Category.findById(id);
        if (!category) {
            return res.status(404).json({ message: 'Category not found. ' })
        }

        if (category.is_system === true) {
            return res.status(403).json({ message: 'You do not have permission to update system generated category.' });
        }

        if (category.user_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'You do not have permission to update this category.' });
        }

        if (!name && description === undefined) {
            return res.status(400).json({ message: 'Name or description must be provided.' })
        }

        if (name) {
            const trimmedName = name?.trim();
            if (trimmedName !== category.name) {
                const existingCategory = await Category.findOne({ name: { $regex: `^${trimmedName}$`, $options: 'i' }, _id: { $ne: id } })
                if (existingCategory) {
                    return res.status(400).json({ message: 'Category with this name already exists. ' });
                }
                category.name = trimmedName;
            }
        }

        if (description !== undefined) {
            category.description = description ? description.trim() : '';
        }

        await category.save();

        const updatedCategory = await Category.findById(id);

        return res.status(200).json({ message: 'Category updated successfully.', category: updatedCategory });

    } catch (error) {
        console.error('Error in updateCategory : ', error);
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Category with this name already exists. ' });
        }
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.deleteCategory = async (req, res) => {
    const { ids } = req.body;

    try {
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'Category IDs array is required. ' });
        }

        const categories = await Category.find({ _id: { $in: ids }, user_id: req.user._id });
        if (categories.length === 0) {
            return res.status(403).json({ message: 'You do not have permission to delete these categories.' });
        }
        const targetIds = categories.map(c => c._id);

        const result = await Category.deleteMany({ _id: { $in: targetIds } });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'No categories found. ' });
        }

        const response = { message: `${result.deletedCount} category(s) deleted successfully.`, deletedCount: result.deletedCount };

        return res.status(200).json(response);
    } catch (error) {
        console.error('Error in deleteCategory : ', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};