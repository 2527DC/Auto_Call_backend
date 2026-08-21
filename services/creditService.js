const { db } = require('../models');
const User = db.User;
const CreditUsage = db.CreditUsage;
const Call = db.Call;
const Setting = db.Setting;

class CreditService {
  async getCreditBalance(userId) {
    const user = await User.findById(userId).populate('roleId');
    if (!user) {
      throw new Error('User not found');
    }

    const isAdmin = user.roleId && (user.roleId.name === 'super_admin' || user.roleId.name === 'admin');

    return {
      total_credits: user.total_credits || 0,
      used_credits: user.used_credits || 0,
      available_credits: (user.total_credits || 0) - (user.used_credits || 0),
      is_admin: isAdmin
    };
  }

  async addCredits(userId, credits, transactionType, description = '', referenceId = null, referenceType = null) {

    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    user.total_credits = (user.total_credits || 0) + credits;
    await user.save();

    await CreditUsage.create({
      user_id: userId,
      transaction_type: transactionType,
      credits: credits,
      balance_after: user.total_credits,
      description: description,
      reference_id: referenceId,
      reference_type: referenceType
    });

    return {
      total_credits: user.total_credits,
      used_credits: user.used_credits || 0,
      available_credits: user.total_credits - (user.used_credits || 0)
    };
  }

  async deductCredits(userId, credits, transactionType, description = '', referenceId = null, referenceType = null) {
    const user = await User.findById(userId).populate('roleId');
    if (!user) {
      throw new Error('User not found');
    }

    if (user.roleId && (user.roleId.name === 'super_admin' || user.roleId.name === 'admin')) {
      return {
        total_credits: user.total_credits || 0,
        used_credits: user.used_credits || 0,
        available_credits: (user.total_credits || 0) - (user.used_credits || 0),
        credits_deducted: 0,
        top_up_credits_used: 0,
        regular_credits_used: 0,
        remaining_top_up_credits: user.top_up_credits || 0,
        is_admin: true
      };
    }

    const availableCredits = (user.total_credits || 0) - (user.used_credits || 0);
    if (availableCredits < credits) {
      throw new Error(`Insufficient credits. Available: ${availableCredits}, Required: ${credits}`);
    }

    const now = new Date();
    const hasValidTopUp = user.top_up_credits > 0 && user.top_up_expires_at && user.top_up_expires_at > now;

    let topUpDeducted = 0;
    let regularDeducted = credits;

    if (hasValidTopUp) {
      topUpDeducted = Math.min(user.top_up_credits, credits);
      regularDeducted = credits - topUpDeducted;

      user.top_up_credits -= topUpDeducted;
      if (user.top_up_credits === 0) {
        user.top_up_expires_at = null;
      }
    }

    user.used_credits = (user.used_credits || 0) + credits;
    await user.save();

    const balanceAfter = user.total_credits - user.used_credits;

    let finalDescription = description;
    if (topUpDeducted > 0) {
      finalDescription += ` (Top-up: ${topUpDeducted}, Regular: ${regularDeducted})`;
    }

    await CreditUsage.create({
      user_id: userId,
      transaction_type: transactionType,
      credits: -credits,
      balance_after: balanceAfter,
      description: finalDescription,
      reference_id: referenceId,
      reference_type: referenceType
    });

    return {
      total_credits: user.total_credits,
      used_credits: user.used_credits,
      available_credits: balanceAfter,
      credits_deducted: credits,
      top_up_credits_used: topUpDeducted,
      regular_credits_used: regularDeducted,
      remaining_top_up_credits: user.top_up_credits
    };
  }

  async calculateCallCredits(userId, callDurationSeconds) {
    const settings = await Setting.findOne();
    if (!settings) {
      throw new Error('System settings not found');
    }

    let creditsToDeduct = 0;

    if (settings.credit_deduction_type === 'per_minute') {
      const minutes = Math.ceil(callDurationSeconds / 60);
      creditsToDeduct = minutes * (settings.credits_per_minute || 1);
    } else {
      creditsToDeduct = settings.credits_per_call || 1;
    }

    return creditsToDeduct;
  }

  async processCallCreditDeduction(userId, callId, callDurationSeconds) {
    const creditsToDeduct = await this.calculateCallCredits(userId, callDurationSeconds);

    const result = await this.deductCredits(
      userId,
      creditsToDeduct,
      'call_deduction',
      `Call duration: ${callDurationSeconds}s (${Math.ceil(callDurationSeconds / 60)} min)`,
      callId,
      'call'
    );

    await Call.findByIdAndUpdate(callId, { credits_used: result.credits_deducted });

    return {
      ...result,
      call_id: callId,
      call_duration: callDurationSeconds,
      credits_deducted: result.credits_deducted
    };
  }

  async getCreditUsageHistory(userId, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [usages, total] = await Promise.all([
      CreditUsage.find({ user_id: userId }).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
      CreditUsage.countDocuments({ user_id: userId })
    ]);

    return {
      data: usages,
      pagination: {
        current_page: page,
        total_pages: Math.ceil(total / limit),
        total_records: total,
        per_page: limit
      }
    };
  }

  async getCreditStatistics(userId) {


    const balance = await this.getCreditBalance(userId);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [monthlyUsage, totalCalls] = await Promise.all([
      CreditUsage.aggregate([
        {
          $match: {
            user_id: userId,
            transaction_type: 'call_deduction',
            created_at: { $gte: startOfMonth }
          }
        },
        { $group: { _id: null, total_credits_used: { $sum: { $abs: '$credits' } } } }
      ]),
      Call.countDocuments({ user_id: userId, status: 'completed', created_at: { $gte: startOfMonth } })
    ]);

    return {
      ...balance,
      monthly_credits_used: monthlyUsage[0]?.total_credits_used || 0,
      total_completed_calls_this_month: totalCalls
    };
  }
}

module.exports = new CreditService();