const { db } = require('../models');
const TenantGuide = db.TenantGuide;

exports.create = async (req, res) => {
    try {
        const { title, description, endpoints } = req.body;

        if (!title || !endpoints || !Array.isArray(endpoints) || endpoints.length === 0) {
            return res.status(400).json({ success: false, message: 'Title and at least one endpoint are required' });
        }

        const existingTenantGuide = await TenantGuide.findOne({ title: title });
        if (existingTenantGuide) {
            return res.status(400).json({ success: false, message: 'Title already exists' });
        }

        const urlPaths = endpoints.map(ep => ep.url_path ? ep.url_path.toLowerCase().trim() : '');
        const pathExist = await TenantGuide.findOne({
            "endpoints.url_path": { $in: urlPaths }
        });

        if (pathExist) {
            return res.status(400).json({ success: false, message: 'One or more endpoints already exist' });
        }

        const tenantGuide = new TenantGuide({
            title,
            description,
            endpoints
        });

        await tenantGuide.save();
        return res.status(201).json({
            success: true,
            message: 'Tenant Guide created successfully',
            tenantGuide
        });
    } catch (error) {
        console.log("Tenant Guide Error: ", error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

exports.getAll = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const is_active = req.query.is_active;

        const skip = (page - 1) * limit;

        const query = {};

        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { "endpoints.sub_title": { $regex: search, $options: 'i' } },
                { "endpoints.url_path": { $regex: search, $options: 'i' } }
            ];
        }

        if (is_active !== undefined) {
            query.is_active = is_active === 'true';
        }

        const totalRecords = await TenantGuide.countDocuments(query);
        const totalPages = Math.ceil(totalRecords / limit);

        const tenantGuide = await TenantGuide.find(query)
            .skip(skip)
            .limit(limit)
            .sort({ created_at: -1 })
            .lean();

        if (search) {
            const regex = new RegExp(search, 'i');
            tenantGuide.forEach(guide => {
                const titleMatch = regex.test(guide.title);
                if (!titleMatch && guide.endpoints) {
                    guide.endpoints = guide.endpoints.filter(ep =>
                        regex.test(ep.sub_title) || regex.test(ep.url_path)
                    );
                }
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Tenant Guide fetched successfully',
            tenantGuide,
            pagination: {
                totalRecords,
                totalPages,
                currentPage: page,
                pageSize: limit
            }
        });
    } catch (error) {
        console.log("Tenant Guide Error: ", error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

exports.getById = async (req, res) => {
    try {
        const tenantGuide = await TenantGuide.findById(req.params.id).lean();

        if (!tenantGuide) {
            return res.status(404).json({ success: false, message: 'Tenant Guide not found' });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';

        if (search && tenantGuide.endpoints) {
            const regex = new RegExp(search, 'i');
            tenantGuide.endpoints = tenantGuide.endpoints.filter(ep =>
                regex.test(ep.sub_title) || regex.test(ep.url_path) || regex.test(ep.content)
            );
        }

        const totalRecords = tenantGuide.endpoints ? tenantGuide.endpoints.length : 0;
        const totalPages = Math.ceil(totalRecords / limit);

        if (tenantGuide.endpoints) {
            const skip = (page - 1) * limit;
            tenantGuide.endpoints = tenantGuide.endpoints.slice(skip, skip + limit);
        }

        return res.status(200).json({
            success: true,
            message: 'Tenant Guide fetched successfully',
            tenantGuide,
            pagination: {
                totalRecords,
                totalPages,
                currentPage: page,
                pageSize: limit
            }
        });
    } catch (error) {
        console.log("Tenant Guide Error: ", error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, endpoints, is_active } = req.body;

        const tenantGuide = await TenantGuide.findById(id);
        if (!tenantGuide) {
            return res.status(404).json({ success: false, message: 'Tenant Guide not found' });
        }

        if (is_active !== undefined) {
            tenantGuide.is_active = is_active;
        }

        if (title) {
            const exist = await TenantGuide.findOne({
                title: title.toLowerCase().trim(),
                _id: { $ne: id }
            })

            if (exist) {
                return res.status(400).json({ success: false, message: 'Title already exists' });
            }
            tenantGuide.title = title;
        }

        if (description) {
            tenantGuide.description = description;
        }

        if (endpoints && Array.isArray(endpoints)) {
            const urlPaths = endpoints.map(ep => ep.url_path ? ep.url_path.toLowerCase().trim() : '');
            const exist = await TenantGuide.findOne({
                "endpoints.url_path": { $in: urlPaths },
                _id: { $ne: id }
            })

            if (exist) {
                return res.status(400).json({ success: false, message: 'url_path already exists in another guide' });
            }
            tenantGuide.endpoints = endpoints;
        }

        tenantGuide.updated_at = new Date();

        await tenantGuide.save();
        return res.status(200).json({
            success: true,
            message: 'Tenant Guide updated successfully',
            tenantGuide
        });
    } catch (error) {
        console.log("Tenant Guide Error: ", error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

exports.delete = async (req, res) => {
    try {
        const { id } = req.params;
        const tenantGuide = await TenantGuide.findById(id);
        if (!tenantGuide) {
            return res.status(404).json({ success: false, message: 'Tenant Guide not found' });
        }
        await TenantGuide.deleteOne({ _id: id });
        return res.status(200).json({ success: true, message: 'Tenant Guide deleted successfully' });
    } catch (error) {
        console.log("Tenant Guide Error: ", error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

exports.deleteEndpoint = async (req, res) => {
    try {
        const { guideId, endpointId } = req.params;

        const tenantGuide = await TenantGuide.findById(guideId);
        if (!tenantGuide) {
            return res.status(404).json({ success: false, message: 'Tenant Guide not found' });
        }

        const result = await TenantGuide.updateOne(
            { _id: guideId },
            { $pull: { endpoints: { _id: endpointId } } }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({ success: false, message: 'Endpoint not found in this guide' });
        }

        return res.status(200).json({ success: true, message: 'Endpoint deleted successfully' });
    } catch (error) {
        console.log("Tenant Guide Error: ", error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}
