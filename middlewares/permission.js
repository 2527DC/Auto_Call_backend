'use strict';

const { db } = require('../models');
const Permission = db.Permission;
const RolePermission = db.RolePermission;
const Team = db.Team;
const TeamPermission = db.TeamPermission;

exports.checkPermission = (permissionSlug) => {
  return async (req, res, next) => {
    try {

      const user = req.user;
      if (!user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const role = user.roleId && user.roleId.name ? user.roleId : null;
      const roleName = role ? role.name : null;

      if (roleName === 'super_admin' && req.authType !== 'api_key') {
        return next();
      }

      if (req.authType === 'api_key') {
        if (req.user.permissionSlugs && req.user.permissionSlugs.includes(permissionSlug)) {
          return next();
        }
        return res.status(403).json({ success: false, message: 'Access denied: API Key required permissions' });
      }

      if (user.team_id) {
        const team = await Team.findOne({ _id: user.team_id, deleted_at: null }).lean();
        if (!team || team.status !== 'active') {
          return res.status(403).json({ success: false, message: 'Access denied: Team is inactive or deleted' });
        }

        const permissionDoc = await Permission.findOne({ slug: permissionSlug }).lean();
        if (!permissionDoc) {
          return res.status(403).json({ success: false, message: `Invalid permission: '${permissionSlug}'` });
        }

        const hasPermission = await TeamPermission.exists({
          team_id: user.team_id,
          permission_id: permissionDoc._id
        });

        if (!hasPermission) {
          return res.status(403).json({ success: false, message: 'Access denied: Team permission missing' });
        }

        return next();
      }

      const roleId = role ? role._id : user.roleId;
      if (!roleId) {
        return res.status(403).json({ success: false, message: 'Forbidden: No role assigned to user' });
      }

      const permissionDoc = await Permission.findOne({ slug: permissionSlug }).lean();
      if (!permissionDoc) {
        return res.status(403).json({ success: false, message: `Invalid permission: '${permissionSlug}'` });
      }

      const hasPermission = await RolePermission.exists({
        role_id: roleId,
        permission_id: permissionDoc._id
      });

      if (!hasPermission) {
        return res.status(403).json({ success: false, message: 'Access denied: Insufficient permissions' });
      }

      return next();

    } catch (error) {
      console.error('Permission middleware error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during permission check'
      });
    }
  };
};