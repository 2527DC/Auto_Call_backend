'use strict';

const mongoose = require('mongoose');
const { db } = require('../models');
const Role = db.Role;
const Permission = db.Permission;
const RolePermission = db.RolePermission;
const Team = db.Team;
const TeamPermission = db.TeamPermission;
const User = db.User;

const parsePaginationParams = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 15));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

exports.getRoles = async (req, res) => {
  try {
    const { search, sort_by, sort_order } = req.query;
    const { page, limit, skip } = parsePaginationParams(req.query);

    const query = {};
    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    const sort = {};
    if (sort_by) {
      sort[sort_by] = sort_order === 'DESC' ? -1 : 1;
    } else {
      sort.created_at = -1;
    }

    const [roles, total] = await Promise.all([
      Role.find(query).sort(sort).skip(skip).limit(limit).lean(),
      Role.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        roles,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit,
        },
      },
    });
  } catch (error) {
    console.error('getRoles error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch roles' });
  }
};

exports.getActiveRoles = async (req, res) => {
  try {
    const roles = await Role.find({
      $or: [
        { system_reserved: true },
        { is_active: true }
      ]
    }).sort({ created_at: -1 }).lean();

    return res.status(200).json({
      success: true,
      data: roles
    });
  } catch (error) {
    console.error('getActiveRoles error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch active roles' });
  }
};

exports.getRoleById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid role ID' });
    }

    const role = await Role.findById(id).lean();
    if (!role) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    const rolePermissions = await RolePermission.find({ role_id: id })
      .populate('permission_id')
      .lean();

    const permissions = rolePermissions
      .filter(rp => rp.permission_id)
      .map(rp => rp.permission_id);

    return res.status(200).json({
      success: true,
      data: { role, permissions }
    });
  } catch (error) {
    console.error('getRoleById error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch role' });
  }
};

exports.createRole = async (req, res) => {
  try {
    const { name, description, is_active } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Role name is required' });
    }

    const trimmedName = name.trim();
    const regexName = new RegExp(`^${trimmedName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i');

    const existing = await Role.findOne({ name: { $regex: regexName } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'A role with this name already exists' });
    }

    const role = await Role.create({
      name: trimmedName,
      description: description ? description.trim() : undefined,
      is_active: is_active !== undefined ? is_active : true,
      system_reserved: false,
    });

    return res.status(201).json({
      success: true,
      message: 'Role created successfully',
      data: role,
    });
  } catch (error) {
    console.error('createRole error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create role' });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, permissions, is_active, sort_order } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid role ID' });
    }

    const role = await Role.findOne({ _id: id, deleted_at: null });
    if (!role) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    if (role.system_reserved && name && name.trim() !== role.name) {
      return res.status(403).json({ success: false, message: 'System reserved role names cannot be changed' });
    }

    if (name) {
      const trimmedName = name.trim();
      const regexName = new RegExp(`^${trimmedName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i');

      const existingRole = await Role.findOne({ name: { $regex: regexName }, _id: { $ne: id } });
      if (existingRole) {
        return res.status(409).json({ success: false, message: 'A role with this name already exists' });
      }

      role.name = trimmedName;
    }

    if (description !== undefined) {
      role.description = description;
    }

    if (is_active !== undefined) {
      role.is_active = is_active;
    }

    if (sort_order !== undefined) {
      role.sort_order = sort_order;
    }

    await role.save();

    if (permissions && Array.isArray(permissions)) {
      const permissionDocs = await Permission.find().lean();

      const slugToPermissionMap = {};

      permissionDocs.forEach((doc) => {
        if (doc.slug) {
          slugToPermissionMap[doc.slug] = doc._id;
        }
      });

      const existingPermissions = await RolePermission.find({ role_id: id }).populate('permission_id').lean();
      const existingSlugsMap = {};

      existingPermissions.forEach((p) => {
        if (p.permission_id && p.permission_id.slug) {
          existingSlugsMap[p.permission_id.slug] = p.permission_id._id;
        }
      });

      const existingSlugs = Object.keys(existingSlugsMap);
      const newSlugs = permissions;

      const toDeleteSlugs = existingSlugs.filter((s) => !newSlugs.includes(s));
      const toAddSlugs = newSlugs.filter((s) => !existingSlugs.includes(s));

      if (toDeleteSlugs.length) {
        const deleteIds = toDeleteSlugs.map((s) => existingSlugsMap[s]);

        await RolePermission.deleteMany({ role_id: id, permission_id: { $in: deleteIds } });
      }

      const ops = [];

      toAddSlugs.forEach((slug) => {

        const permissionId = slugToPermissionMap[slug];
        if (!permissionId) return;

        ops.push({
          updateOne: {
            filter: { role_id: id, permission_id: permissionId },
            update: { role_id: id, permission_id: permissionId },
            upsert: true
          }
        });

      });

      if (ops.length) {
        await RolePermission.bulkWrite(ops);
      }

      const allowedPermissionDocs = await Permission.find({
        slug: { $in: permissions }
      }).select('_id').lean();
      const allowedPermissionIds = allowedPermissionDocs.map(p => p._id);

      const usersWithRole = await User.find({ roleId: id }).select('_id').lean();
      const userIds = usersWithRole.map(u => u._id);

      if (userIds.length > 0) {
        const teams = await Team.find({ user_id: { $in: userIds } }).select('_id').lean();
        const teamIds = teams.map(t => t._id);

        if (teamIds.length > 0) {
          await TeamPermission.deleteMany({
            team_id: { $in: teamIds },
            permission_id: { $nin: allowedPermissionIds }
          });
        }
      }
    }

    return res.status(200).json({ success: true, message: 'Role updated successfully', data: role });
  } catch (error) {
    console.error('Error updating role:', error);
    return res.status(500).json({ success: false, message: 'Failed to update role', });

  }
};

exports.deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid role ID' });
    }

    const role = await Role.findById(id);
    if (!role) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    if (role.system_reserved) {
      return res.status(403).json({ success: false, message: 'System-reserved roles cannot be deleted' });
    }

    await RolePermission.deleteMany({ role_id: id });
    await Role.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: 'Role deleted successfully',
    });
  } catch (error) {
    console.error('deleteRole error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete role' });
  }
};

exports.getRolePermissions = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid role ID' });
    }

    const role = await Role.findById(id).lean();
    if (!role) {
      return res.status(404).json({ success: false, message: 'Role not found' });
    }

    const rolePermissions = await RolePermission.find({ role_id: id })
      .populate('permission_id')
      .lean();

    const permissions = rolePermissions
      .filter(rp => rp.permission_id)
      .map(rp => rp.permission_id);

    return res.status(200).json({
      success: true,
      data: { role, permissions },
    });
  } catch (error) {
    console.error('getRolePermissions error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch role permissions' });
  }
};

exports.getAllPermissions = async (req, res) => {
  try {
    const permissions = await Permission.find().lean();
    return res.status(200).json({ success: true, data: permissions });
  } catch (error) {
    console.error('getAllPermissions error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch permissions' });
  }
};
