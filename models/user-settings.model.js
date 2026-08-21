const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const UserSettingsSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    elevenlabs_api_key: {
      type: String,
      default: null
    },
    deepgram_api_key: {
      type: String,
      default: null
    },
    sarvam_ai_api_key: {
      type: String,
      default: null
    },
    twilio_account_sid: {
      type: String,
      default: null
    },
    twilio_auth_token: {
      type: String,
      default: null
    },
    twilio_api_key: {
      type: String,
      default: null
    },
    twilio_api_secret: {
      type: String,
      default: null
    },
    twilio_app_sid: {
      type: String,
      default: null
    },
    plivo_auth_id: {
      type: String,
      default: null
    },
    plivo_auth_token: {
      type: String,
      default: null
    },
    plivo_app_id: {
      type: String,
      default: null
    },
    google_client_id: {
      type: String,
      default: null
    },
    google_client_secret: {
      type: String,
      default: null
    },
    google_redirect_uri: {
      type: String,
      default: null
    },
    facebook_app_id: {
      type: String,
      default: null
    },
    facebook_app_secret: {
      type: String,
      default: null
    },
    facebook_redirect_uri: {
      type: String,
      default: null
    },
    ai_model: {
      type: Schema.Types.ObjectId,
      ref: 'AIModel',
      default: null
    },
    ai_api_key: {
      type: String,
      default: null
    },
    post_call_whatsapp_template: {
      type: Schema.Types.ObjectId,
      ref: 'WhatsAppTemplate',
      default: null
    },
    post_campaign_whatsapp_template: {
      type: Schema.Types.ObjectId,
      ref: 'WhatsAppTemplate',
      default: null
    },
    email_provider: {
      type: String,
      enum: ['nodemailer', 'sendgrid', 'mailgun'],
      default: 'nodemailer'
    },
    email_from_name: {
      type: String,
      default: 'Autocall'
    },
    email_from_email: {
      type: String
    },
    email_config: {
      smtp_host: { type: String },
      smtp_port: { type: Number },
      smtp_user: { type: String },
      smtp_pass: { type: String },
      mail_encryption: { type: String, enum: ['ssl', 'tls', 'none'], default: 'tls' },
      sendgrid_api_key: { type: String },
      mailgun_api_key: { type: String },
      mailgun_domain: { type: String }
    },
    post_call_channel: {
      type: String,
      enum: ['none', 'whatsapp', 'email', 'both'],
      default: 'none'
    },
    post_call_email_template: {
      type: Schema.Types.ObjectId,
      ref: 'EmailTemplate',
      default: null
    },
    whatsapp_app_id: {
      type: String,
      default: null
    },
    whatsapp_app_secret: {
      type: String,
      default: null
    },
    configuration_id: {
      type: String,
      default: null
    }
  },
  {
    collection: 'usersettings',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

addVirtualId(UserSettingsSchema);

UserSettingsSchema.index({ user: 1 });

module.exports = mongoose.model('UserSettings', UserSettingsSchema);
