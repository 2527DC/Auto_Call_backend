'use strict';

const ADMIN_ROLES = ['super_admin', 'admin'];

// Admins manage plans, so they see every plan including private ones.
const isPlanAdmin = (user) => !!user?.roleId && ADMIN_ROLES.includes(user.roleId.name);

// Team members act for the account that owns them.
const accountIdOf = (user) => String(user.isTeamMember ? user.user_id : user._id);

// Mongo filter for the plans a user (or an anonymous visitor) may see.
const visiblePlansFilter = (user) => {
  if (isPlanAdmin(user)) return {};
  const visible = [{ visibility: { $ne: 'private' } }];
  if (user) visible.push({ visibility: 'private', allowed_user_ids: accountIdOf(user) });
  return { $or: visible };
};

const canUsePlan = (plan, user) =>
  plan.visibility !== 'private' ||
  isPlanAdmin(user) ||
  (!!user && (plan.allowed_user_ids || []).some((id) => String(id._id || id) === accountIdOf(user)));

module.exports = { isPlanAdmin, visiblePlansFilter, canUsePlan };
