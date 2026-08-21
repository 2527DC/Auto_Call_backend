'use strict';

const { db } = require('../models');
const User = db.User;
const PaymentHistory = db.PaymentHistory;
const Subscription = db.Subscription;
const Flow = db.Flow;
const Template = db.Template;
const Contact = db.Contact;
const Call = db.Call;
const Campaign = db.Campaign;
const Appointment = db.Appointment;
const FormResponse = db.FormResponse;
const KnowledgeBase = db.KnowledgeBase;
const Agent = db.Agent;
const SMSAgent = db.SMSAgent;
const Team = db.Team;
const SMSTemplate = db.SMSTemplate;
const SMSCampaign = db.SMSCampaign;
const TeamMember = db.TeamMember;
const creditService = require('../services/creditService');

const buildDateRange = (dateRange, startDate, endDate) => {
  if (!dateRange) {
    return null;
  }

  const now = new Date();
  let start;
  let end;

  switch (dateRange) {
    case 'today': {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      break;
    }
    case 'this_week': {
      const day = now.getDay();
      const diffToMonday = (day + 6) % 7;
      start = new Date(now);
      start.setDate(now.getDate() - diffToMonday);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case 'this_month': {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
    }
    case 'this_year': {
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      break;
    }
    case 'custom': {
      if (!startDate || !endDate) {
        return null;
      }

      start = new Date(startDate);
      end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return null;
      }

      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    }
    default:
      return null;
  }

  return { start, end };
};

exports.getAdminDashboardData = async (req, res) => {
  try {
    const userId = req.user._id;
    const { dateRange, startDate, endDate } = req.query;
    const range = buildDateRange(dateRange, startDate, endDate);

    const createdAtFilter = range
      ? { created_at: { $gte: range.start, $lte: range.end } }
      : {};

    const today = new Date();
    const dayOfWeek = today.getDay();
    const distanceToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - distanceToMonday);
    startOfWeek.setHours(0, 0, 0, 0);

    const newUsersFilter = range
      ? { created_at: { $gte: range.start, $lte: range.end } }
      : { created_at: { $gte: startOfWeek } };

    const newUsersThisWeek = await User.countDocuments(newUsersFilter);

    const revenueMatch = { payment_status: 'success', deleted_at: null };
    if (range) {
      revenueMatch.created_at = { $gte: range.start, $lte: range.end };
    }
    const revenueResult = await PaymentHistory.aggregate([
      { $match: revenueMatch },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalRevenue = revenueResult[0]?.total || 0;

    const activeSubscribers = await Subscription.countDocuments({
      status: { $in: ['active', 'trial'] },
      deleted_at: null,
      ...createdAtFilter
    });
    const totalFlowsOfCurrentUser = await Flow.countDocuments({
      user_id: userId,
      system_flow: { $ne: true },
      deleted_at: null,
      ...createdAtFilter
    });

    const totalTemplatesOfCurrentUser = await Template.countDocuments({ user_id: userId, ...createdAtFilter });

    const totalContactOfCurrentUser = await Contact.countDocuments({ user_id: userId, ...createdAtFilter });

    const totalAgentOfCurrentUser = await Agent.countDocuments({ user_id: userId, ...createdAtFilter });
    const totalSmsAgentOfCurrentUser = await SMSAgent.countDocuments({ user_id: userId, ...createdAtFilter });
    const totalTeamsAcrossAllUser = await Team.countDocuments({ ...createdAtFilter });
    const totalSmsTemplateOfCurrentUser = await SMSTemplate.countDocuments({ user_id: userId, ...createdAtFilter });
    const totalCallsOfCurrentUser = await Call.countDocuments({ user_id: userId, ...createdAtFilter });
    const totalCampaignsOfCurrentUser = await Campaign.countDocuments({ userId: userId, ...createdAtFilter });
    const totalSmsCampaignOfCurrentUser = await SMSCampaign.countDocuments({ user_id: userId, ...createdAtFilter });


    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
    twelveMonthsAgo.setDate(1);
    twelveMonthsAgo.setHours(0, 0, 0, 0);

    const revenueChartMatch = {
      payment_status: 'success',
      deleted_at: null
    };
    if (range) {
      revenueChartMatch.created_at = { $gte: range.start, $lte: range.end };
    } else {
      revenueChartMatch.created_at = { $gte: twelveMonthsAgo };
    }

    const monthlyRevenue = await PaymentHistory.aggregate([
      {
        $match: revenueChartMatch
      },
      {
        $group: {
          _id: {
            year: { $year: '$created_at' },
            month: { $month: '$created_at' }
          },
          revenue: { $sum: '$amount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthWiseRevenueChart = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const monthLabel = `${monthNames[month - 1]} ${year}`;

      const match = monthlyRevenue.find(r => r._id.year === year && r._id.month === month);
      monthWiseRevenueChart.push({
        month: monthLabel,
        revenue: match ? match.revenue : 0
      });
    }

    const callChartMatch = {};
    if (range) {
      callChartMatch.created_at = { $gte: range.start, $lte: range.end };
    } else {
      callChartMatch.created_at = { $gte: startOfWeek };
    }

    const calls = await Call.aggregate([
      {
        $match: callChartMatch
      },
      {
        $group: {
          _id: {
            dayOfWeek: { $dayOfWeek: '$created_at' },
            direction: '$direction'
          },
          count: { $sum: 1 }
        }
      }
    ]);

    const dayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const getDayIndex = (mongoDayOfWeek) => {
      return mongoDayOfWeek === 1 ? 6 : mongoDayOfWeek - 2;
    };

    const currentWeekCallChart = dayLabels.map(day => ({
      day,
      all: 0,
      incoming: 0,
      outgoing: 0
    }));

    calls.forEach(item => {
      const idx = getDayIndex(item._id.dayOfWeek);
      if (idx >= 0 && idx < 7) {
        const count = item.count;
        currentWeekCallChart[idx].all += count;
        if (item._id.direction === 'inbound') {
          currentWeekCallChart[idx].incoming += count;
        } else if (item._id.direction === 'outbound') {
          currentWeekCallChart[idx].outgoing += count;
        }
      }
    });

    const pieFilterAgent = range
      ? { user_id: userId, created_at: { $gte: range.start, $lte: range.end } }
      : { user_id: userId };

    const totalAgentPie = await Agent.countDocuments(pieFilterAgent);
    const totalSmsAgentPie = await SMSAgent.countDocuments(pieFilterAgent);
    const totalAgentPieCount = totalAgentPie + totalSmsAgentPie;

    const allTimeAgentPieChart = {
      all_agent: totalAgentPieCount > 0 ? 100 : 0,
      agent: totalAgentPieCount > 0 ? parseFloat(((totalAgentPie / totalAgentPieCount) * 100).toFixed(2)) : 0,
      sms_agent: totalAgentPieCount > 0 ? parseFloat(((totalSmsAgentPie / totalAgentPieCount) * 100).toFixed(2)) : 0
    };


    const recentRegisteredUsers = await User.find()
      .sort({ created_at: -1 })
      .limit(5)
      .populate('roleId', 'name')
      .select('name email avatar roleId created_at isActive')
      .lean();

    const recentCallsOfCurrentUser = await Call.find({ user_id: userId })
      .sort({ created_at: -1 })
      .limit(5)
      .populate('flow_id', 'name')
      .populate('campaign_id', 'name')
      .lean();

    const recentCampaigns = await Campaign.find({ userId: userId })
      .sort({ created_at: -1 })
      .limit(5)
      .populate('typeId', 'name')
      .populate('agentId', 'name')
      .populate('phoneNumberId', 'phone_number')
      .lean();

    const systemFlow = await Flow.find({ system_flow: true, deleted_at: null })
      .sort({ created_at: -1 })
      .limit(5)
      .lean();

    const recentSmsCampaignsOfCurrentUser = await SMSCampaign.find({ user_id: userId })
      .sort({ created_at: -1 })
      .limit(5)
      .populate('typeId', 'name')
      .populate('smsAgentId', 'name')
      .populate('phoneNumberId', 'phone_number')
      .lean();

    const recentContactOfCurrentUser = await Contact.find({ user_id: userId })
      .sort({ created_at: -1 })
      .limit(5)
      .lean();


    res.json({
      success: true,
      data: {
        statistics: {
          newUsersThisWeek,
          totalRevenue,
          activeSubscribers,
          totalFlowsOfCurrentUser,
          totalTemplatesOfCurrentUser,
          totalContactOfCurrentUser,
          totalAgentOfCurrentUser,
          totalSmsAgentOfCurrentUser,
          totalTeamsAcrossAllUser,
          totalSmsTemplateOfCurrentUser,
          totalCallsOfCurrentUser,
          totalCampaignsOfCurrentUser,
          totalSmsCampaignOfCurrentUser
        },
        charts: {
          monthWiseRevenueChart,
          currentWeekCallChart,
          allTimeAgentPieChart
        },
        tables: {
          recentRegisteredUsers,
          recentCallsOfCurrentUser,
          recentCampaigns,
          systemFlow,
          recentSmsCampaignsOfCurrentUser,
          recentContactOfCurrentUser
        }
      }
    });
  } catch (error) {
    console.error('Get Admin Dashboard Data Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
  }
};

exports.getUserDashboardData = async (req, res) => {
  try {
    const userId = req.user._id;
    const { dateRange, startDate, endDate } = req.query;
    const range = buildDateRange(dateRange, startDate, endDate);

    const createdAtFilter = range
      ? { created_at: { $gte: range.start, $lte: range.end } }
      : {};

    const totalAppointmentsBooked = await Appointment.countDocuments({ user_id: userId, ...createdAtFilter });

    const totalFormSubmissions = await FormResponse.countDocuments({ user_id: userId, ...createdAtFilter });

    const totalKnowledgebase = await KnowledgeBase.countDocuments({ user_id: userId, ...createdAtFilter });

    const totalTemplatesCreated = await Template.countDocuments({ user_id: userId, ...createdAtFilter });

    const totalContacts = await Contact.countDocuments({ user_id: userId, ...createdAtFilter });

    const totalFlowsCreated = await Flow.countDocuments({
      user_id: userId,
      system_flow: { $ne: true },
      deleted_at: null,
      ...createdAtFilter
    });

    const totalAiAgent = await Agent.countDocuments({ user_id: userId, ...createdAtFilter });

    const totalSmsAgents = await SMSAgent.countDocuments({ user_id: userId, ...createdAtFilter });

    const totalActiveCampaigns = await Campaign.countDocuments({ userId: userId, campaignStatus: 'Active', ...createdAtFilter });
    
    const totalActiveSmsCampaigns = await SMSCampaign.countDocuments({ user_id: userId, status: 'Active', ...createdAtFilter });

    const startOfDayDaily = new Date();
    startOfDayDaily.setHours(0, 0, 0, 0);
    const campaignsUsedToday = await Campaign.countDocuments({
      userId: userId,
      campaignStatus: { $in: ['Active', 'Completed', 'Failed', 'Paused', 'Cancelled'] },
      updated_at: { $gte: startOfDayDaily }
    });

    const totalCalls = await Call.countDocuments({ user_id: userId, ...createdAtFilter });

    const today = new Date();
    const dayOfWeek = today.getDay();
    const distanceToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - distanceToMonday);
    startOfWeek.setHours(0, 0, 0, 0);

    const calls = await Call.aggregate([
      {
        $match: {
          user_id: userId,
          ...(range
            ? { created_at: { $gte: range.start, $lte: range.end } }
            : { created_at: { $gte: startOfWeek } })
        }
      },
      {
        $group: {
          _id: {
            dayOfWeek: { $dayOfWeek: '$created_at' },
            direction: '$direction'
          },
          count: { $sum: 1 }
        }
      }
    ]);

    const dayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const getDayIndex = (mongoDayOfWeek) => {
      return mongoDayOfWeek === 1 ? 6 : mongoDayOfWeek - 2;
    };

    const currentWeekCallChart = dayLabels.map(day => ({
      day,
      all: 0,
      incoming: 0,
      outgoing: 0
    }));

    calls.forEach(item => {
      const idx = getDayIndex(item._id.dayOfWeek);
      if (idx >= 0 && idx < 7) {
        const count = item.count;
        currentWeekCallChart[idx].all += count;
        if (item._id.direction === 'inbound') {
          currentWeekCallChart[idx].incoming += count;
        } else if (item._id.direction === 'outbound') {
          currentWeekCallChart[idx].outgoing += count;
        }
      }
    });

    const campaignsAgg = await Campaign.aggregate([
      {
        $match: {
          userId: userId,
          ...(range
            ? { created_at: { $gte: range.start, $lte: range.end } }
            : { created_at: { $gte: startOfWeek } })
        }
      },
      {
        $group: {
          _id: { dayOfWeek: { $dayOfWeek: '$created_at' } },
          count: { $sum: 1 }
        }
      }
    ]);

    const currentWeekCampaignChart = dayLabels.map(day => ({ day, ai_campaigns: 0, sms_campaigns: 0 }));
    campaignsAgg.forEach(item => {
      const idx = getDayIndex(item._id.dayOfWeek);
      if (idx >= 0 && idx < 7) {
        currentWeekCampaignChart[idx].ai_campaigns += item.count;
      }
    });

    const smsCampaignsAgg = await SMSCampaign.aggregate([
      {
        $match: {
          user_id: userId,
          ...(range
            ? { created_at: { $gte: range.start, $lte: range.end } }
            : { created_at: { $gte: startOfWeek } })
        }
      },
      {
        $group: {
          _id: { dayOfWeek: { $dayOfWeek: '$created_at' } },
          count: { $sum: 1 }
        }
      }
    ]);

    smsCampaignsAgg.forEach(item => {
      const idx = getDayIndex(item._id.dayOfWeek);
      if (idx >= 0 && idx < 7) {
        currentWeekCampaignChart[idx].sms_campaigns += item.count;
      }
    });

    const pieFilter = range
      ? { user_id: userId, created_at: { $gte: range.start, $lte: range.end } }
      : { user_id: userId };

    const [incomingCalls, campaignCalls, outgoingCalls] = await Promise.all([
      Call.countDocuments({ ...pieFilter, direction: 'inbound' }),
      Call.countDocuments({ ...pieFilter, campaign_id: { $ne: null } }),
      Call.countDocuments({ ...pieFilter, direction: 'outbound', campaign_id: null })
    ]);

    const allTimeCallPieChart = {
      incoming: incomingCalls,
      outgoing: outgoingCalls,
      campaign: campaignCalls
    };

    const recentCampaigns = await Campaign.find({ userId: userId })
      .sort({ created_at: -1 })
      .limit(5)
      .populate('typeId', 'name')
      .populate('agentId', 'name')
      .populate('phoneNumberId', 'phone_number')
      .lean();

    const recentContacts = await Contact.find({ user_id: userId }).sort({ created_at: -1 }).limit(5).lean();

    const recentSmsCampaigns = await SMSCampaign.find({ user_id: userId })
      .sort({ created_at: -1 })
      .limit(5)
      .populate('typeId', 'name')
      .populate('smsAgentId', 'name')
      .populate('phoneNumberId', 'phone_number')
      .lean();

    const recentTeamMembers = await TeamMember.find({ user_id: userId })
      .sort({ created_at: -1 })
      .limit(5)
      .populate('team_id', 'name description')
      .lean();

    const recentActivitiesArray = [];

    const recentAiCampaignsForActivity = await Campaign.find({ userId: userId }).sort({ created_at: -1 }).limit(5).populate('userId', 'name').lean();
    recentAiCampaignsForActivity.forEach(c => {
      recentActivitiesArray.push({
        type: 'ai_campaign',
        title: `New AI campaign "${c.name}" created`,
        subtitle: `by ${c.userId?.name || req.user.name}`,
        timestamp: c.created_at
      });
    });

    const recentSmsCampsForActivity = await SMSCampaign.find({ user_id: userId }).sort({ created_at: -1 }).limit(5).populate('user_id', 'name').lean();
    recentSmsCampsForActivity.forEach(c => {
      recentActivitiesArray.push({
        type: 'sms_campaign',
        title: `SMS campaign "${c.name}" completed`,
        subtitle: `by ${c.user_id?.name || req.user.name}`,
        timestamp: c.created_at
      });
    });

    const recentContsForActivity = await Contact.find({ user_id: userId }).sort({ created_at: -1 }).limit(5).populate('user_id', 'name').lean();
    recentContsForActivity.forEach(c => {
      recentActivitiesArray.push({
        type: 'contact',
        title: `New contact ${c.phone_number} added`,
        subtitle: `by ${c.user_id?.name || req.user.name}`,
        timestamp: c.created_at
      });
    });

    const recentAgentsForActivity = await Agent.find({ user_id: userId }).sort({ created_at: -1 }).limit(5).populate('user_id', 'name').lean();
    recentAgentsForActivity.forEach(a => {
      recentActivitiesArray.push({
        type: 'agent',
        title: `AI agent "${a.name}" updated`,
        subtitle: `by ${a.user_id?.name || req.user.name}`,
        timestamp: a.updated_at || a.created_at
      });
    });

    const recentFlowsForActivity = await Flow.find({ user_id: userId, system_flow: { $ne: true } }).sort({ created_at: -1 }).limit(5).populate('user_id', 'name').lean();
    recentFlowsForActivity.forEach(f => {
      recentActivitiesArray.push({
        type: 'flow',
        title: `Flow "${f.name}" published`,
        subtitle: `by ${f.user_id?.name || req.user.name}`,
        timestamp: f.created_at
      });
    });

    recentActivitiesArray.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const recentActivity = recentActivitiesArray.slice(0, 5);

    const creditStats = await creditService.getCreditStatistics(userId);

    res.json({
      success: true,
      data: {
        statistics: {
          totalAppointmentsBooked,
          totalFormSubmissions,
          totalKnowledgebase,
          totalTemplatesCreated,
          totalContacts,
          totalFlowsCreated,
          totalAiAgent,
          totalSmsAgents,
          totalActiveCampaigns,
          totalActiveSmsCampaigns,
          campaignsUsedToday,
          totalCalls
        },
        charts: {
          currentWeekCallChart,
          allTimeCallPieChart,
          currentWeekCampaignChart
        },
        tables: {
          recentCampaigns,
          recentContacts,
          recentSmsCampaigns,
          recentTeamMembers,
          recentActivity
        },
        credits: creditStats
      }
    });
  } catch (error) {
    console.error('Get User Dashboard Data Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error', });
  }
};

exports.getTeamMemberDashboardData = async (req, res) => {
  try {
    const teamMemberId = req.user._id;
    const { dateRange, startDate, endDate, search } = req.query;
    const range = buildDateRange(dateRange, startDate, endDate);

    const createdAtFilter = range
      ? { created_at: { $gte: range.start, $lte: range.end } }
      : {};

    const callMatchFilter = {
      is_transferred: true,
      transfer_member_id: teamMemberId,
      ...createdAtFilter
    };

    if (search) {
      callMatchFilter.$or = [
        { from_number: { $regex: search, $options: 'i' } },
        { to_number: { $regex: search, $options: 'i' } }
      ];
    }

    const totalTransferredCalls = await Call.countDocuments(callMatchFilter);
    const successCalls = await Call.countDocuments({ ...callMatchFilter, 'transfer_details.human_call_status': { $in: ['answered', 'completed'] } });
    const failedCalls = await Call.countDocuments({ ...callMatchFilter, 'transfer_details.human_call_status': { $nin: ['answered', 'completed'] } });

    const durationResult = await Call.aggregate([
      { $match: callMatchFilter },
      { $group: { _id: null, totalDuration: { $sum: '$transfer_details.human_duration' } } }
    ]);
    const totalDuration = durationResult[0]?.totalDuration || 0;

    const recentTransferredCalls = await Call.find(callMatchFilter)
      .sort({ created_at: -1 })
      .limit(10)
      .populate('agent_id', 'name type')
      .populate('campaign_id', 'name')
      .lean();

    const successRate = totalTransferredCalls > 0 ? parseFloat(((successCalls / totalTransferredCalls) * 100).toFixed(2)) : 0;
    const failedRate = totalTransferredCalls > 0 ? parseFloat(((failedCalls / totalTransferredCalls) * 100).toFixed(2)) : 0;

    res.json({
      success: true,
      data: {
        statistics: {
          totalTransferredCalls,
          successCalls,
          failedCalls,
          successRate,
          failedRate,
          totalDuration
        },
        tables: {
          recentTransferredCalls
        }
      }
    });
  } catch (error) {
    console.error('Get Team Member Dashboard Data Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
  }
};