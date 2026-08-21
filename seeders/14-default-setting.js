const Setting = require('../models/setting.model');

const defaultSettings = {
  app_name: 'AutoCall',
  app_description: 'A modern AI Builder application',
  app_email: 'support@example.com',
  support_email: 'support@example.com',

  favicon_url: 'uploads/logo/favicon.png',
  logo_light_url: 'uploads/logo/autocall-logo.png',
  logo_dark_url: '',
  sidebar_logo_url: 'uploads/logo/autocall-logo.png',
  mobile_logo_url: '',
  landing_logo_url: 'uploads/logo/autocall-logo.png',
  favicon_notification_logo_url: '',
  onboarding_logo_url: '',

  maintenance_mode: false,
  is_demo_mode: false,
  maintenance_title: 'Under Maintenance',
  maintenance_message: 'We are performing some maintenance. Please check back later.',
  maintenance_image_url: '',
  maintenance_allowed_ips: [],

  page_404_title: 'Page Not Found',
  page_404_content: 'The page you are looking for does not exist.',
  page_404_image_url: '',
  no_internet_title: 'No Internet Connection',
  no_internet_content: 'Please check your internet connection and try again.',
  no_internet_image_url: '',

  smtp_host: '',
  smtp_port: 587,
  smtp_user: '',
  smtp_pass: '',
  mail_from_name: 'AutoCall',
  mail_from_email: 'noreply@autocall.ai',
  mail_encryption: 'tls',

  session_expiration_days: 7,
  session_limit: 10,

  document_file_limit: 15,
  audio_file_limit: 15,
  video_file_limit: 20,
  image_file_limit: 10,
  multiple_file_share_limit: 10,
  allowed_file_upload_types: null,


  storage_type: 'local',
  storage_limit_per_user: 20,
  restore_storage_on_delete: true,

  demo_user_email: null,
  demo_user_password: null,
  enable_trial: true,
  trial_days_limit: 14,
  stripe_secret_key: null,
  stripe_webhook_secret: null,
  razorpay_key_id: null,
  razorpay_key_secret: null,
  razorpay_webhook_secret: null,
  paypal_client_id: null,
  paypal_client_secret: null,
  paypal_mode: 'sandbox',
  enable_manual_payment: false,
  bank_details: null,

  default_agent_limit: 2,
  default_campaign_limit_per_day: 1,
  default_flow_limit: 2,
  default_knowledgebase_limit: 5,
  default_sms_campaign_limit_per_day: 1,
  default_campaign_sms_limit: 100,
  default_sms_agent_limit: 2,
  default_storage_limit: 20,
  default_contact_limit: 100,
  aws_access_key_id: null,
  aws_secret_access_key: null,
  aws_region: null,
  aws_bucket_name: null,
  login_widget_key: null,
  openai_api_key: null,
  apikey_prefix: 'AKK-',
  credit_deduction_type: 'per_call',
  credits_per_call: 1,
  credits_per_minute: 1,
  credits_per_sms: 1,
  free_credits_on_registration: 0,
  signup_agreement_enabled: false,
  signup_agreement_prefix_text: 'I agree to the',
  signup_agreement_link_text: 'Privacy Policy',
  signup_agreement_target_page: null,
};

async function up(dbConnection, mongoose) {
  try {
    const SettingModel = dbConnection.db.Setting || require('../models/setting.model');

    let existingSetting = await SettingModel.findOne({});
    if (!existingSetting) {
      const setting = new SettingModel(defaultSettings);
      await setting.save();
      console.log('Settings seeded successfully!');
    } else {
      let isModified = false;
      for (const key in defaultSettings) {
        if (existingSetting[key] === undefined) {
          existingSetting[key] = defaultSettings[key];
          isModified = true;
        }
      }
      if (isModified) {
        await existingSetting.save();
      }
    }
  } catch (error) {
    console.error('Error seeding settings:', error);
    throw error;
  }
}

async function down(dbConnection, mongoose) {
  try {
    const SettingModel = dbConnection.db.Setting || require('../models/setting.model');

    await SettingModel.deleteMany({});
    console.log('Settings removed successfully!');
  } catch (error) {
    console.error('Error removing settings:', error);
    throw error;
  }
}

module.exports = { up, down };