'use strict';

const { db } = require('../models');
const User = db.User;
const Setting = db.Setting;
const Plan = db.Plan;

const getUserLimits = async (userId) => {
  const user = await User.findById(userId).populate('plan_id').lean();
  const settings = await Setting.findOne().lean();

  if (user && user.plan_id && user.plan_id.status === 'active') {
    return {
      agent_limit: user.plan_id.agent_limit,
      campaign_limit_per_day: user.plan_id.campaign_limit_per_day,
      flow_limit: user.plan_id.flow_limit,
      knowledgebase_limit: user.plan_id.knowledgebase_limit,
      storage_limit: user.plan_id.storage_limit,
      contact_limit: user.plan_id.contact_limit,
      sms_agent_limit: user.plan_id.sms_agent_limit,
      sms_campaign_limit_per_day: user.plan_id.sms_campaign_limit_per_day,
      campaign_sms_limit: user.plan_id.campaign_sms_limit,
    };
  } else {
    return {
      agent_limit: settings?.default_agent_limit || 2,
      campaign_limit_per_day: settings?.default_campaign_limit_per_day || 1,
      flow_limit: settings?.default_flow_limit || 2,
      knowledgebase_limit: settings?.default_knowledgebase_limit || 5,
      storage_limit: settings?.default_storage_limit || 20,
      contact_limit: settings?.default_contact_limit || 100,
      sms_agent_limit: settings?.default_sms_agent_limit || 2,
      sms_campaign_limit_per_day: settings?.default_sms_campaign_limit_per_day || 1,
      campaign_sms_limit: settings?.default_campaign_sms_limit || 100,
    };
  }
};

const checkFeatureLimit = async (userId, featureName, limitKey, currentUsage, incrementAmount = 1) => {
  const user = await User.findById(userId).populate('roleId').lean();
  if (user && user.roleId.name === 'super_admin') {
    return true;
  }

  const limits = await getUserLimits(userId);
  const limit = limits[limitKey];

  if (limit === -1 || limit === null || limit === undefined) {
    return true;
  }

  if (currentUsage + incrementAmount > limit) {
    throw new Error(`You have reached your ${featureName} creation limit. Please upgrade your plan.`);
  }

  return true;
};

module.exports = {
  getUserLimits,
  checkFeatureLimit
};