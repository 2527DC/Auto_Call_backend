'use strict';

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const connectDB = require('./config/db');
require('./config/passport');
const app = express();
dotenv.config();

app.set('trust proxy', true);
// const { rtInit } = require('./node/src/middlewares/runtime-init.js');


app.use(session({
  secret: process.env.SESSION_SECRET || 'talkautomate-ai-session-secret',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));


app.use(require('passport').initialize());

connectDB().then(() => {
  console.log('Database connected.');
});

app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];

      if (!origin || origin === 'null') return callback(null, true);

      if (origin && (origin.includes('localhost:') || origin.includes('127.0.0.1:'))) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS blocked: ' + origin));
      }
    },
    credentials: true,
  }),
);

app.use((req, res, next) => {
  if (req.originalUrl.includes('/webhook/stripe') || req.originalUrl.includes('/webhook/paypal')) {
    next();
  } else {
    express.json({ limit: '50mb' })(req, res, next);
  }
});
app.use((req, res, next) => {
  if (req.originalUrl.includes('/webhook/stripe') || req.originalUrl.includes('/webhook/paypal')) {
    next();
  } else {
    express.urlencoded({ limit: '50mb', extended: true })(req, res, next);
  }
});

// app.use(rtInit);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/widget', express.static(path.join(__dirname, 'public/widget')));
// app.use('/install', express.static(path.join(__dirname, 'public/install')));

// const { initializeInstaller, createInstallationMiddleware } = require('./lib/install');
try {
  // initializeInstaller(app);
  console.log('Installer initialized');
} catch (err) {
  console.error('Failed to initialize installer:', err);
}

// app.use(createInstallationMiddleware());

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const faqRoutes = require('./routes/faq.routes');
const inquiryRoutes = require('./routes/contact-inquiries.routes');
const settingRoutes = require('./routes/setting.routes');
const pageRoutes = require('./routes/page.routes');
const roleRoutes = require('./routes/role.routes');
const languageRoutes = require('./routes/language.routes');
const blogRoutes = require('./routes/blog.routes');
const planRoutes = require('./routes/plan.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const webhookRoutes = require('./routes/webhook.routes');
const paymentGatewayConfigRoutes = require('./routes/payment-gateway-config.routes');
const userSettingsRoutes = require('./routes/user-settings.routes');
const appointmentSettingRoutes = require('./routes/appointment-setting.routes');
const testimonialRoutes = require('./routes/testimonial.routes');
const voiceRoutes = require('./routes/voice.routes');
const categoryRoutes = require('./routes/template-category');
const templateRoutes = require('./routes/template.routes');
const knowledgeBaseRoutes = require('./routes/knowledge-base.routes');
const agentRoutes = require('./routes/agent.routes');
const flowRoutes = require('./routes/flow.routes');
const phoneNumberRoutes = require('./routes/phone-number.routes');
const sipTrunkRoutes = require('./routes/sip-trunk.routes');
const blogCategoryRoutes = require('./routes/blog-category.routes');
const blogTagRoutes = require('./routes/blog-tag.routes');
const smsInboxRoutes = require('./routes/sms-inbox.routes');
const campaignTypeRoutes = require('./routes/campaign-type.routes')
const campaignRoutes = require('./routes/campaign.routes');
const callRoutes = require('./routes/call.routes');
const appointmentRoutes = require('./routes/appointment.routes');
const aiModelRoutes = require('./routes/ai-model.routes');
const contactRoutes = require('./routes/contact.routes');
const formRoutes = require('./routes/form.routes');
const widgetRoutes = require('./routes/widget.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const whatsappCallRoutes = require('./routes/whatsapp-call.routes');
const whatsappTemplateRoutes = require('./routes/whatsapp-template.routes');
const automationRoutes = require('./routes/automation.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const landingPageRoutes = require('./routes/landing-page.routes');
const uploadRoutes = require('./routes/upload.routes');
const apiKeyRoutes = require('./routes/api-key.routers');
const googleRoutes = require('./routes/google.routes');
const googleSheetRoutes = require('./routes/google-sheet.routes');
const googleCalendarRoutes = require('./routes/google-calendar.routes');
const tenantGuideRoutes = require('./routes/tenant-guide.routes');
const notificationRoutes = require('./routes/notification.routes');
const creditRoutes = require('./routes/credit.routes');
const contactGroupRoutes = require('./routes/contact-groups.routes');
const teamRoutes = require('./routes/team.routes');
const teamMemberRoutes = require('./routes/teamMember.routes');
const smsTemplateRoutes = require('./routes/sms-template.routes');
const smsCampaignRoutes = require('./routes/sms-campaign.routes');
const smsAgentRoutes = require('./routes/sms-agent.routes');
const cookieRoutes = require('./routes/cookie.routes');
const systemEmailTemplateRoutes = require('./routes/system-email-template.routes');
const restrictedWordsRoutes = require('./routes/restricted-words.routes');
const numberPurchaseRoutes = require('./routes/number-purchase.routes');
const emailTemplateRoutes = require('./routes/email-template.routes');
const eventWebhookRoutes = require('./routes/event-webhook.routes');
const impersonateRoutes = require('./routes/impersonation.routes');
const dialerRoutes = require('./routes/dialer.routes');

const { denyMutationInDemo } = require('./middlewares/demo-mode');
const { checkImpersonationStatus, restrictImpersonationActions } = require('./middlewares/impersonation');

require('./cron/checkExpiredSubscriptions');
require('./cron/checkExpiredPhoneNumbers');

app.use('/api', denyMutationInDemo);
app.use('/api', checkImpersonationStatus, restrictImpersonationActions);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/faq', faqRoutes);
app.use('/api/inquiry', inquiryRoutes);
app.use('/api/setting', settingRoutes);
app.use('/api/page', pageRoutes);
app.use('/api/role', roleRoutes);
app.use('/api/language', languageRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/plan', planRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/payment-gateway-config', paymentGatewayConfigRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/user-setting', userSettingsRoutes);
app.use('/api/appointment-setting', appointmentSettingRoutes);
app.use('/api/testimonial', testimonialRoutes);
app.use('/api/voices', voiceRoutes);
app.use('/api/category', categoryRoutes);
app.use('/api/template', templateRoutes);
app.use('/api/knowledge-base', knowledgeBaseRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/flows', flowRoutes);
app.use('/api/phone-numbers', phoneNumberRoutes);
app.use('/api/sip-trunks', sipTrunkRoutes);
app.use('/api/blog-category', blogCategoryRoutes);
app.use('/api/blog-tag', blogTagRoutes);
app.use('/api/sms-inbox', smsInboxRoutes);
app.use('/api/campaign-type', campaignTypeRoutes)
app.use('/api/campaigns', campaignRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/ai-models', aiModelRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/widgets', widgetRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/whatsapp-calls', whatsappCallRoutes);
app.use('/api/whatsapp-template', whatsappTemplateRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/landing-page', landingPageRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/api-keys', apiKeyRoutes)
app.use('/api/tenant-guide', tenantGuideRoutes)
app.use('/api/google', googleRoutes);
app.use('/api/google-sheets', googleSheetRoutes);
app.use('/api/google-calendars', googleCalendarRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/credits', creditRoutes);
app.use('/api/contact-groups', contactGroupRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/team-members', teamMemberRoutes);
app.use('/api/sms-templates', smsTemplateRoutes);
app.use('/api/sms-campaigns', smsCampaignRoutes)
app.use('/api/sms-agents', smsAgentRoutes);
app.use('/api/cookie', cookieRoutes);
app.use('/api/system-email-templates', systemEmailTemplateRoutes);
app.use('/api/restricted-words', restrictedWordsRoutes);
app.use('/api/number-purchase', numberPurchaseRoutes);
app.use('/api/email-library', emailTemplateRoutes);
app.use('/api/event-webhooks', eventWebhookRoutes);
app.use('/api/impersonate', impersonateRoutes);
app.use('/api/dialer', dialerRoutes);

app.get("/", (req, res) => {
  res.json({ message: "App is running successfully" });
});

app.get('/api/demo', async (req, res) => {
  const Setting = require('./models/setting.model');
  const settings = await Setting.findOne().select('demo_user_email demo_user_password is_demo_mode').lean();
  const isDemo = settings?.is_demo_mode == true;
  if (!isDemo) {
    return res.json({ demo: false });
  }

  try {
    const User = require('./models/user.model');
    const adminUser = await User.findOne({ role: { $in: ['super_admin', 'admin'] } }).select('email').lean();

    return res.json({
      demo: true,
      admin: {
        email: adminUser?.email || process.env.ADMIN_EMAIL || '',
        password: process.env.ADMIN_PASSWORD || '',
      },
      user: {
        email: settings?.demo_user_email || '',
        password: settings?.demo_user_password || '',
      },
    });
  } catch (err) {
    console.error('Demo endpoint error:', err);
    return res.json({
      demo: true,
      admin: {
        email: process.env.ADMIN_EMAIL || '',
        password: process.env.ADMIN_PASSWORD || '',
      },
      user: { email: '', password: '' },
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: 'The requested resource was not found', path: req.path });
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

module.exports = app;
