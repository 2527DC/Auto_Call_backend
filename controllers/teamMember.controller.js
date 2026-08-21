'use strict';

const mongoose = require('mongoose');
const { db } = require('../models');
const Team = db.Team;
const TeamMember = db.TeamMember;
const TeamPermission = db.TeamPermission;
const Permission = db.Permission;
const bcrypt = require('bcryptjs');
const EmailDispatcher = require('../services/emailDispatcher');

exports.addTeamMember = async (req, res) => {
  try {
    const { teamId, first_name, last_name, email, password, phone_number, avatar, status } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({ success: false, message: 'Invalid team ID' });
    }

    if (!first_name || !email || !password || !phone_number) {
      return res.status(400).json({
        success: false,
        message: 'First name, email, password, and phone number are required'
      });
    }

    const team = await Team.findOne({ _id: teamId, user_id: userId, deleted_at: null });
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found or unauthorized' });
    }

    const emailExists = await TeamMember.findOne({ team_id: teamId, email: email.toLowerCase().trim() });
    if (emailExists) {
      return res.status(409).json({ success: false, message: 'A team member with this email already exists in this team' });
    }

    const phoneExists = await TeamMember.findOne({ team_id: teamId, phone_number: phone_number.trim() });
    if (phoneExists) {
      return res.status(409).json({ success: false, message: 'A team member with this phone number already exists in this team' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const isSuperAdminOrAdmin = req.user.roleId && (
      req.user.roleId.name === 'super_admin' || req.user.roleId === 'super_admin' ||
      req.user.roleId.name === 'admin' || req.user.roleId === 'admin'
    );

    const member = await TeamMember.create({
      user_id: userId,
      team_id: teamId,
      first_name: first_name.trim(),
      last_name: (last_name || '').trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      phone_number: phone_number.trim(),
      avatar: avatar || null,
      status: status || 'active',
      isAdmin: isSuperAdminOrAdmin ? true : false
    });

    const setting = await db.Setting.findOne().lean();
    if (!setting || setting.is_demo_mode !== true) {
      EmailDispatcher.dispatch(email.toLowerCase().trim(), 'team-member-created', {
        user_name: first_name.trim(),
        login_email: email.toLowerCase().trim(),
        login_password: password,
        login_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/team-member/login`
      }).catch(err => console.error('Error sending team member email:', err));
    }

    const responseData = {
      _id: member._id,
      id: member._id.toString(),
      first_name: member.first_name,
      last_name: member.last_name,
      email: member.email,
      phone_number: member.phone_number,
      avatar: member.avatar,
      status: member.status,
      isAdmin: member.isAdmin,
      created_at: member.created_at,
      updated_at: member.updated_at
    };

    return res.status(201).json({
      success: true,
      message: 'Team member created successfully',
      data: responseData
    });
  } catch (error) {
    console.error('Error adding team member:', error);
    return res.status(500).json({ success: false, message: 'Failed to add team member' });
  }
};

exports.removeTeamMember = async (req, res) => {
  try {
    const { teamId, memberIds } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return res.status(400).json({ success: false, message: 'Invalid team ID' });
    }

    const ids = memberIds;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'memberIds array is required and must not be empty' });
    }

    const team = await Team.findOne({ _id: teamId, user_id: userId, deleted_at: null });
    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found or unauthorized' });
    }

    const validIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid IDs provided' });
    }

    const members = await TeamMember.find({ _id: { $in: validIds }, team_id: teamId, user_id: userId });
    const memberMap = new Map(members.map(m => [m._id.toString(), m]));

    const results = { successful: [], notFound: [] };

    for (const id of validIds) {
      const member = memberMap.get(id.toString());
      if (!member) {
        results.notFound.push(id);
        continue;
      }

      await TeamMember.deleteOne({ _id: member._id });
      results.successful.push({
        memberId: member._id,
        name: `${member.first_name || ''} ${member.last_name || ''}`.trim(),
        email: member.email,
        phone_number: member.phone_number
      });
    }

    return res.status(200).json({
      success: true,
      message: `${results.successful.length} team member(s) removed successfully`,
      data: {
        removedCount: results.successful.length,
        notFoundCount: results.notFound.length,
        successful: results.successful,
        notFound: results.notFound
      }
    });

  } catch (error) {
    console.error('Error removing team members:', error);
    return res.status(500).json({ success: false, message: 'Failed to remove team members' });
  }
};

exports.getAllTeamMembers = async (req, res) => {
  try {
    const userId = req.user._id;

    const isSuperAdminOrAdmin = req.user.roleId && (
      req.user.roleId.name === 'super_admin' || req.user.roleId === 'super_admin' ||
      req.user.roleId.name === 'admin' || req.user.roleId === 'admin'
    );

    const permissionDoc = await Permission.findOne({ slug: 'handleTransfer.calls' }).lean();
    if (!permissionDoc) {
      return res.status(200).json({ success: true, data: [] });
    }

    const teamPermissions = await TeamPermission.find({ permission_id: permissionDoc._id }).lean();
    if (!teamPermissions.length) {
      return res.status(200).json({ success: true, data: [] });
    }

    const teamIds = teamPermissions.map(tp => tp.team_id);

    let query = { team_id: { $in: teamIds } };
    if (!isSuperAdminOrAdmin) {
      query.user_id = userId;
    }

    const members = await TeamMember.find(query).lean();

    return res.status(200).json({ success: true, data: members });
  } catch (error) {
    console.error('Error fetching all team members:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch all team members' });
  }
};

exports.getTeamMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid team ID' });
    }

    const isSuperAdminOrAdmin = req.user.roleId && (
      req.user.roleId.name === 'super_admin' || req.user.roleId === 'super_admin' ||
      req.user.roleId.name === 'admin' || req.user.roleId === 'admin'
    );

    let team;
    if (isSuperAdminOrAdmin) {
      team = await Team.findOne({ _id: id, deleted_at: null });
    } else {
      team = await Team.findOne({ _id: id, user_id: userId, deleted_at: null });
    }

    if (!team) {
      return res.status(404).json({ success: false, message: 'Team not found or unauthorized' });
    }

    let members;
    if (isSuperAdminOrAdmin) {
      members = await TeamMember.find({ team_id: id }).lean();
    } else {
      members = await TeamMember.find({ team_id: id, user_id: userId }).lean();
    }

    return res.status(200).json({ success: true, data: members });
  } catch (error) {
    console.error('Error fetching team members:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch team members' });
  }
};

exports.getTeamsWithTransferPermission = async (req, res) => {
  try {
    const userId = req.user._id;

    const permissionDoc = await Permission.findOne({ slug: 'handleTransfer.calls' }).lean();
    if (!permissionDoc) {
      return res.status(200).json({ success: true, data: [] });
    }

    const teamPermissions = await TeamPermission.find({ permission_id: permissionDoc._id }).lean();
    if (!teamPermissions.length) {
      return res.status(200).json({ success: true, data: [] });
    }

    const teamIds = teamPermissions.map(tp => tp.team_id);

    const teams = await Team.find({
      _id: { $in: teamIds },
      user_id: userId,
      deleted_at: null,
      status: 'active'
    }).lean();

    return res.status(200).json({ success: true, data: teams });
  } catch (error) {
    console.error('Error fetching teams with transfer permission:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch teams with transfer permission' });
  }
};
