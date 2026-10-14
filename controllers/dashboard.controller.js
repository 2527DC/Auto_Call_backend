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

const Plan = db.Plan;
const { buildPeriod, bucketKey, listBuckets } = require('../utils/dashboardPeriod');

// Counter filters use the same Indian-time periods as the charts.
const buildDateRange = (dateRange, startDate, endDate) => {
  const period = buildPeriod(dateRange, startDate, endDate);
  return period && { start: period.start, end: period.end };
};

const round2 = (n) => Math.round((n || 0) * 100) / 100;
const between = (from, to) => ({ $gte: from, $lte: to });
const countIf = (expr) => ({ $sum: { $cond: [expr, 1, 0] } });
const byKey = (rows) => new Map(rows.map((row) => [row._id, row]));

// Call counts per chart bucket (or one total row when bucket is null).
const callGroup = (bucket) => ({
  $group: {
    _id: bucket ? bucketKey('$created_at', bucket) : null,
    calls: { $sum: 1 },
    inbound: countIf({ $eq: ['$direction', 'inbound'] }),
    outbound: countIf({ $eq: ['$direction', 'outbound'] }),
    completed: countIf({ $eq: ['$status', 'completed'] }),
    seconds: { $sum: { $ifNull: ['$duration', 0] } }
  }
});

const callTotals = (row) => ({
  calls: row?.calls || 0,
  minutes: round2((row?.seconds || 0) / 60),
  answered: row?.completed || 0
});

// Platform-wide revenue, sign-ups and calls for the admin charts. A date filter is always
// applied here, "this year" when none was chosen.
const getAdminTrends = async (query) => {
  const period = buildPeriod(query.dateRange, query.startDate, query.endDate) || buildPeriod('this_year');
  const current = between(period.start, new Date(Math.min(period.end.getTime(), Date.now())));
  const prev = between(period.prevStart, period.prevEnd);
  const paid = { payment_status: 'success', deleted_at: null };
  const paymentGroup = (bucket) => ({
    $group: {
      _id: bucket ? bucketKey('$created_at', bucket) : null,
      revenue: { $sum: '$amount' },
      payments: { $sum: 1 }
    }
  });

  const [payments, signups, calls, prevPayments, prevSignups, prevCalls, planRevenue, activeSubscriptions] = await Promise.all([
    PaymentHistory.aggregate([{ $match: { ...paid, created_at: current } }, paymentGroup(period.bucket)]),
    User.aggregate([
      { $match: { created_at: current } },
      { $group: { _id: bucketKey('$created_at', period.bucket), users: { $sum: 1 } } }
    ]),
    Call.aggregate([{ $match: { created_at: current } }, callGroup(period.bucket)]),
    PaymentHistory.aggregate([{ $match: { ...paid, created_at: prev } }, paymentGroup(null)]),
    User.countDocuments({ created_at: prev }),
    Call.aggregate([{ $match: { created_at: prev } }, callGroup(null)]),
    PaymentHistory.aggregate([
      { $match: { ...paid, created_at: current } },
      { $group: { _id: '$plan_id', revenue: { $sum: '$amount' }, payments: { $sum: 1 } } },
      { $sort: { revenue: -1 } }
    ]),
    Subscription.find({ status: 'active', deleted_at: null })
      .select('plan_id')
      .populate('plan_id', 'amount billing_cycle plan_type')
      .lean()
  ]);

  const paymentRows = byKey(payments);
  const signupRows = byKey(signups);
  const callRows = byKey(calls);
  const trend = listBuckets(period).map(({ key, label }) => {
    const pay = paymentRows.get(key);
    const call = callRows.get(key);
    return {
      label,
      revenue: round2(pay?.revenue),
      payments: pay?.payments || 0,
      signups: signupRows.get(key)?.users || 0,
      inbound: call?.inbound || 0,
      outbound: call?.outbound || 0,
      answered: call?.completed || 0,
      minutes: round2((call?.seconds || 0) / 60)
    };
  });

  const plans = await Plan.find({ _id: { $in: planRevenue.map((row) => row._id).filter(Boolean) } })
    .select('name')
    .lean();
  const planNames = new Map(plans.map((plan) => [String(plan._id), plan.name]));
  const revenueByPlan = planRevenue
    .filter((row) => row.revenue > 0)
    .map((row) => ({
      name: planNames.get(String(row._id)) || 'Other',
      revenue: round2(row.revenue),
      payments: row.payments
    }));

  // Monthly recurring revenue: active subscriptions on repeating plans, yearly plans spread over 12 months.
  let mrr = 0;
  let recurringSubscribers = 0;
  for (const sub of activeSubscriptions) {
    const plan = sub.plan_id;
    if (!plan || plan.plan_type === 'top_up' || !(plan.amount > 0)) continue;
    if (plan.billing_cycle === 'monthly') mrr += plan.amount;
    else if (plan.billing_cycle === 'yearly') mrr += plan.amount / 12;
    else continue;
    recurringSubscribers += 1;
  }

  const sum = (key) => trend.reduce((total, row) => total + row[key], 0);
  const currentCalls = sum('inbound') + sum('outbound');
  return {
    bucket: period.bucket,
    compareLabel: period.compareLabel,
    trend,
    revenueByPlan,
    summary: {
      revenue: { current: round2(sum('revenue')), previous: round2(prevPayments[0]?.revenue) },
      payments: { current: sum('payments'), previous: prevPayments[0]?.payments || 0 },
      signups: { current: sum('signups'), previous: prevSignups },
      calls: { current: currentCalls, previous: prevCalls[0]?.calls || 0 },
      minutes: { current: round2(sum('minutes')), previous: callTotals(prevCalls[0]).minutes },
      answered: { current: sum('answered'), previous: callTotals(prevCalls[0]).answered },
      mrr: round2(mrr),
      recurringSubscribers
    }
  };
};

// One client's calls and campaigns for the user dashboard charts.
// What the period's calls led to: a funnel (calls -> reached -> good -> goal
// achieved), the commonest outcomes, and follow-ups due today or overdue.
const getUserOutcomes = async (userId, query) => {
  const period = buildPeriod(query.dateRange, query.startDate, query.endDate) || buildPeriod('this_year');
  const current = between(period.start, new Date(Math.min(period.end.getTime(), Date.now())));
  const istNow = new Date(Date.now() + 330 * 60000);
  const todayStart = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - 330 * 60000);
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const open = { $in: ['pending', 'in_progress'] };
  const [funnel, byOutcome, dueToday, overdue] = await Promise.all([
    Call.aggregate([
      { $match: { user_id: userId, created_at: current } },
      { $group: {
        _id: null,
        calls: { $sum: 1 },
        analysed: { $sum: { $cond: [{ $ifNull: ['$outcome.key', false] }, 1, 0] } },
        reached: { $sum: { $cond: [{ $eq: ['$outcome.reached', true] }, 1, 0] } },
        good: { $sum: { $cond: [{ $and: [{ $eq: ['$outcome.reached', true] }, { $eq: ['$outcome.result', 'good'] }] }, 1, 0] } },
        goal: { $sum: { $cond: [{ $eq: ['$outcome.key', 'goal_achieved'] }, 1, 0] } }
      } }
    ]),
    Call.aggregate([
      { $match: { user_id: userId, created_at: current, 'outcome.key': { $ne: null } } },
      { $group: { _id: '$outcome.key', label: { $last: '$outcome.label' }, result: { $last: '$outcome.result' }, reached: { $last: '$outcome.reached' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 }
    ]),
    db.FollowUp.countDocuments({ user_id: userId, status: open, due_at: { $gte: todayStart, $lt: todayEnd } }),
    db.FollowUp.countDocuments({ user_id: userId, status: open, due_at: { $lt: todayStart } })
  ]);
  const f = funnel[0] || { calls: 0, analysed: 0, reached: 0, good: 0, goal: 0 };
  return {
    funnel: { calls: f.calls, analysed: f.analysed, reached: f.reached, good: f.good, goal_achieved: f.goal },
    top: byOutcome.map(o => ({ key: o._id, label: o.label, result: o.result, reached: o.reached !== false, count: o.count })),
    follow_ups: { due_today: dueToday, overdue }
  };
};

const getUserTrends = async (userId, query) => {
  const period = buildPeriod(query.dateRange, query.startDate, query.endDate) || buildPeriod('this_year');
  const current = between(period.start, new Date(Math.min(period.end.getTime(), Date.now())));
  const prev = between(period.prevStart, period.prevEnd);
  const campaignGroup = { $group: { _id: bucketKey('$created_at', period.bucket), count: { $sum: 1 } } };

  const [calls, prevCalls, campaigns, smsCampaigns, appointments, prevAppointments] = await Promise.all([
    Call.aggregate([{ $match: { user_id: userId, created_at: current } }, callGroup(period.bucket)]),
    Call.aggregate([{ $match: { user_id: userId, created_at: prev } }, callGroup(null)]),
    Campaign.aggregate([{ $match: { userId: userId, created_at: current } }, campaignGroup]),
    SMSCampaign.aggregate([{ $match: { user_id: userId, created_at: current } }, campaignGroup]),
    Appointment.countDocuments({ user_id: userId, created_at: current }),
    Appointment.countDocuments({ user_id: userId, created_at: prev })
  ]);

  const callRows = byKey(calls);
  const campaignRows = byKey(campaigns);
  const smsRows = byKey(smsCampaigns);
  const trend = listBuckets(period).map(({ key, label }) => {
    const call = callRows.get(key);
    return {
      label,
      inbound: call?.inbound || 0,
      outbound: call?.outbound || 0,
      answered: call?.completed || 0,
      minutes: round2((call?.seconds || 0) / 60),
      aiCampaigns: campaignRows.get(key)?.count || 0,
      smsCampaigns: smsRows.get(key)?.count || 0
    };
  });

  const sum = (key) => trend.reduce((total, row) => total + row[key], 0);
  const previous = callTotals(prevCalls[0]);
  return {
    bucket: period.bucket,
    compareLabel: period.compareLabel,
    trend,
    summary: {
      calls: { current: sum('inbound') + sum('outbound'), previous: previous.calls },
      minutes: { current: round2(sum('minutes')), previous: previous.minutes },
      answered: { current: sum('answered'), previous: previous.answered },
      appointments: { current: appointments, previous: prevAppointments }
    }
  };
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

    const trends = await getAdminTrends(req.query);


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
        },
        trends
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
    const trends = await getUserTrends(userId, req.query);
    const outcomes = await getUserOutcomes(userId, req.query);

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
        credits: creditStats,
        trends,
        outcomes
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