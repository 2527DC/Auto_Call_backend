const { db } = require('../models');
const Setting = db.Setting;
const User = db.User;
const Language = db.Language;
const fs = require('fs');
const path = require('path');
const { sendTemplateMail } = require('../utils/mail');

const updateEnvFile = (settings) => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf8');

      const updateOrAdd = (key, value) => {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        const val = value === null || value === undefined ? '' : value;
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${val}`);
        } else {
          envContent += `\n${key}=${val}`;
        }
      };

      updateOrAdd('SMTP_HOST', settings.smtp_host);
      updateOrAdd('SMTP_PORT', settings.smtp_port);
      updateOrAdd('SMTP_USER', settings.smtp_user);
      updateOrAdd('SMTP_PASS', settings.smtp_pass);
      updateOrAdd('MAIL_FROM_NAME', settings.mail_from_name);
      updateOrAdd('MAIL_FROM_ADDRESS', settings.mail_from_email);
      updateOrAdd('MAIL_ENCRYPTION', settings.mail_encryption);

      fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
    }
  } catch (error) {
    console.error('Error updating .env file:', error);
  }
};

exports.getSettings = async (req, res) => {
  try {
    let settings = await Setting.findOne().populate('login_widget_key').lean();

    if (!settings) {
      return res.status(404).json({ message: 'Settings not found.' });
    }

    const userIp = req.ip?.replace(/^::ffff:/, '') || req.headers['x-forwarded-for']?.split(',')[0].trim();

    res.status(200).json({
      message: 'Settings fetched successfully',
      settings: {
        id: settings._id,
        userIp,
        ...settings
      }
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = await Setting.findOne().lean({ virtuals: true });
    if (!settings) return res.status(404).json({ message: 'Settings not found' });

    const updateData = {};

    const basicFields = ['app_name', 'app_description', 'app_email', 'support_email'];
    const emailFields = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'mail_from_name', 'mail_from_email', 'mail_encryption'];
    const maintenanceFields = ['maintenance_mode', 'maintenance_title', 'maintenance_message', 'maintenance_image_url', 'maintenance_allowed_ips'];
    const logoFields = [
      'favicon_url', 'logo_light_url', 'logo_dark_url', 'sidebar_logo_url', 'mobile_logo_url',
      'landing_logo_url', 'favicon_notification_logo_url', 'onboarding_logo_url',
    ];
    const pageFields = ['page_404_title', 'page_404_content', 'page_404_image_url', 'no_internet_title', 'no_internet_content', 'no_internet_image_url'];
    const chatFields = [
      'document_file_limit', 'audio_file_limit', 'video_file_limit', 'image_file_limit', 'multiple_file_share_limit',
      'allowed_file_upload_types', 'session_expiration_days', 'session_limit'
    ];
    const subscriptionFields = [
      'enable_trial', 'trial_days_limit', 'default_agent_limit',
      'default_campaign_limit_per_day', 'default_flow_limit', 'default_knowledgebase_limit',
      'default_storage_limit', 'default_contact_limit', 'default_sms_agent_limit',
      'default_sms_campaign_limit_per_day', 'default_campaign_sms_limit'
    ];
    const paymentFields = [
      'stripe_secret_key', 'stripe_webhook_secret', 'razorpay_key_id', 'razorpay_key_secret',
      'razorpay_webhook_secret', 'paypal_client_id', 'paypal_client_secret', 'paypal_mode',
      'enable_manual_payment', 'bank_details'
    ];
    const storageFields = [
      'storage_type', 'storage_limit_per_user', 'aws_access_key_id', 'aws_secret_access_key',
      'aws_region', 'aws_bucket_name', 'restore_storage_on_delete'
    ];
    const aiFields = ['openai_api_key'];
    const demoFields = ['demo_user_email', 'demo_user_password', 'is_demo_mode'];
    const widgetFields = ['login_widget_key'];
    const creditFields = ['credit_deduction_type', 'credits_per_call', 'credits_per_minute', 'free_credits_on_registration', 'credits_per_sms'];
    const agreementFields = ['signup_agreement_enabled', 'signup_agreement_prefix_text', 'signup_agreement_link_text', 'signup_agreement_target_page'];
    const kycFields = ['kyc_allow_pdf_upload', 'kyc_required', 'kyc_max_files', 'kyc_form_fields'];

    const allFields = [
      ...basicFields, ...logoFields, ...maintenanceFields, ...pageFields, ...emailFields,
      ...chatFields, ...subscriptionFields, ...paymentFields, ...storageFields, ...aiFields, ...demoFields, ...widgetFields, ...creditFields, ...agreementFields, ...kycFields
    ];

    const fieldMap = {
      favicon: 'favicon_url',
      logo_light: 'logo_light_url',
      logo_dark: 'logo_dark_url',
      sidebar_logo: 'sidebar_logo_url',
      mobile_logo: 'mobile_logo_url',
      landing_logo: 'landing_logo_url',
      favicon_notification_logo: 'favicon_notification_logo_url',
      onboarding_logo: 'onboarding_logo_url',
      maintenance_image: 'maintenance_image_url',
      page_404_image: 'page_404_image_url',
      no_internet_image: 'no_internet_image_url',
    };

    allFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        if (field === 'maintenance_allowed_ips' || field === 'allowed_file_upload_types' || field === 'bank_details' || field === 'kyc_form_fields') {
          try {
            updateData[field] = (typeof req.body[field] === 'object' && req.body[field] !== null) ? req.body[field] : JSON.parse(req.body[field] || (field === 'bank_details' ? '{}' : '[]'));
          } catch {
            updateData[field] = field === 'bank_details' ? {} : [];
          }
        } else {
          updateData[field] = req.body[field];
        }
      }
    });

    Object.keys(fieldMap).forEach((uploadField) => {
      if (req.body[uploadField] === 'null' || req.body[uploadField] === null) {
        const dbField = fieldMap[uploadField];
        if (settings[dbField]) {
          const oldPath = path.join(process.cwd(), settings[dbField]);
          if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (e) { console.error('Error deleting file:', e); }
          }
        }
        updateData[dbField] = null;
      }
    });

    if (req.files) {
      Object.keys(req.files).forEach((uploadField) => {
        const file = req.files[uploadField][0];
        const dbField = fieldMap[uploadField];
        if (file && dbField) {
          if (settings[dbField]) {
            const oldPath = path.join(process.cwd(), settings[dbField]);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          }
          updateData[dbField] = file.path;
        }
      });
    }

    const numericFields = [
      'document_file_limit', 'audio_file_limit', 'video_file_limit', 'image_file_limit', 'multiple_file_share_limit',
      'session_expiration_days', 'session_limit', 'trial_days_limit',
      'storage_limit_per_user', 'smtp_port',
      'default_agent_limit', 'default_campaign_limit_per_day', 'default_flow_limit',
      'default_knowledgebase_limit', 'default_storage_limit', 'default_contact_limit',
      'default_sms_agent_limit', 'default_sms_campaign_limit_per_day', 'default_campaign_sms_limit',
      'credits_per_call', 'credits_per_minute', 'free_credits_on_registration', 'credits_per_sms',
      'kyc_max_files'
    ];



    numericFields.forEach((field) => {
      if (updateData[field] !== undefined) {
        updateData[field] = updateData[field] === '' || updateData[field] == null ? null : Number(updateData[field]);
      }
    });

    if (updateData.kyc_allow_pdf_upload !== undefined) {
      updateData.kyc_allow_pdf_upload = updateData.kyc_allow_pdf_upload === 'true' || updateData.kyc_allow_pdf_upload === true || updateData.kyc_allow_pdf_upload === '1' || updateData.kyc_allow_pdf_upload === 1;
    }

    if (updateData.kyc_required !== undefined) {
      updateData.kyc_required = updateData.kyc_required === 'true' || updateData.kyc_required === true || updateData.kyc_required === '1' || updateData.kyc_required === 1;
    }

    if (updateData.maintenance_mode !== undefined) {
      updateData.maintenance_mode = updateData.maintenance_mode === 'true' || updateData.maintenance_mode === true || updateData.maintenance_mode === '1' || updateData.maintenance_mode === 1;
    }

    if (updateData.is_demo_mode !== undefined) {
      updateData.is_demo_mode = updateData.is_demo_mode === 'true' || updateData.is_demo_mode === true || updateData.is_demo_mode === '1' || updateData.is_demo_mode === 1;
    }

    if (updateData.enable_trial !== undefined) {
      updateData.enable_trial = updateData.enable_trial === 'true' || updateData.enable_trial === true || updateData.enable_trial === '1' || updateData.enable_trial === 1;
    }

    if (updateData.enable_manual_payment !== undefined) {
      updateData.enable_manual_payment = updateData.enable_manual_payment === 'true' || updateData.enable_manual_payment === true || updateData.enable_manual_payment === '1' || updateData.enable_manual_payment === 1;
    }

    if (updateData.restore_storage_on_delete !== undefined) {
      updateData.restore_storage_on_delete = updateData.restore_storage_on_delete === 'true' || updateData.restore_storage_on_delete === true || updateData.restore_storage_on_delete === '1' || updateData.restore_storage_on_delete === 1;
    }

    if (updateData.signup_agreement_enabled !== undefined) {
      updateData.signup_agreement_enabled = updateData.signup_agreement_enabled === 'true' || updateData.signup_agreement_enabled === true || updateData.signup_agreement_enabled === '1' || updateData.signup_agreement_enabled === 1;
      
      if (updateData.signup_agreement_enabled) {
        if (!updateData.signup_agreement_prefix_text || !updateData.signup_agreement_link_text || !updateData.signup_agreement_target_page) {
          return res.status(400).json({ message: 'Prefix Text, Link Text and Target Dynamic Page are required when Signup Agreement is enabled' });
        }
      }
    }

    if (updateData.smtp_port !== undefined && (updateData.smtp_port < 1 || updateData.smtp_port > 65535)) {
      return res.status(400).json({ message: 'SMTP port must be between 1 and 65535' });
    }

    if (updateData.login_widget_key !== undefined) {
      const loginWidgetKey = updateData.login_widget_key;
      if (
        loginWidgetKey === '' ||
        loginWidgetKey === 'null' ||
        loginWidgetKey === 'none' ||
        loginWidgetKey === null
      ) {
        updateData.login_widget_key = null;
      }
    }

    if (updateData.credit_deduction_type !== undefined) {
      if (!['per_call', 'per_minute'].includes(updateData.credit_deduction_type)) {
        return res.status(400).json({ message: 'credit_deduction_type must be either per_call or per_minute' });
      }
    }

    await Setting.updateOne({}, { $set: updateData }, { upsert: true });

    const updatedSettings = await Setting.findOne().lean({ virtuals: true });

    updateEnvFile(updatedSettings);

    const { smtp_pass, _id, ...safeSettings } = updatedSettings || {};

    safeSettings.id = updatedSettings.id || updatedSettings._id?.toString();

    const io = req.app.get('io');
    io.emit('admin-settings-updated', safeSettings);

    return res.status(200).json({ message: 'Settings updated successfully', settings: safeSettings, });
  } catch (err) {
    console.error('Error updating settings:', err);

    if (req.files) {
      Object.values(req.files).flat().forEach((file) => {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      });
    }

    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.sendTestMail = async (req, res) => {
  const { to } = req.body;

  if (!to) return res.status(400).json({ message: 'To is required field.' });

  try {
    const settings = await Setting.findOne();
    const siteName = settings.app_name || 'My App';
    const timestamp = new Date().toLocaleString();

    const result = await sendTemplateMail(
      to,
      'Test Email Verification',
      'test-email',
      { siteName, timestamp }
    );

    if (result.success) {
      return res.status(200).json({ message: 'Test email sent successfully!' });
    } else {
      return res.status(500).json({ message: result.message, error: result.message });
    }
  } catch (error) {
    console.error('Error sending test email:', error);
    return res.status(500).json({ message: 'Error sending test email.' });
  }
};

exports.getPublicSettings = async (req, res) => {
  try {
    const publicFields = [
      'app_name',
      'app_description',
      'landing_logo_url',
      'logo_dark_url',
      'logo_light_url',
      'mobile_logo_url',
      'no_internet_image_url',
      'onboarding_logo_url',
      'page_404_image_url',
      'sidebar_logo_url',

      'favicon_notification_logo_url',
      'favicon_url',
      'maintenance_image_url',
      'maintenance_message',
      'maintenance_mode',
      'is_demo_mode',
      'maintenance_title',
      'maintenance_allowed_ips',
      'no_internet_title',
      'no_internet_content',
      'login_widget_key',
      'signup_agreement_enabled',
      'signup_agreement_prefix_text',
      'signup_agreement_link_text',
      'signup_agreement_target_page',
      'kyc_allow_pdf_upload',
      'kyc_required',
      'kyc_max_files',
      'kyc_form_fields'
    ];

    const settings = await Setting.findOne()
      .select(publicFields.join(' '))
      .populate('login_widget_key')
      .populate('signup_agreement_target_page', 'slug title')
      .lean();

    if (!settings) {
      return res.status(404).json({ message: 'Settings not found.' });
    }

    const userIp =
      req.ip?.replace(/^::ffff:/, '') ||
      req.headers['x-forwarded-for']?.split(',')[0].trim();

    res.status(200).json({
      message: 'Public settings fetched successfully',
      settings: {
        id: settings._id,
        userIp,
        ...settings
      }
    });
  } catch (error) {
    console.error('Get public settings error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};