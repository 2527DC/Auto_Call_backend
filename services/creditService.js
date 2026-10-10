const { db } = require('../models');
const User = db.User;
const CreditUsage = db.CreditUsage;
const Call = db.Call;
const Setting = db.Setting;
const Agent = db.Agent;

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

  // `allowNegative` is for usage that already happened (a finished call, a sent
  // message): it is always charged, even past zero, so the platform never pays
  // for it. New usage is blocked earlier with hasCredits().
  async deductCredits(userId, credits, transactionType, description = '', referenceId = null, referenceType = null, { allowNegative = false } = {}) {
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

    const now = new Date();
    const hasValidTopUp = user.top_up_credits > 0 && user.top_up_expires_at && user.top_up_expires_at > now;
    const topUpDeducted = hasValidTopUp ? Math.min(user.top_up_credits, credits) : 0;
    const regularDeducted = credits - topUpDeducted;

    // One atomic update, so two charges at the same moment can't overwrite each other.
    const filter = { _id: userId };
    if (!allowNegative) {
      filter.$expr = { $gte: [{ $subtract: [{ $ifNull: ['$total_credits', 0] }, { $ifNull: ['$used_credits', 0] }] }, credits] };
    }
    const inc = { used_credits: credits };
    if (topUpDeducted > 0) inc.top_up_credits = -topUpDeducted;
    const updated = await User.findOneAndUpdate(filter, { $inc: inc }, { new: true });
    if (!updated) {
      const available = (user.total_credits || 0) - (user.used_credits || 0);
      throw new Error(`Insufficient credits. Available: ${available}, Required: ${credits}`);
    }
    if (topUpDeducted > 0 && updated.top_up_credits <= 0) {
      await User.updateOne({ _id: userId }, { $set: { top_up_expires_at: null } });
    }

    const balanceAfter = (updated.total_credits || 0) - (updated.used_credits || 0);

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
      total_credits: updated.total_credits,
      used_credits: updated.used_credits,
      available_credits: balanceAfter,
      credits_deducted: credits,
      top_up_credits_used: topUpDeducted,
      regular_credits_used: regularDeducted,
      remaining_top_up_credits: updated.top_up_credits
    };
  }

  // Credits a message costs, from settings (e.g. credits_per_sms); 0 means free.
  async getMessageCredits(settingKey) {
    const settings = await Setting.findOne();
    return Number(settings?.[settingKey]) || 0;
  }

  // Charges a message that has already been sent, at its rate from settings.
  async chargeMessage(userId, settingKey, transactionType, description, referenceId = null, referenceType = null) {
    const credits = await this.getMessageCredits(settingKey);
    if (credits <= 0) return null;
    const ref = referenceId && db.mongoose.Types.ObjectId.isValid(String(referenceId)) ? referenceId : null;
    return this.deductCredits(userId, credits, transactionType, description, ref, ref ? referenceType : null, { allowNegative: true });
  }

  // Admins always pass; everyone else needs a balance above zero to start new usage.
  async hasCredits(userId) {
    if (!userId) return false;
    const balance = await this.getCreditBalance(userId).catch(() => null);
    return !!balance && (balance.is_admin || balance.available_credits > 0);
  }

  async calculateCallCredits(userId, callDurationSeconds, voiceProvider = null) {
    const settings = await Setting.findOne();
    if (!settings) {
      throw new Error('System settings not found');
    }

    return this.creditsForCall(settings, callDurationSeconds, voiceProvider);
  }

  // Credits a call of this length uses under the given settings.
  creditsForCall(settings, callDurationSeconds, voiceProvider = null) {
    let creditsToDeduct = 0;

    if (settings.credit_deduction_type === 'per_minute') {
      const minutes = Math.ceil(callDurationSeconds / 60);
      creditsToDeduct = minutes * (settings.credits_per_minute || 1);
    } else {
      creditsToDeduct = settings.credits_per_call || 1;
    }

    // Costlier voices (ElevenLabs by default) use more credits per minute.
    const multiplier = voiceProvider ? settings[`credit_multiplier_${voiceProvider}`] : null;
    if (typeof multiplier === 'number' && multiplier > 0) {
      creditsToDeduct = Math.ceil(creditsToDeduct * multiplier);
    }

    return creditsToDeduct;
  }

  // Charges a finished call exactly once. The stream close and the provider's
  // status callback both call this; whichever comes second finds the call
  // already charged and returns what was charged before.
  async processCallCreditDeduction(userId, callId, callDurationSeconds) {
    const call = await Call.findOneAndUpdate(
      { _id: callId, credits_charged: { $ne: true } },
      { $set: { credits_charged: true } },
      { new: true }
    );
    if (!call) {
      const charged = await Call.findById(callId).select('credits_used').lean();
      return { call_id: callId, call_duration: callDurationSeconds, credits_deducted: charged?.credits_used || 0, already_charged: true };
    }

    try {
      const agent = call.agent_id ? await Agent.findById(call.agent_id).select('voice_provider').lean() : null;
      const creditsToDeduct = await this.calculateCallCredits(userId, callDurationSeconds, agent?.voice_provider);

      const result = await this.deductCredits(
        userId,
        creditsToDeduct,
        'call_deduction',
        `Call duration: ${callDurationSeconds}s (${Math.ceil(callDurationSeconds / 60)} min)`,
        callId,
        'call',
        { allowNegative: true }
      );

      await Call.findByIdAndUpdate(callId, { credits_used: result.credits_deducted });

      return {
        ...result,
        call_id: callId,
        call_duration: callDurationSeconds,
        credits_deducted: result.credits_deducted
      };
    } catch (err) {
      // Not charged after all, so let a later attempt charge it.
      await Call.updateOne({ _id: callId }, { $set: { credits_charged: false } });
      throw err;
    }
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