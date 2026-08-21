const bcrypt = require('bcryptjs');
const { db } = require('../models');
const User = db.User;
const Role = db.Role;
const Session = db.Session;
const OTPLog = db.OTPLog;
const RolePermission = db.RolePermission;
const TeamMember = db.TeamMember;
const Team = db.Team;
const TeamPermission = db.TeamPermission;
const fs = require('fs');
const path = require('path');
const { generateToken } = require('../utils/jwt');
const {
  hashPassword, isValidEmail, isValidPassword, findUserByEmail, isValidName, generateOTP, getSettings, checkMaintenanceAccess, formatUser
} = require('../helpers/authHelpers');
const creditService = require('../services/creditService');
const EmailDispatcher = require('../services/emailDispatcher');
const crypto = require('crypto');

exports.register = async (req, res) => {
  const { name, email, password } = req.body;
  const ip = req.ip;

  try {
    await checkMaintenanceAccess(ip);

    if (!isValidName(name) || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address.' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ message: 'User with this email already exists.' });
    }

    const otp = await generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000);

    const hashedPassword = await hashPassword(password);

    await OTPLog.create({
      email: email.toLowerCase().trim(),
      otp,
      expires_at,
      verified: false,
      metadata: {
        name: name.trim(),
        password: hashedPassword
      }
    });

    const settings = await getSettings();

    if (settings.is_demo_mode !== true) {
      await EmailDispatcher.dispatch(email.toLowerCase().trim(), 'registration-otp', {
        user_name: name.trim(),
        otp_code: otp
      });
    }

    return res.status(200).json({
      message: `Verification OTP sent successfully to ${email}`,
      demo_otp: settings.is_demo_mode ? '123456' : null
    });
  } catch (err) {
    if (err.message === 'MAINTENANCE_MODE') {
      const settings = await getSettings();
      return res.status(503).json({ message: settings.maintenance_message || 'System under maintenance', maintenance: true });
    }
    console.error('Registration request error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

exports.verifyRegistration = async (req, res) => {
  const { email, otp } = req.body;
  const ip = req.ip;

  try {
    await checkMaintenanceAccess(ip);

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required.' });
    }

    const settings = await getSettings();
    let isVerified = false;

    if (settings.is_demo_mode === true && otp === '123456') {
      isVerified = true;
    }

    const otpRecord = await OTPLog.findOne({
      email: email.toLowerCase().trim(),
      otp: settings.is_demo_mode === true && otp === '123456' ? { $exists: true } : otp,
      verified: false,
      expires_at: { $gt: new Date() }
    }).sort({ created_at: -1 });

    if (!isVerified) {
      if (!otpRecord || otpRecord.otp !== otp) {
        return res.status(400).json({ message: 'Invalid or expired OTP.' });
      }
      isVerified = true;
    } else {
      if (!otpRecord) {
        return res.status(400).json({ message: 'Invalid registration session. Please register again.' });
      }
    }

    const { metadata } = otpRecord;
    if (!metadata || !metadata.name || !metadata.password) {
      return res.status(400).json({ message: 'Invalid registration session. Please register again.' });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ message: 'User with this email already exists.' });
    }

    const userRole = await Role.findOne({ name: 'user' });

    const user = await User.create({
      name: metadata.name,
      email: email.toLowerCase().trim(),
      password: metadata.password,
      roleId: userRole ? userRole._id : null
    });

    const freeCredits = settings.free_credits_on_registration || 0;
    if (freeCredits > 0) {
      await creditService.addCredits(
        user._id,
        freeCredits,
        'registration_bonus',
        'Free credits on registration',
        null,
        null
      );
    }

    await otpRecord.updateOne({ verified: true });

    if (settings.is_demo_mode !== true) {
      EmailDispatcher.dispatch(user.email, 'welcome-message', {
        user_name: user.name,
        user_email: user.email,
        login_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`
      }).catch(err => console.error('Error sending welcome email:', err));
    }

    return res.status(201).json({
      message: 'User registered successfully.',
      user: formatUser(user),
      credits: freeCredits > 0 ? {
        total_credits: freeCredits,
        used_credits: 0,
        available_credits: freeCredits
      } : null
    });
  } catch (err) {
    if (err.message === 'MAINTENANCE_MODE') {
      const settings = await getSettings();
      return res.status(503).json({ message: settings.maintenance_message || 'System under maintenance', maintenance: true });
    }
    console.error('Registration verification error:', err);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip;

  try {
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address.' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password.' });
    }

    if (!user.isActive) {
      return res.status(400).json({ message: 'Your account has been deactivated.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid email or password.' });
    }

    await User.updateOne({ _id: user._id }, { $set: { lastLogin: new Date(), isOnline: true } });

    const token = generateToken({ id: user._id, email: user.email });

    const settings = await getSettings();

    const sessionLimit = settings?.session_limit || 10
    const activeSessions = await Session.find({
      user_id: user._id,
      status: 'active',
      device_info: req.headers['user-agent'],
    }).sort({ created_at: 1 });

    if (activeSessions.length >= sessionLimit) {
      await activeSessions[0].deleteOne();
    }

    const expires_at = new Date(Date.now() + (settings?.session_expiration_days || 7) * 24 * 60 * 60 * 1000);

    await Session.create({
      user_id: user._id,
      session_token: token,
      device_info: req.headers['user-agent'],
      ip_address: req.ip,
      agenda: 'login',
      expires_at
    });

    const roleId = user.roleId ? (user.roleId._id || user.roleId) : null;
    if (roleId) {
      const rolePerms = await RolePermission.find({ role_id: roleId })
        .populate('permission_id', 'slug name description')
        .lean();
      user.permissionSlugs = rolePerms
        .filter(rp => rp.permission_id)
        .map(rp => ({
          _id: rp.permission_id._id,
          slug: rp.permission_id.slug,
          name: rp.permission_id.name,
          description: rp.permission_id.description,
          __v: rp.permission_id.__v,
          created_at: rp.permission_id.created_at,
          updated_at: rp.permission_id.updated_at
        }));
    } else {
      user.permissionSlugs = [];
    }

    const creditBalance = await creditService.getCreditBalance(user._id);

    return res.status(200).json({
      message: 'Login successful!',
      token,
      user: formatUser(user),
      credits: creditBalance
    });
  } catch (err) {
    if (err.message === 'MAINTENANCE_MODE') {
      const settings = await getSettings();
      return res.status(503).json({ message: settings.maintenance_message || 'System under maintenance', maintenance: true });
    }
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const handleSocialSignup = async (req, res, profile) => {
  try {
    if (!profile || !profile.emails || !profile.emails[0].value) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=SocialAuthFailed`);
    }

    const email = profile.emails[0].value.toLowerCase().trim();
    let user = await findUserByEmail(email);

    const settings = await getSettings();

    if (!user) {
      const userRole = await Role.findOne({ name: 'user' });

      const randomPassword = crypto.randomBytes(16).toString('hex');
      const hashedPassword = await hashPassword(randomPassword);

      user = await User.create({
        name: profile.displayName || profile.name?.givenName || 'User',
        email: email,
        password: hashedPassword,
        roleId: userRole ? userRole._id : null,
        avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : null
      });

      const freeCredits = settings?.free_credits_on_registration || 0;
      if (freeCredits > 0) {
        await creditService.addCredits(
          user._id,
          freeCredits,
          'registration_bonus',
          'Free credits on registration',
          null,
          null
        );
      }

      if (settings?.is_demo_mode !== true) {
        EmailDispatcher.dispatch(user.email, 'welcome-message', {
          user_name: user.name,
          user_email: user.email,
          login_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`
        }).catch(err => console.error('Error sending welcome email:', err));
      }
    }

    await User.updateOne({ _id: user._id }, { $set: { lastLogin: new Date(), isOnline: true } });
    const token = generateToken({ id: user._id, email: user.email });

    const expires_at = new Date(Date.now() + (settings?.session_expiration_days || 7) * 24 * 60 * 60 * 1000);

    await Session.create({
      user_id: user._id,
      session_token: token,
      device_info: req.headers['user-agent'],
      ip_address: req.ip,
      agenda: 'social_signup',
      expires_at
    });

    const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback?token=${token}`;
    return res.redirect(redirectUrl);

  } catch (err) {
    console.error('Social Signup Callback error:', err);
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=InternalServerError`);
  }
};

exports.googleCallback = async (req, res) => {
  return handleSocialSignup(req, res, req.user);
};

exports.facebookCallback = async (req, res) => {
  return handleSocialSignup(req, res, req.user);
};

exports.logout = async (req, res) => {
  const userId = req.user._id;
  const token = req.token;

  try {
    const session = await Session.findOne({ user_id: userId, session_token: token, status: 'active' });
    if (!session) {
      return res.status(404).json({ message: 'Session not found or already logged out.' });
    }

    await Session.findByIdAndUpdate(session._id, { status: 'inactive' });
    await User.updateOne({ _id: userId }, { $set: { isOnline: false } });

    return res.status(200).json({ message: 'Logged out successfully.' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password').populate('roleId');
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const roleId = user.roleId ? (user.roleId._id || user.roleId) : null;
    if (roleId) {
      const rolePerms = await RolePermission.find({ role_id: roleId })
        .populate('permission_id', 'slug name description')
        .lean();
      user.permissionSlugs = rolePerms
        .filter(rp => rp.permission_id)
        .map(rp => ({
          _id: rp.permission_id._id,
          slug: rp.permission_id.slug,
          name: rp.permission_id.name,
          description: rp.permission_id.description,
          __v: rp.permission_id.__v,
          created_at: rp.permission_id.created_at,
          updated_at: rp.permission_id.updated_at
        }));
    } else {
      user.permissionSlugs = [];
    }

    return res.status(200).json({
      message: 'User Profile fetched successfully.',
      user: formatUser(user)
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateProfile = async (req, res) => {
  const { name, email, remove_avatar } = req.body;

  try {
    if (name && !isValidName(name)) {
      return res.status(400).json({ message: 'Name must be a valid string with content.' });
    }

    const user = await User.findById(req.user._id,);
    if (!user) return res.status(404).json({ message: 'User Not Found' });

    if (email && email !== user.email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: 'Invalid Email format' });
      }
      const existingEmail = await User.findOne({ email, _id: { $ne: user._id } });
      if (existingEmail) {
        return res.status(409).json({ message: 'Email already registered with this role' });
      }
    }

    const deleteOldAvatar = () => {
      if (!user.avatar) return;
      const oldAvatarPath = path.join(process.cwd(), user.avatar);
      if (fs.existsSync(oldAvatarPath)) {
        try {
          fs.unlinkSync(oldAvatarPath);
        } catch (error) {
          console.error('Error deleting old avatar', error);
        }
      }
    };

    let avatar = user.avatar;
    if (remove_avatar === 'true') {
      deleteOldAvatar();
      avatar = null;
    } else if (req.file) {
      deleteOldAvatar();
      avatar = req.file.path;
    }

    const updates = {};
    if (name) {
      updates.name = name.trim();
    }

    if (email) {
      updates.email = email;
    }

    updates.avatar = avatar;

    const updatedUser = await User.findByIdAndUpdate(req.user._id, updates, { new: true, select: '-password' });
    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json({
      message: 'Profile updated successfully.',
      user: formatUser(updatedUser)
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.requestPasswordReset = async (req, res) => {
  const { email } = req.body;
  const ip = req.ip;

  try {
    await checkMaintenanceAccess(ip);

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address.' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const otp = await generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000);

    const settings = await getSettings();
    if (settings.is_demo_mode !== true) {
      if (email) {
        const emailSent = await EmailDispatcher.dispatch(
          email,
          'password-reset-otp',
          {
            user_name: user.name,
            reset_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password`,
            otp_code: otp
          }
        );
        if (!emailSent.success) {
          console.error('[Request Reset OTP] Email Error:', emailSent.message);
          return res.status(500).json({ message: 'Failed to send OTP email' });
        }
      }
    }

    await OTPLog.create({ email: email, otp, expires_at, verified: false });

    return res.status(200).json({
      message: `OTP sent successfully to your email ${email}`,
      demo_otp: settings.is_demo_mode ? otp : null
    });

  } catch (error) {
    if (error.message === 'MAINTENANCE_MODE') {
      const settings = await getSettings();
      return res.status(503).json({ message: settings.maintenance_message || 'System under maintenance', maintenance: true });
    }
    console.error('Request password reset error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const ip = req.ip;

    if (!email || !otp) {
      return res.status(400).json({ message: 'email and OTP are required' });
    }

    await checkMaintenanceAccess(ip);

    const otpRecord = await OTPLog.findOne({
      email,
      otp,
      verified: false,
      expires_at: { $gt: new Date() },
    }).sort({ created_at: -1 });

    if (!otpRecord) return res.status(400).json({ message: 'Invalid or expired OTP' });

    await otpRecord.updateOne({ verified: true });

    return res.status(200).json({ message: 'OTP verified successfully' });
  } catch (error) {
    if (error.message === 'MAINTENANCE_MODE') {
      const settings = await getSettings();
      return res.status(503).json({ message: settings.maintenance_message || 'System under maintenance', maintenance: true });
    }
    console.error('Error verifying OTP:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.resendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const ip = req.ip;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    await checkMaintenanceAccess(ip);

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address.' });
    }

    const otpLog = await OTPLog.findOne({ email, verified: false, }).sort({ created_at: -1 });

    let otp;
    let expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    if (!otpLog || otpLog.expires_at < new Date()) {
      otp = await generateOTP();
      await OTPLog.create({
        email,
        otp,
        expires_at: expiresAt,
        verified: false,
      });
    } else {
      otp = otpLog.otp;
      await otpLog.updateOne({ expires_at: expiresAt });
    }

    const settings = await getSettings();
    if (settings.is_demo_mode !== true && email) {
      const user = await findUserByEmail(email);
      const sent = await EmailDispatcher.dispatch(
        email,
        'password-reset-otp',
        {
          user_name: user ? user.name : 'User',
          reset_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password`,
          otp_code: otp
        }
      );
      if (!sent.success) {
        console.error('[Resend OTP] Email Error:', sent.message);
        return res.status(500).json({ message: 'Failed to send OTP email' });
      }
    }

    return res.status(200).json({
      message: `OTP resent successfully to your email ${email}`,
      demo_otp: settings.is_demo_mode ? otp : null,
    });
  } catch (error) {
    console.error('Error resending OTP:', error);

    if (error.message === 'MAINTENANCE_MODE') {
      const settings = await getSettings();
      return res.status(503).json({ message: settings.maintenance_message || 'System under maintenance', maintenance: true, });
    }

    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const ip = req.ip;

  try {
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: 'Email, Otp and new password are required.' });
    }

    await checkMaintenanceAccess(ip);

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address.' });
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
    }

    const otpRecord = await OTPLog.findOne({
      email,
      otp,
      verified: true,
      expires_at: { $gt: new Date() },
    }).sort({ created_at: -1 });

    if (!otpRecord) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(400).json({ message: 'User not exists.' });
    }

    const hashedPassword = await hashPassword(newPassword);

    await User.findByIdAndUpdate(user._id, { password: hashedPassword });
    await otpRecord.updateOne({ verified: true });

    const settings = await getSettings();
    if (settings.is_demo_mode !== true) {
      EmailDispatcher.dispatch(user.email, 'password-reset-success', {
        user_name: user.name
      }).then(res => {
        if (!res.success) console.error('[Password Reset Success Email Error]', res.message);
      }).catch(err => console.error('Error sending password reset success email:', err));
    }

    return res.status(200).json({ message: 'Password reset successfully.' });
  } catch (error) {
    if (error.message === 'MAINTENANCE_MODE') {
      const settings = await getSettings();
      return res.status(503).json({ message: settings.maintenance_message || 'System under maintenance', maintenance: true });
    }
    console.error('Reset password error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  try {
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new passwords are required.' });
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }

    const hashedNewPassword = await hashPassword(newPassword);

    await User.findByIdAndUpdate(user._id, { password: hashedNewPassword });

    return res.status(200).json({ message: 'Password changed successfully.' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.teamMemberLogin = async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip;

  try {
    await checkMaintenanceAccess(ip);

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const member = await TeamMember.findOne({ email: email.toLowerCase().trim() });
    if (!member) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, member.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (member.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Your team member account is inactive.' });
    }

    const team = await Team.findById(member.team_id);
    if (!team || team.deleted_at || team.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Your team is inactive or has been deleted.' });
    }

    const token = generateToken({ id: member._id, isTeamMember: true });

    const settings = await getSettings();
    const expires_at = new Date(Date.now() + (settings?.session_expiration_days || 7) * 24 * 60 * 60 * 1000);

    await Session.create({
      user_id: member._id,
      session_token: token,
      device_info: req.headers['user-agent'],
      ip_address: req.ip,
      agenda: 'team_member_login',
      expires_at
    });

    let permissionSlugs = [];
    const teamPerms = await TeamPermission.find({ team_id: member.team_id }).populate('permission_id', 'slug').lean();
    permissionSlugs = teamPerms.filter(tp => tp.permission_id).map(tp => tp.permission_id.slug);

    const userProfile = {
      _id: member._id,
      id: member._id.toString(),
      name: `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'Team Member',
      email: member.email,
      phone_number: member.phone_number,
      avatar: member.avatar,
      status: member.status,
      team_id: member.team_id,
      isTeamMember: true,
      role: 'team_member',
      permissionSlugs
    };

    return res.status(200).json({ success: true, message: 'Login successful!', token, user: userProfile });
  } catch (error) {
    if (error.message === 'MAINTENANCE_MODE') {
      const settings = await getSettings();
      return res.status(503).json({ message: settings.maintenance_message || 'System under maintenance', maintenance: true });
    }
    console.error('Team member login error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getTeamMemberProfile = async (req, res) => {
  try {
    const team = await Team.findById(req.user.team_id);
    if (!team || team.deleted_at || team.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Team not found or inactive.' });
    }
    const member = await TeamMember.findOne({ _id: req.user._id, team_id: team._id })
      .populate('user_id', 'name email')
      .select('-password');
    if (!member) {
      return res.status(404).json({ success: false, message: 'Team member not found in this team.' });
    }

    if (member.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Your team member account is inactive.' });
    }

    let permissionSlugs = [];
    const teamPerms = await TeamPermission.find({ team_id: member.team_id }).populate('permission_id', 'slug').lean();
    permissionSlugs = teamPerms.filter(tp => tp.permission_id).map(tp => tp.permission_id.slug);

    const userProfile = {
      _id: member._id,
      id: member._id.toString(),
      name: `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'Team Member',
      email: member.email,
      phone_number: member.phone_number,
      avatar: member.avatar,
      status: member.status,
      user_id: {
        _id: member.user_id._id,
        name: member.user_id.name,
        email: member.user_id.email
      },
      teamDetails: {
        _id: team._id,
        name: team.name,
        description: team.description,
        status: team.status
      },
      isTeamMember: true,
      role: 'team_member',
      permissionSlugs
    };

    return res.status(200).json({
      success: true,
      message: 'Team Member Profile fetched successfully.',
      user: userProfile
    });
  } catch (error) {
    console.error('Get team member profile error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
