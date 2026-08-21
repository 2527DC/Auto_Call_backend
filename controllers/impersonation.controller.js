'use strict';

const { db } = require('../models');
const User = db.User;
const Role = db.Role;
const Session = db.Session;
const { generateToken } = require('../utils/jwt');
const { formatUser } = require('../helpers/authHelpers');
const creditService = require('../services/creditService');

exports.startImpersonation = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'Target user ID is required' });
    }

    const impersonator = req.user;
    const impersonatorRole = impersonator.roleId ? (impersonator.roleId.name || impersonator.roleId.toString()) : null;

    if (impersonatorRole !== 'super_admin' && impersonatorRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admin or super_admin can impersonate users' });
    }

    const targetUser = await User.findById(targetUserId).populate('roleId');
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Target user not found' });
    }

    const targetRole = targetUser.roleId ? (targetUser.roleId.name || targetUser.roleId.toString()) : null;
    if (targetRole === 'super_admin' || targetRole === 'admin') {
      return res.status(400).json({ success: false, message: 'Cannot impersonate another super_admin or admin' });
    }

    if (!targetUser.isActive) {
      return res.status(400).json({ success: false, message: 'Target user account is inactive' });
    }

    const impersonationToken = generateToken({
      id: targetUser._id,
      email: targetUser.email,
      isImpersonated: true,
      impersonatorId: impersonator._id,
      originalRole: impersonatorRole
    });

    await Session.create({
      user_id: targetUser._id,
      session_token: impersonationToken,
      device_info: req.headers['user-agent'] || 'unknown',
      ip_address: req.ip,
      agenda: `impersonation_by_${impersonator._id}`,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'active',
    });

    const creditBalance = await creditService.getCreditBalance(targetUser._id);

    return res.status(200).json({
      success: true,
      message: 'Impersonation started successfully',
      token: impersonationToken,
      targetUser: formatUser(targetUser),
      impersonator: formatUser(impersonator),
      credits: creditBalance
    });
  } catch (error) {
    console.error('Error in startImpersonation:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.stopImpersonation = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const session = await Session.findOne({
      session_token: token,
      agenda: { $regex: /^impersonation_by_/ },
      status: 'active',
    });

    if (!session) {
      return res.status(400).json({ success: false, message: 'Not currently impersonating anyone' });
    }

    const impersonatorId = session.agenda.replace('impersonation_by_', '');

    const originalUser = await User.findById(impersonatorId).populate('roleId');
    if (!originalUser) {
      return res.status(404).json({ success: false, message: 'Original admin not found' });
    }

    const originalToken = generateToken({
      id: originalUser._id,
      email: originalUser.email,
    });

    await Session.updateOne({ _id: session._id }, { status: 'inactive' });

    await Session.create({
      user_id: originalUser._id,
      session_token: originalToken,
      device_info: req.headers['user-agent'] || 'unknown',
      ip_address: req.ip,
      agenda: 'login',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'active',
    });

    const creditBalance = await creditService.getCreditBalance(originalUser._id);

    return res.status(200).json({
      success: true,
      message: 'Impersonation stopped successfully',
      token: originalToken,
      originalUser: formatUser(originalUser),
      credits: creditBalance
    });
  } catch (error) {
    console.error('Stop impersonation error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getImpersonationStatus = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      isImpersonating: !!req.isImpersonating,
      impersonator: req.isImpersonating ? { id: req.impersonatorId } : null,
    });
  } catch (error) {
    console.error('Get status error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getAvailableUsersToImpersonate = async (req, res) => {
  try {
    const callerRole = req.user.roleId ? (req.user.roleId.name || req.user.roleId.toString()) : null;
    if (callerRole !== 'super_admin' && callerRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const adminRoles = await Role.find({ name: { $in: ['super_admin', 'admin'] } }).select('_id');
    const adminRoleIds = adminRoles.map(r => r._id);

    const query = {
      roleId: { $nin: adminRoleIds },
      isActive: true,
    };

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
      ];
    }

    const users = await User.find(query)
      .populate('roleId', 'name')
      .select('id name email avatar created_at roleId')
      .sort({ created_at: -1 })
      .lean();

    const availableUsers = users.map(u => ({
      id: u._id,
      name: u.name,
      email: u.email,
      avatar: u.avatar || null,
      role: u.roleId ? u.roleId.name : 'user',
      canImpersonate: true,
    }));

    return res.status(200).json({
      success: true,
      availableUsers,
      total: availableUsers.length,
    });
  } catch (error) {
    console.error('Get available users error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
