const { db } = require('../models');
const Plan = db.Plan;
const { StripeService, RazorpayService, PayPalService } = require('../utils/payment-gateway.service');

const _syncPlanInternal = async (plan, force = false) => {
  if (plan.amount <= 0) {
    console.log(`[SyncPlans] Skipping gateway sync for free plan: ${plan.slug}`);
    return false;
  }

  let updated = false;

  if (force || !plan.stripe_product_id || !plan.stripe_payment_link_url) {
    try {
      let stripeData;
      if (force || !plan.stripe_product_id) {
        stripeData = await StripeService.createProductPriceAndPaymentLink(plan);
      } else if (!plan.stripe_payment_link_url) {
        stripeData = await StripeService.createPriceAndPaymentLinkForExistingProduct(plan);
      }

      if (stripeData) {
        if (stripeData.productId) plan.stripe_product_id = stripeData.productId;
        if (stripeData.priceId) plan.stripe_price_id = stripeData.priceId;
        if (stripeData.paymentLinkId) plan.stripe_payment_link_id = stripeData.paymentLinkId;
        if (stripeData.paymentLinkUrl) plan.stripe_payment_link_url = stripeData.paymentLinkUrl;
        updated = true;
      }
    } catch (err) {
      console.warn(`Stripe sync error for plan ${plan.slug}:`, err.message);
    }
  }

  if (force || !plan.razorpay_plan_id) {
    try {
      const razorpayData = await RazorpayService.createPlan(plan);
      if (razorpayData) {
        plan.razorpay_plan_id = razorpayData.razorpayPlanId;
        updated = true;
      }
    } catch (err) {
      console.warn(`Razorpay sync error for plan ${plan.slug}:`, err.message);
    }
  }

  if (force || !plan.paypal_plan_id) {
    try {
      const productData = await PayPalService.createProduct(plan);
      if (productData) {
        const paypalPlanData = await PayPalService.createPlan(productData.paypalProductId, plan);
        if (paypalPlanData) {
          plan.paypal_plan_id = paypalPlanData.paypalPlanId;
          updated = true;
        }
      }
    } catch (err) {
      console.warn(`PayPal sync error for plan ${plan.slug}:`, err.message);
    }
  }

  if (updated) {
    await plan.save();
  }
  return updated;
};

exports.createPlan = async (req, res) => {
  try {
    const {
      name, slug, description, plan_type, billing_cycle, validity_days,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, stripe_payment_link_url,
      paypal_plan_id, paypal_plan_id_monthly, paypal_plan_id_yearly, razorpay_plan_id,
      total_credits, is_popular, status, amount, currency, ai_features,
      agent_limit, campaign_limit_per_day, flow_limit, knowledgebase_limit, storage_limit, contact_limit,
      sms_agent_limit, sms_campaign_limit_per_day, campaign_sms_limit
    } = req.body;

    if (!name || !slug || !amount) {
      return res.status(400).json({ message: 'Name, slug and amount are required.' });
    }

    const plan = new Plan({
      name,
      slug,
      description,
      plan_type,
      billing_cycle,
      validity_days,
      stripe_product_id,
      stripe_price_id,
      stripe_payment_link_id,
      stripe_payment_link_url,
      paypal_plan_id,
      paypal_plan_id_monthly,
      paypal_plan_id_yearly,
      razorpay_plan_id,
      total_credits,
      is_popular,
      status,
      amount,
      currency,
      ai_features,
      agent_limit,
      campaign_limit_per_day,
      flow_limit,
      knowledgebase_limit,
      storage_limit,
      contact_limit,
      sms_agent_limit,
      sms_campaign_limit_per_day,
      campaign_sms_limit
    });

    await plan.save();

    await _syncPlanInternal(plan);

    res.status(201).json({
      message: 'Plan created successfully.',
      plan
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Plan with this slug already exists.' });
    }
    console.error('Create Plan error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getPlans = async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status) query.status = status;

    const plans = await Plan.find(query).sort({ created_at: -1 });
    res.status(200).json(plans);
  } catch (error) {
    console.error('Get Plans error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getPlanById = async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found.' });
    }
    res.status(200).json(plan);
  } catch (error) {
    console.error('Get Plan error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updatePlan = async (req, res) => {
  try {
    const {
      name, slug, description, plan_type, billing_cycle, validity_days,
      stripe_product_id, stripe_price_id, stripe_payment_link_id, stripe_payment_link_url,
      paypal_plan_id, paypal_plan_id_monthly, paypal_plan_id_yearly, razorpay_plan_id,
      total_credits, is_popular, status, amount, currency, ai_features,
      agent_limit, campaign_limit_per_day, flow_limit, knowledgebase_limit, storage_limit, contact_limit,
      sms_agent_limit, sms_campaign_limit_per_day, campaign_sms_limit
    } = req.body;

    const plan = await Plan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found.' });
    }

    if (name) plan.name = name;
    if (slug) plan.slug = slug;
    if (description !== undefined) plan.description = description;
    if (plan_type) plan.plan_type = plan_type;
    if (billing_cycle) plan.billing_cycle = billing_cycle;
    if (validity_days !== undefined) plan.validity_days = validity_days;
    if (stripe_product_id !== undefined) plan.stripe_product_id = stripe_product_id;
    if (stripe_price_id !== undefined) plan.stripe_price_id = stripe_price_id;
    if (stripe_payment_link_id !== undefined) plan.stripe_payment_link_id = stripe_payment_link_id;
    if (stripe_payment_link_url !== undefined) plan.stripe_payment_link_url = stripe_payment_link_url;
    if (paypal_plan_id !== undefined) plan.paypal_plan_id = paypal_plan_id;
    if (paypal_plan_id_monthly !== undefined) plan.paypal_plan_id_monthly = paypal_plan_id_monthly;
    if (paypal_plan_id_yearly !== undefined) plan.paypal_plan_id_yearly = paypal_plan_id_yearly;
    if (razorpay_plan_id !== undefined) plan.razorpay_plan_id = razorpay_plan_id;
    if (total_credits !== undefined) plan.total_credits = total_credits;
    if (is_popular !== undefined) plan.is_popular = is_popular;
    if (status) plan.status = status;
    if (amount !== undefined) plan.amount = amount;
    if (currency) plan.currency = currency;
    if (ai_features) plan.ai_features = { ...plan.ai_features, ...ai_features };
    if (agent_limit !== undefined) plan.agent_limit = agent_limit;
    if (campaign_limit_per_day !== undefined) plan.campaign_limit_per_day = campaign_limit_per_day;
    if (flow_limit !== undefined) plan.flow_limit = flow_limit;
    if (knowledgebase_limit !== undefined) plan.knowledgebase_limit = knowledgebase_limit;
    if (storage_limit !== undefined) plan.storage_limit = storage_limit;
    if (contact_limit !== undefined) plan.contact_limit = contact_limit;
    if (sms_agent_limit !== undefined) plan.sms_agent_limit = sms_agent_limit;
    if (sms_campaign_limit_per_day !== undefined) plan.sms_campaign_limit_per_day = sms_campaign_limit_per_day;
    if (campaign_sms_limit !== undefined) plan.campaign_sms_limit = campaign_sms_limit;

    await plan.save();

    res.status(200).json({
      message: 'Plan updated successfully.',
      plan
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Plan with this slug already exists.' });
    }
    console.error('Update Plan error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deletePlan = async (req, res) => {
  try {
    const plan = await Plan.findByIdAndDelete(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found.' });
    }
    res.status(200).json({ message: 'Plan deleted successfully.' });
  } catch (error) {
    console.error('Delete Plan error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.syncPlansToGateways = async (req, res) => {
  try {
    const { id, force } = req.body;
    let plans = [];

    if (id) {
      const plan = await Plan.findById(id);
      if (!plan) {
        return res.status(404).json({ message: 'Plan not found.' });
      }
      plans = [plan];
    } else {
      plans = await Plan.find({ status: 'active' });
    }

    let syncCount = 0;
    for (const plan of plans) {
      const updated = await _syncPlanInternal(plan, force);
      if (updated) syncCount++;
    }

    res.status(200).json({
      message: id ? 'Plan sync completed.' : `Sync completed for ${syncCount} plans.`,
      syncCount,
      plans: id ? plans[0] : plans
    });
  } catch (error) {
    console.error('Sync Plan error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
