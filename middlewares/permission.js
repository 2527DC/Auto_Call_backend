'use strict';

const { db } = require('../models');
const Permission = db.Permission;
const RolePermission = db.RolePermission;
const Team = db.Team;
const TeamPermission = db.TeamPermission;
const { checkActiveSubscription, permissionNeedsSubscription } = require('./subscription');

// Customers (and their team members / API keys) need an active plan for any
// action beyond viewing; admins are exempt.
const subscriptionBlock = async (user, roleName, permissionSlug) => {
  if (roleName === 'super_admin' || roleName === 'admin') return null;
  if (!permissionNeedsSubscription(permissionSlug)) return null;
  const ownerId = user.isTeamMember ? user.user_id : user._id;
  if (!ownerId) return null;
  const result = await checkActiveSubscription(ownerId);
  return result.ok ? null : result;
};

const sendSubscriptionBlock = (res, block) =>
  res.status(402).json({ success: false, code: block.code, message: block.message });

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
          const block = await subscriptionBlock(user, roleName, permissionSlug);
          if (block) return sendSubscriptionBlock(res, block);
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

        const teamBlock = await subscriptionBlock(user, roleName, permissionSlug);
        if (teamBlock) return sendSubscriptionBlock(res, teamBlock);

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

      const block = await subscriptionBlock(user, roleName, permissionSlug);
      if (block) return sendSubscriptionBlock(res, block);

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