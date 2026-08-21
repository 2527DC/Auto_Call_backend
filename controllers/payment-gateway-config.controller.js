'use strict';

const { db } = require('../models');
const PaymentGatewayConfig = db.PaymentGatewayConfig;
const PaymentHistory = db.PaymentHistory;
const { registerWebhook, unregisterWebhook, testConnection, } = require('../utils/payment-gateway.service');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const parsePaginationParams = (query) => {
  const page = Math.max(1, parseInt(query.page) || DEFAULT_PAGE);
  const limit = Math.max(1, Math.min(MAX_LIMIT, parseInt(query.limit) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const getWebhookBaseUrl = (req) => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

function _sanitizeConfig(config) {
  const safe = { ...config };

  const maskField = (key) => {
    if (safe[key] && typeof safe[key] === 'string') {
      const val = safe[key];
      if (val.length <= 4) {
        safe[key] = '*'.repeat(val.length);
      } else {
        safe[key] = '*'.repeat(val.length - 4) + val.slice(-4);
      }
    }
  };

  maskField('stripe_secret_key');
  maskField('stripe_webhook_secret');
  maskField('razorpay_key_secret');
  maskField('razorpay_webhook_secret');
  maskField('paypal_client_secret');

  delete safe.webhook_secret;

  return safe;
}

function _defaultConfig(gateway_name, userId) {
  return {
    id: null,
    gateway_name,
    user_id: userId,
    is_enabled: false,
    is_test_mode: true,
    stripe_secret_key: null,
    stripe_publishable_key: null,
    stripe_webhook_secret: null,
    razorpay_key_id: null,
    razorpay_key_secret: null,
    razorpay_webhook_secret: null,
    paypal_client_id: null,
    paypal_client_secret: null,
    paypal_mode: 'sandbox',
    enable_manual_payment: false,
    manual_payment_instructions: null,
    bank_details: {},
    currency: 'USD',
    enable_trial: true,
    trial_days_limit: 14,
    config: {},
    created_at: null,
    updated_at: null,
  };
}

exports.createGateway = async (req, res) => {
  try {
    const { gateway_name, credentials = {}, ...rest } = req.body;

    const userId = req.user._id;

    if (!gateway_name) {
      return res.status(400).json({ success: false, message: 'gateway_name is required' });
    }

    const validGateways = ['stripe', 'razorpay', 'paypal', 'manual'];
    if (!validGateways.includes(gateway_name)) {
      return res.status(400).json({ success: false, message: `Invalid gateway_name` });
    }

    const payload = { ...rest, ...credentials };

    let webhookInfo = {
      webhook_id: null,
      webhook_secret: null
    };

    try {
      webhookInfo = await registerWebhook(
        { gateway_name, ...payload },
        getWebhookBaseUrl(req)
      );
    } catch (err) {
      console.warn(err.message);
    }

    let config = await PaymentGatewayConfig.findOne({
      gateway_name,
      user_id: userId,
      deleted_at: null
    });

    if (config) {
      Object.assign(config, payload);

      if (webhookInfo.webhook_id) {
        config.config = {
          ...config.config,
          webhook_id: webhookInfo.webhook_id
        };

        if (gateway_name === 'stripe' && webhookInfo.webhook_secret) config.stripe_webhook_secret = webhookInfo.webhook_secret;
        if (gateway_name === 'razorpay' && webhookInfo.webhook_secret) config.razorpay_webhook_secret = webhookInfo.webhook_secret;
      }

      await config.save();

    } else {
      const configData = {
        gateway_name,
        user_id: userId,
        ...payload,
        config: webhookInfo.webhook_id
          ? { webhook_id: webhookInfo.webhook_id }
          : {}
      };

      if (gateway_name === 'stripe' && webhookInfo.webhook_secret) configData.stripe_webhook_secret = webhookInfo.webhook_secret;
      if (gateway_name === 'razorpay' && webhookInfo.webhook_secret) configData.razorpay_webhook_secret = webhookInfo.webhook_secret;

      config = await PaymentGatewayConfig.create(configData);
    }

    return res.status(201).json({
      success: true,
      data: _sanitizeConfig(config.toObject())
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.getGateways = async (req, res) => {
  try {
    const userId = req.user._id;
    const configs = await PaymentGatewayConfig.find({ user_id: userId, deleted_at: null })
      .sort({ created_at: -1 })
      .lean();

    const safeConfigs = configs.map(_sanitizeConfig);

    return res.json({ success: true, data: safeConfigs });
  } catch (error) {
    console.error('getGateways error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getEnabledGateways = async (req, res) => {
  try {
    const query = { is_enabled: true, deleted_at: null };
    if (req.user?._id) query.user_id = req.user._id;

    const configs = await PaymentGatewayConfig.find(query).lean();

    const enabledGateways = configs.map((c) => ({
      gateway_name: c.gateway_name,
      currency: c.currency,
      is_test_mode: c.is_test_mode,
    }));

    return res.json({ success: true, data: enabledGateways });
  } catch (error) {
    console.error('getEnabledGateways error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getGatewayConfigByName = async (req, res) => {
  try {
    const { name } = req.params;
    const userId = req.user._id;

    let config = await PaymentGatewayConfig.findOne({ gateway_name: name, user_id: userId, deleted_at: null }).lean();

    if (!config) {
      config = _defaultConfig(name, userId);
    }

    return res.json({ success: true, data: _sanitizeConfig(config) });
  } catch (error) {
    console.error('getGatewayConfigByName error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateGateway = async (req, res) => {
  try {
    const { gateway_name } = req.params;
    const userId = req.user._id;
    const updateData = req.body;

    let config = await PaymentGatewayConfig.findOne({ gateway_name, user_id: userId, deleted_at: null });

    if (!config) {
      config = new PaymentGatewayConfig({ gateway_name, user_id: userId });
    }

    const credentialFields = {
      stripe: ['stripe_secret_key', 'stripe_webhook_secret'],
      razorpay: ['razorpay_key_secret', 'razorpay_webhook_secret'],
      paypal: ['paypal_client_secret'],
      manual: [],
    }[gateway_name] || [];

    let credentialsChanged = false;
    const updatedFields = {};

    for (const [key, value] of Object.entries(updateData)) {
      if (credentialFields.includes(key) && typeof value === 'string' && /^\*+/.test(value)) {
        continue;
      }
      updatedFields[key] = value;
      if (credentialFields.includes(key) && config[key] !== value) {
        credentialsChanged = true;
      }
    }

    Object.assign(config, updatedFields);

    if (credentialsChanged) {
      const oldWebhookId = config.config?.webhook_id;
      if (oldWebhookId) {
        try {
          await unregisterWebhook({ ...config.toObject(), webhook_id: oldWebhookId });
        } catch (err) {
          console.warn(`[PaymentGW] Failed to unregister old webhook: ${err.message}`);
        }
      }

      try {
        const webhookInfo = await registerWebhook(config.toObject(), getWebhookBaseUrl(req));
        if (webhookInfo.webhook_id) {
          config.config = { ...config.config, webhook_id: webhookInfo.webhook_id };

          if (gateway_name === 'stripe' && webhookInfo.webhook_secret) config.stripe_webhook_secret = webhookInfo.webhook_secret;
          if (gateway_name === 'razorpay' && webhookInfo.webhook_secret) config.razorpay_webhook_secret = webhookInfo.webhook_secret;
        }
        console.log(`[PaymentGW] Webhook re-registered for ${gateway_name}`);
      } catch (err) {
        console.warn(`[PaymentGW] Webhook re-registration failed: ${err.message}`);
      }
    }

    await config.save();

    return res.json({
      success: true,
      data: _sanitizeConfig(config.toObject()),
      message: 'Gateway configuration updated successfully',
    });
  } catch (error) {
    console.error('updateGateway error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.toggleGatewayStatus = async (req, res) => {
  try {
    const { name } = req.params;
    const userId = req.user._id;
    const config = await PaymentGatewayConfig.findOne({ gateway_name: name, user_id: userId, deleted_at: null });

    if (!config) {
      return res.status(404).json({ success: false, message: 'Gateway configuration not found. Please save credentials first.' });
    }

    config.is_enabled = !config.is_enabled;
    await config.save();

    return res.json({
      success: true,
      data: _sanitizeConfig(config.toObject()),
      message: `Gateway ${config.is_enabled ? 'enabled' : 'disabled'} successfully`,
    });
  } catch (error) {
    console.error('toggleGatewayStatus error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteGateway = async (req, res) => {
  try {
    const { name } = req.params;
    const userId = req.user._id;
    const config = await PaymentGatewayConfig.findOne({ gateway_name: name, user_id: userId, deleted_at: null });

    if (!config) {
      return res.status(404).json({ success: false, message: 'Gateway configuration not found' });
    }

    const webhookId = config.config?.webhook_id;
    if (webhookId) {
      try {
        await unregisterWebhook({ ...config.toObject(), webhook_id: webhookId });
      } catch (err) {
        console.warn(`[PaymentGW] Webhook unregister failed on delete: ${err.message}`);
      }
    }

    config.deleted_at = new Date();
    config.is_enabled = false;
    await config.save();

    return res.json({ success: true, message: 'Payment gateway deleted successfully' });
  } catch (error) {
    console.error('deleteGateway error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.testGateway = async (req, res) => {
  try {
    const { name } = req.params;
    const userId = req.user._id;
    const config = await PaymentGatewayConfig.findOne({ gateway_name: name, user_id: userId, deleted_at: null }).lean();

    if (!config) {
      return res.status(404).json({ success: false, message: 'Gateway configuration not found. Please save credentials first.' });
    }

    const result = await testConnection(config);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('testGateway error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.testGatewayConnection = exports.testGateway;

exports.reregisterWebhook = async (req, res) => {
  try {
    const { name } = req.params;
    const userId = req.user._id;
    const config = await PaymentGatewayConfig.findOne({ gateway_name: name, user_id: userId, deleted_at: null });

    if (!config) {
      return res.status(404).json({ success: false, message: 'Gateway configuration not found. Please save credentials first.' });
    }

    const oldWebhookId = config.config?.webhook_id;
    if (oldWebhookId) {
      try {
        await unregisterWebhook({ ...config.toObject(), webhook_id: oldWebhookId });
      } catch (_) { }
    }

    const webhookInfo = await registerWebhook(config.toObject(), getWebhookBaseUrl(req));
    config.config = { ...config.config, webhook_id: webhookInfo.webhook_id || null };

    if (name === 'stripe' && webhookInfo.webhook_secret) config.stripe_webhook_secret = webhookInfo.webhook_secret;
    if (name === 'razorpay' && webhookInfo.webhook_secret) config.razorpay_webhook_secret = webhookInfo.webhook_secret;

    await config.save();

    return res.json({
      success: true,
      message: 'Webhook re-registered successfully',
      webhook_id: webhookInfo.webhook_id,
      webhook_url: `${getWebhookBaseUrl(req)}/api/webhook/${name}`,
    });
  } catch (error) {
    console.error('reregisterWebhook error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getWebhookUrls = async (req, res) => {
  try {
    const baseUrl = getWebhookBaseUrl(req);

    return res.json({
      success: true,
      data: {
        stripe: `${baseUrl}/api/webhook/stripe`,
        razorpay: `${baseUrl}/api/webhook/razorpay`,
        paypal: `${baseUrl}/api/webhook/paypal`,
      },
    });
  } catch (error) {
    console.error('getWebhookUrls error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateTrialSettings = async (req, res) => {
  try {
    const { enable_trial, trial_days_limit } = req.body;
    const userId = req.user._id;

    let config = await PaymentGatewayConfig.findOne({ gateway_name: 'manual', user_id: userId, deleted_at: null });

    if (config) {
      if (enable_trial !== undefined) config.enable_trial = enable_trial;
      if (trial_days_limit !== undefined) config.trial_days_limit = trial_days_limit;
      await config.save();
    } else {
      config = await PaymentGatewayConfig.create({
        gateway_name: 'manual',
        user_id: userId,
        enable_trial: enable_trial !== undefined ? enable_trial : true,
        trial_days_limit: trial_days_limit !== undefined ? trial_days_limit : 14,
      });
    }

    return res.json({
      success: true,
      data: { enable_trial: config.enable_trial, trial_days_limit: config.trial_days_limit },
      message: 'Trial settings updated successfully',
    });
  } catch (error) {
    console.error('updateTrialSettings error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page, limit, skip } = parsePaginationParams(req.query);
    const { status, gateway, payment_gateway, search, start_date, end_date } = req.query;

    const matchFilter = { user_id: userId, deleted_at: null };

    if (status) matchFilter.payment_status = status;
    if (gateway || payment_gateway) matchFilter.payment_gateway = gateway || payment_gateway;

    if (start_date || end_date) {
      const dateFilter = {};
      if (start_date) dateFilter.$gte = new Date(start_date);
      if (end_date) dateFilter.$lte = new Date(end_date);
      matchFilter.paid_at = dateFilter;
    }

    if (search) {
      matchFilter.$or = [
        { transaction_id: { $regex: search, $options: 'i' } },
        { invoice_number: { $regex: search, $options: 'i' } },
      ];
    }

    const [totalCount, transactions] = await Promise.all([
      PaymentHistory.countDocuments(matchFilter),
      PaymentHistory.find(matchFilter)
        .populate('plan_id', 'name slug price billing_cycle')
        .populate('subscription_id', 'status payment_gateway')
        .sort({ paid_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalItems: totalCount,
          itemsPerPage: limit,
        },
      },
    });
  } catch (error) {
    console.error('getTransactions error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};