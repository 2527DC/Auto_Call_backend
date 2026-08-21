const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SettingSchema = new Schema(
  {
    app_name: {
      type: String,
      default: 'My Application'
    },
    app_description: {
      type: String,
      default: 'AI Builder'
    },
    app_email: {
      type: String,
      default: 'support@example.com',
      required: true
    },
    support_email: {
      type: String,
      default: 'support@example.com',
      required: true
    },

    favicon_url: {
      type: String,
      default: null
    },
    logo_light_url: {
      type: String,
      default: null
    },
    logo_dark_url: {
      type: String,
      default: null
    },
    sidebar_logo_url: {
      type: String,
      default: null
    },
    mobile_logo_url: {
      type: String,
      default: null
    },
    landing_logo_url: {
      type: String,
      default: null
    },
    favicon_notification_logo_url: {
      type: String,
      default: null
    },
    onboarding_logo_url: {
      type: String,
      default: null
    },

    maintenance_mode: {
      type: Boolean,
      default: false,
      required: true
    },
    maintenance_title: {
      type: String,
      default: 'Under Maintenance'
    },
    maintenance_message: {
      type: String,
      default: 'We are performing some maintenance. Please check back later.'
    },
    maintenance_image_url: {
      type: String,
      default: null
    },
    maintenance_allowed_ips: {
      type: [String],
      default: []
    },

    page_404_title: {
      type: String,
      default: 'Page Not Found'
    },
    page_404_content: {
      type: String,
      default: 'The page you are looking for does not exist.'
    },
    page_404_image_url: {
      type: String,
      default: null
    },
    no_internet_title: {
      type: String,
      default: 'No Internet Connection'
    },
    no_internet_content: {
      type: String,
      default: 'Please check your internet connection and try again.'
    },
    no_internet_image_url: {
      type: String,
      default: null
    },

    smtp_host: {
      type: String,
      default: null
    },
    smtp_port: {
      type: Number,
      default: 587
    },
    smtp_user: {
      type: String,
      default: null
    },
    smtp_pass: {
      type: String,
      default: null
    },
    mail_from_name: {
      type: String,
      default: 'My Application'
    },
    mail_from_email: {
      type: String,
      default: 'noreply@myapplication.com'
    },
    mail_encryption: {
      type: String, enum: ['ssl', 'tls'],
      default: 'tls',
      required: true
    },
    session_expiration_days: {
      type: Number,
      default: 7
    },
    session_limit: {
      type: Number,
      default: 10
    },
    document_file_limit: {
      type: Number,
      default: 15
    },
    audio_file_limit: {
      type: Number,
      default: 15
    },
    video_file_limit: {
      type: Number,
      default: 20
    },
    image_file_limit: {
      type: Number,
      default: 10
    },
    multiple_file_share_limit: {
      type: Number,
      default: 10
    },
    allowed_file_upload_types: {
      type: Object,
      default: null
    },
    demo_user_email: {
      type: String,
      default: null
    },
    demo_user_password: {
      type: String,
      default: null
    },
    is_demo_mode: {
      type: Boolean,
      default: false
    },
    enable_trial: {
      type: Boolean,
      default: true
    },
    trial_days_limit: {
      type: Number,
      default: 14
    },
    stripe_secret_key: {
      type: String,
      default: null
    },
    stripe_webhook_secret: {
      type: String,
      default: null
    },
    razorpay_key_id: {
      type: String,
      default: null
    },
    razorpay_key_secret: {
      type: String,
      default: null
    },
    razorpay_webhook_secret: {
      type: String,
      default: null
    },
    paypal_client_id: {
      type: String,
      default: null
    },
    paypal_client_secret: {
      type: String,
      default: null
    },
    paypal_mode: {
      type: String,
      enum: ['sandbox', 'live'],
      default: 'sandbox'
    },
    enable_manual_payment: {
      type: Boolean,
      default: false
    },
    bank_details: {
      type: Object,
      default: null
    },
    storage_type: {
      type: String,
      enum: ['local', 'aws'],
      default: 'local'
    },
    storage_limit_per_user: {
      type: Number,
      default: 20
    },
    restore_storage_on_delete: {
      type: Boolean,
      default: true
    },
    default_agent_limit: {
      type: Number,
      default: 2
    },
    default_campaign_limit_per_day: {
      type: Number,
      default: 1
    },
    default_flow_limit: {
      type: Number,
      default: 2
    },
    default_knowledgebase_limit: {
      type: Number,
      default: 5
    },
    default_sms_campaign_limit_per_day: {
      type: Number,
      default: 1
    },
    default_campaign_sms_limit: {
      type: Number,
      default: 100
    },
    default_sms_agent_limit: {
      type: Number,
      default: 2
    },
    default_storage_limit: {
      type: Number,
      default: 20
    },
    default_contact_limit: {
      type: Number,
      default: 100
    },
    aws_access_key_id: {
      type: String,
      default: null
    },
    aws_secret_access_key: {
      type: String,
      default: null
    },
    aws_region: {
      type: String,
      default: null
    },
    aws_bucket_name: {
      type: String,
      default: null
    },
    login_widget_key: {
      type: Schema.Types.ObjectId,
      ref: 'Widget',
      default: null
    },
    openai_api_key: {
      type: String,
      default: null
    },
    apikey_prefix: {
      type: String,
      default: 'AKK-'
    },
    credit_deduction_type: {
      type: String,
      enum: ['per_call', 'per_minute'],
      default: 'per_call'
    },
    credits_per_call: {
      type: Number,
      default: 1
    },
    credits_per_minute: {
      type: Number,
      default: 1
    },
    credits_per_sms: {
      type: Number,
      default: 1
    },
    free_credits_on_registration: {
      type: Number,
      default: 0
    },
    signup_agreement_enabled: {
      type: Boolean,
      default: false
    },
    signup_agreement_prefix_text: {
      type: String,
      default: 'I agree to the'
    },
    signup_agreement_link_text: {
      type: String,
      default: 'Privacy Policy'
    },
    signup_agreement_target_page: {
      type: Schema.Types.ObjectId,
      ref: 'Page',
      default: null
    },
    kyc_allow_pdf_upload: {
      type: Boolean,
      default: true                                                                                                                                                                                                                                                                                                                                                                                                                                                     
    },
    kyc_required: {
      type: Boolean,
      default: true
    },                                                                                                                                                                                                                                                                                                                                                                              
    kyc_max_files: {
      type: Number,
      default: 6
    },
    kyc_form_fields: {
      type: Array,
      default: [
        { label: 'Name', type: 'Text', placeholder: 'Enter your name', required: true },
        { label: 'Mobile', type: 'Text', placeholder: 'Enter mobile number', required: true },
        { label: 'Government ID Proof', type: 'File', placeholder: 'Passport, National ID, or Driver\'s License', required: true },
        { label: 'Business Registration Document', type: 'File', placeholder: 'Certificate of Incorporation or Business Registration', required: true },
        { label: 'Tax Identification Document', type: 'File', placeholder: 'VAT/Tax ID certificate or official tax registration', required: true },
        { label: 'Company Consent Letter', type: 'File', placeholder: 'A signed letter on company letterhead authorizing the purchase', required: true }
      ]
    }
  },
  {
    collection: 'settings',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(SettingSchema);

module.exports = mongoose.model('Setting', SettingSchema);