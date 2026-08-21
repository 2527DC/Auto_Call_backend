const bcrypt = require('bcryptjs');
const { db } = require('../models');
const User = db.User;
const Setting = db.Setting;

const hashPassword = async (password) => {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
};

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const isValidPassword = (password) => {
  return password && typeof password === 'string' && password.length >= 6;
};

const findUserByEmail = async (email) => {
  if (!email || typeof email !== 'string') {
    return null;
  }
  return await User.findOne({ email: email.toLowerCase().trim() }).populate('roleId');
};

const updateLastLogin = async (userId) => {
  if (!userId) {
    return null;
  }
  return await User.findByIdAndUpdate(userId, { lastLogin: new Date() });
};

const isValidName = (name) => {
  return name && typeof name === 'string' && name.trim().length > 0;
};

async function generateOTP() {
  const settings = await getSettings();
  const otp = settings.is_demo_mode ? 123456 : Math.floor(100000 + Math.random() * 900000).toString();
  return otp;
};

async function getSettings() {
  const settings = await Setting.findOne();
  if (!settings) throw new Error('Settings not defined');
  return settings;
};

async function checkMaintenanceAccess(ip, userRole = null) {
  const settings = await getSettings();
  if (settings.maintenance_mode) {
    if (userRole === 'super_admin' || settings.maintenance_allowed_ips?.includes(ip)) {
      return settings;
    }
    throw new Error('MAINTENANCE_MODE');
  }
  return settings;
};

const formatUser = (user) => {
  if (!user) return null;
  const total_credits = user.total_credits || 0;
  const used_credits = user.used_credits || 0;
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.roleId ? (user.roleId.name || user.roleId.toString()) : 'user',
    role_id: user.roleId ? (user.roleId._id || user.roleId) : null,
    permissions: user.permissionSlugs || [],
    avatar: user.avatar,
    isActive: user.isActive,
    isVerified: user.isVerified,
    isOnline: user.isOnline,
    lastLogin: user.lastLogin,
    total_credits,
    used_credits,
    remaining_credits: Math.max(0, total_credits - used_credits),
    created_at: user.created_at,
    updated_at: user.updated_at
  };
};

module.exports = {
  hashPassword,
  isValidEmail,
  isValidPassword,
  findUserByEmail,
  updateLastLogin,
  isValidName,
  generateOTP,
  getSettings,
  checkMaintenanceAccess,
  formatUser
};