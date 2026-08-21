'use strict';

const jwt = require('jsonwebtoken');
const { db } = require('../models');
const User = db.User;
const Session = db.Session;
const RolePermission = db.RolePermission;
const Permission = db.Permission;
const ApiKey = db.ApiKey;
const TeamMember = db.TeamMember;
const { decryptToken } = require('../utils/encryption');

const extractApiKeyFromRequest = (req) => {
  const headerKey = req.headers['x-api-key'];
  if (headerKey && typeof headerKey === 'string' && headerKey.trim()) {
    return headerKey.trim();
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('ApiKey ')) {
    return authHeader.slice('ApiKey '.length).trim();
  }

  return null;
};

exports.authenticate = async (req, res, next) => {
  const apiKey = extractApiKeyFromRequest(req);
  if (apiKey) {
    try {
      const activeKeys = await ApiKey.find({ is_active: true })
        .populate('permissions', 'slug')
        .lean();

      if (activeKeys.length === 0) {
        return res.status(401).json({ success: false, message: 'API Key is not activated' });
      }

      let matchedKey = null;
      for (const k of activeKeys) {
        try {
          if (k.encrypted_key && decryptToken(k.encrypted_key) === apiKey) {
            matchedKey = k;
            break;
          }
        } catch (e) {
          console.error('API Key error:', e);
        }
      }

      if (!matchedKey) {
        return res.status(401).json({ success: false, message: 'Invalid API Key' });
      }

      const key = matchedKey;

      const user = await User.findById(key.user_id).populate('roleId');
      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid API Key - User not found' });
      }

      user.permissionSlugs = key.permissions ? key.permissions.map(p => p.slug) : [];

      req.user = user;
      req.authType = 'api_key';

      ApiKey.findByIdAndUpdate(key._id, {
        $set: { last_used_at: new Date() }
      }).catch(() => { });

      return next();
    } catch (err) {
      console.error('API Key error:', err);
      return res.status(401).json({ success: false, message: 'API Key authentication failed' });
    }
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization token missing or malformed' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user;
    if (decoded.isTeamMember) {
      const member = await TeamMember.findById(decoded.id);
      if (!member) {
        return res.status(401).json({ message: 'Invalid token: team member not found' });
      }
      user = {
        _id: member._id,
        id: member._id.toString(),
        name: `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'Team Member',
        email: member.email,
        phone_number: member.phone_number,
        avatar: member.avatar,
        status: member.status,
        team_id: member.team_id,
        user_id: member.user_id,
        isTeamMember: true,
        roleId: null
      };
    } else {
      user = await User.findById(decoded.id).populate('roleId');
      if (!user) {
        return res.status(401).json({ message: 'Invalid token: user not found' });
      }
    }

    const session = await Session.findOne({ user_id: user._id, session_token: token, status: 'active' });
    if (!session) {
      return res.status(401).json({ message: 'Session expired or logged out. Please log in again.' });
    }

    if (session.expires_at && new Date() > new Date(session.expires_at)) {
      await Session.updateOne({ _id: session._id }, { $set: { status: 'inactive' } });
      return res.status(401).json({ message: 'Session expired or logged out. Please log in again.' });
    }

    if (session.agenda && session.agenda.startsWith('impersonation_by_')) {
      req.isImpersonating = true;
      req.impersonatorId = session.agenda.replace('impersonation_by_', '');
    } else if (decoded.isImpersonated) {
      req.isImpersonating = true;
      req.impersonatorId = decoded.impersonatorId;
    } else {
      req.isImpersonating = false;
    }

    if (user.team_id) {
      const TeamPermission = db.TeamPermission;
      const teamPerms = await TeamPermission.find({ team_id: user.team_id })
        .populate('permission_id', 'slug')
        .lean();
      user.permissionSlugs = teamPerms
        .filter(tp => tp.permission_id)
        .map(tp => tp.permission_id.slug);
    } else {
      const roleId = user.roleId ? (user.roleId._id || user.roleId) : null;
      if (roleId) {
        const rolePerms = await RolePermission.find({ role_id: roleId })
          .populate('permission_id', 'slug')
          .lean();
        user.permissionSlugs = rolePerms
          .filter(rp => rp.permission_id)
          .map(rp => rp.permission_id.slug);
      } else {
        user.permissionSlugs = [];
      }
    }

    req.user = user;
    req.token = token;

    next();
  } catch (err) {
    console.error('JWT error:', err);
    return res.status(401).json({ message: 'Token is invalid or expired' });
  }
};