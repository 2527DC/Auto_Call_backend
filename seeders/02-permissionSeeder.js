require('dotenv').config();

const bcrypt = require('bcryptjs');

const modules = {
  dashboard: {
    actions: { view: 'view.dashboard' },
    roles: { ADMIN: ['view'], USER: ['view'] }
  },
  adminDashboard: {
    actions: { view: 'view.admin_dashboard' },
    roles: { ADMIN: ['view'] }
  },
  teamMemberDashboard: {
    actions: { view: 'view.team_member_dashboard' },
    roles: { USER: ['view'] }
  },
  members: {
    actions: {
      view: 'view.members',
      create: 'create.members',
      update: 'update.members',
      delete: 'delete.members',
    },
    roles: { ADMIN: ['view', 'create', 'update', 'delete'] }
  },
  roles: {
    actions: {
      view: 'view.roles',
      create: 'create.roles',
      update: 'update.roles',
      delete: 'delete.roles',
    },
    roles: { ADMIN: ['view', 'create', 'update', 'delete'] }
  },
  teams: {
    actions: {
      view: 'view.teams',
      create: 'create.teams',
      update: 'update.teams',
      delete: 'delete.teams',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete']
    }
  },
  plans: {
    actions: {
      view: 'view.plans',
      create: 'create.plans',
      update: 'update.plans',
      delete: 'delete.plans',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view'],
    }
  },
  subscriptions: {
    actions: {
      view: 'view.subscriptions',
      create: 'create.subscriptions',
      update: 'update.subscriptions',
    },
    roles: {
      ADMIN: ['view', 'create', 'update'],
      USER: ['view', 'create', 'update'],
    }
  },
  faqs: {
    actions: {
      view: 'view.faqs',
      create: 'create.faqs',
      update: 'update.faqs',
      delete: 'delete.faqs',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view'],
    }
  },
  languages: {
    actions: {
      view: 'view.languages',
      create: 'create.languages',
      update: 'update.languages',
      delete: 'delete.languages',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view'],
    }
  },
  contactInquiries: {
    actions: {
      view: 'view.contact_inquiries',
      delete: 'delete.contact_inquiries',
    },
    roles: {
      ADMIN: ['view', 'delete'],
    }
  },
  pages: {
    actions: {
      view: 'view.pages',
      create: 'create.pages',
      update: 'update.pages',
      delete: 'delete.pages',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view'],
    }
  },
  blogs: {
    actions: {
      view: 'view.blogs',
      create: 'create.blogs',
      update: 'update.blogs',
      delete: 'delete.blogs',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view'],
    }
  },
  settings: {
    actions: { view: 'view.settings', update: 'update.settings' },
    roles: {
      ADMIN: ['view', 'update'],
      USER: ['view'],
    }
  },
  userSettings: {
    actions: { view: 'view.user_settings', update: 'update.user_settings' },
    roles: {
      ADMIN: ['view', 'update'],
      USER: ['view', 'update'],
    }
  },
  paymentHistory: {
    actions: {
      view: 'view.payment_history',
    },
    roles: {
      ADMIN: ['view'],
      USER: ['view'],
    }
  },
  testimonials: {
    actions: {
      view: 'view.testimonials',
      create: 'create.testimonials',
      update: 'update.testimonials',
      delete: 'delete.testimonials',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view'],
    }
  },
  knowledgeBase: {
    actions: {
      view: 'view.knowledge_base',
      create: 'create.knowledge_base',
      update: 'update.knowledge_base',
      delete: 'delete.knowledge_base',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  agents: {
    actions: {
      view: 'view.agents',
      create: 'create.agents',
      update: 'update.agents',
      delete: 'delete.agents',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  flows: {
    actions: {
      view: 'view.flows',
      create: 'create.flows',
      update: 'update.flows',
      delete: 'delete.flows',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  phoneNumbers: {
    actions: {
      view: 'view.phone_numbers',
      create: 'create.phone_numbers',
      update: 'update.phone_numbers',
      delete: 'delete.phone_numbers',
      assign_price: 'assign_price.phone_numbers',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete', 'assign_price'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  voices: {
    actions: {
      view: 'view.voices',
      sync: 'sync.voices',
      synthesize: 'synthesize.voices',
    },
    roles: {
      ADMIN: ['view', 'sync', 'synthesize'],
      USER: ['view', 'synthesize'],
    }
  },
  templates: {
    actions: {
      view: 'view.templates',
      create: 'create.templates',
      update: 'update.templates',
      delete: 'delete.templates',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view'],
    }
  },
  emailTemplates: {
    actions: {
      view: 'view.email_templates',
      create: 'create.email_templates',
      update: 'update.email_templates',
      delete: 'delete.email_templates',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  whatsappTemplates: {
    actions: {
      view: 'view.whatsapp_template',
      create: 'create.whatsapp_template',
      update: 'update.whatsapp_template',
      delete: 'delete.whatsapp_template',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  blogCategories: {
    actions: {
      view: 'view.blog_categories',
      create: 'create.blog_categories',
      update: 'update.blog_categories',
      delete: 'delete.blog_categories',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete']
    }
  },
  blogTags: {
    actions: {
      view: 'view.blog_tags',
      create: 'create.blog_tags',
      update: 'update.blog_tags',
      delete: 'delete.blog_tags',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete']
    }
  },
  paymentGatewayConfig: {
    actions: {
      view: 'view.payment_gateway_config',
      update: 'update.payment_gateway_config',
    },
    roles: {
      ADMIN: ['view', 'update'],
    }
  },
  templateCategories: {
    actions: {
      view: 'view.template_categories',
      create: 'create.template_categories',
      update: 'update.template_categories',
      delete: 'delete.template_categories',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view'],
    }
  },
  calls: {
    actions: {
      view: 'view.calls',
      create: 'create.calls',
      handleTransfer: 'handleTransfer.calls',
      activity: 'activity.calls'
    },
    roles: {
      ADMIN: ['view', 'create', 'handleTransfer', 'activity'],
      USER: ['view', 'create', 'handleTransfer', 'activity'],
    }
  },
  virtualPhone: {
    actions: {
      view: 'view.virtual_phone',
      initiateCall: 'initiateCall.virtual_phone',
    },
    roles: {
      ADMIN: ['view', 'initiateCall'],
      USER: ['view', 'initiateCall']
    }
  },
  aiModels: {
    actions: {
      view: 'view.ai_models',
      create: 'create.ai_models',
      update: 'update.ai_models',
      delete: 'delete.ai_models',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view'],
    }
  },
  campaigns: {
    actions: {
      view: 'view.campaigns',
      create: 'create.campaigns',
      update: 'update.campaigns',
      delete: 'delete.campaigns',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  campaignTypes: {
    actions: {
      view: 'view.campaign_types',
      create: 'create.campaign_types',
      update: 'update.campaign_types',
      delete: 'delete.campaign_types',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  appointments: {
    actions: {
      view: 'view.appointments',
      update: 'update.appointments',
    },
    roles: {
      ADMIN: ['view', 'update'],
      USER: ['view', 'update'],
    }
  },
  forms: {
    actions: {
      view: 'view.forms',
      create: 'create.forms',
      update: 'update.forms',
      delete: 'delete.forms',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  widgets: {
    actions: {
      view: 'view.widgets',
      create: 'create.widgets',
      update: 'update.widgets',
      delete: 'delete.widgets',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  apiKeys: {
    actions: {
      view: 'view.api_keys',
      create: 'create.api_keys',
      regenerate: 'regenerate.api_keys',
      delete: 'delete.api_keys',
      update_status: 'updateStatus.api_keys',
    },
    roles: {
      ADMIN: ['view', 'create', 'regenerate', 'update_status', 'delete'],
      USER: ['view', 'create', 'regenerate', 'delete']
    }
  },
  contacts: {
    actions: {
      view: 'view.contacts',
      create: 'create.contacts',
      update: 'update.contacts',
      delete: 'delete.contacts',
      import: 'import.contacts',
      export: 'export.contacts',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete', 'import', 'export'],
      USER: ['view', 'create', 'update', 'delete', 'import', 'export'],
    }
  },
  automation: {
    actions: {
      view: 'view.automation',
      create: 'create.automation',
    },
    roles: {
      ADMIN: ['view', 'create'],
      USER: ['view', 'create'],
    }
  },
  whatsapp: {
    actions: {
      view: 'view.whatsapp',
      connect: 'connect.whatsapp',
      disconnect: 'disconnect.whatsapp',
    },
    roles: {
      ADMIN: ['view', 'connect', 'disconnect'],
      USER: ['view', 'connect', 'disconnect'],
    }
  },
  Trunks: {
    actions: {
      view: 'view.trunks',
      create: 'create.trunks',
      update: 'update.trunks',
      delete: 'delete.trunks',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  googleAccounts: {
    actions: {
      view: 'view.google_accounts',
      connect: 'connect.google_accounts',
      disconnect: 'disconnect.google_accounts',
    },
    roles: {
      ADMIN: ['view', 'connect', 'disconnect'],
      USER: ['view', 'connect', 'disconnect'],
    }
  },
  googleSheets: {
    actions: {
      view: 'view.google_sheets',
      create: 'create.google_sheets',
      update: 'update.google_sheets',
      delete: 'delete.google_sheets',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  googleCalendars: {
    actions: {
      view: 'view.google_calendars',
      create: 'create.google_calendars',
      update: 'update.google_calendars',
      delete: 'delete.google_calendars',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  tenantGuide: {
    actions: {
      view: 'view.tenant_guide',
      create: 'create.tenant_guide',
      update: 'update.tenant_guide',
      delete: 'delete.tenant_guide',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view']
    }
  },
  contactGroup: {
    actions: {
      view: 'view.contact_group',
      create: 'create.contact_group',
      update: 'update.contact_group',
      delete: 'delete.contact_group',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  smsTemplate: {
    actions: {
      view: 'view.sms_template',
      create: 'create.sms_template',
      update: 'update.sms_template',
      delete: 'delete.sms_template',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  smsCampaign: {
    actions: {
      view: 'view.sms_campaign',
      create: 'create.sms_campaign',
      update: 'update.sms_campaign',
      delete: 'delete.sms_campaign',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  smsAgent: {
    actions: {
      view: 'view.sms_agent',
      create: 'create.sms_agent',
      update: 'update.sms_agent',
      delete: 'delete.sms_agent',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  supportCenter: {
    actions: {
      view: 'view.support_center',
    },
    roles: {
      ADMIN: ['view'],
      USER: ['view'],
    }
  },
  restrictedWords: {
    actions: {
      view: 'view.restricted_words',
      create: 'create.restricted_words',
      update: 'update.restricted_words',
      delete: 'delete.restricted_words',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete']
    }
  },
  smsInbox: {
    actions: {
      view: 'view.sms_inbox',
      assign: 'assign.sms_inbox',
      reply: 'reply.sms_inbox',
    },
    roles: {
      ADMIN: ['view', 'assign', 'reply'],
      USER: ['view', 'assign', 'reply'],
    }
  },
  eventWebhooks: {
    actions: {
      view: 'view.webhooks',
      create: 'create.webhooks',
      update: 'update.webhooks',
      delete: 'delete.webhooks',
    },
    roles: {
      ADMIN: ['view', 'create', 'update', 'delete'],
      USER: ['view', 'create', 'update', 'delete'],
    }
  },
  impersonation: {
    actions: {
      view: 'view.impersonation',
      start: 'start.impersonation',
    },
    roles: {
      ADMIN: ['view', 'start'],
    }
  }
};

const seedPermissions = async (dbConnection, mongoose) => {
  try {
    const Permission = dbConnection.db.Permission;
    const Role = dbConnection.db.Role;
    const RolePermission = dbConnection.db.RolePermission;
    const User = dbConnection.db.User;

    console.log('Seeding permissions...');

    try {
      await Permission.collection.dropIndex('module_1');
    } catch (err) {
    }

    const permissionList = [];
    Object.values(modules).forEach(module => {
      Object.entries(module.actions).forEach(([actionKey, slug]) => {
        const name = slug.split('.').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        permissionList.push({
          name,
          slug,
          description: `Permission to ${actionKey} ${slug.split('.')[1] || ''}`
        });
      });
    });

    const ops = permissionList.map(p => ({
      updateOne: {
        filter: { slug: p.slug },
        update: { $set: p },
        upsert: true
      }
    }));
    await Permission.bulkWrite(ops);

    console.log('Permissions seeded successfully!');

    const allPermissions = await Permission.find().lean();
    const permissionMap = {};
    allPermissions.forEach(p => { permissionMap[p.slug] = p._id; });

    const roleMapping = {
      ADMIN: ['super_admin', 'admin'],
      USER: ['user']
    };

    console.log('Assigning permissions to roles...');

    for (const [key, roleNames] of Object.entries(roleMapping)) {
      for (const roleName of roleNames) {
        const role = await Role.findOne({ name: roleName });
        if (!role) continue;

        const rolePermissionIds = [];
        Object.values(modules).forEach(module => {
          const actions = module.roles[key] || [];
          actions.forEach(actionKey => {
            const slug = module.actions[actionKey];
            if (slug && permissionMap[slug]) {
              rolePermissionIds.push(permissionMap[slug]);
            }
          });
        });

        if (rolePermissionIds.length > 0) {
          await RolePermission.deleteMany({ role_id: role._id });

          const uniqueIds = [...new Set(rolePermissionIds.map(id => id.toString()))];
          const rolePermissionsData = uniqueIds.map(id => ({
            role_id: role._id,
            permission_id: id
          }));

          await RolePermission.insertMany(rolePermissionsData);
          console.log(`Assigned ${rolePermissionsData.length} permissions to role: ${roleName}`);
        }
      }
    }

    console.log('Permission seeding and role assignment completed successfully!');

    const adminEmail = process.env.ADMIN_EMAIL;

    if (!adminEmail) {
      console.log('ADMIN_EMAIL not set, skipping default admin creation');
    } else {
      const existingAdmin = await User.findOne({ email: adminEmail });
      if (!existingAdmin) {
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        const superAdminRole = await Role.findOne({ name: 'super_admin' });

        await User.create({
          name: process.env.ADMIN_NAME || 'Admin',
          email: adminEmail,
          password: hashedPassword,
          roleId: superAdminRole ? superAdminRole._id : null,
          isVerified: true,
          isActive: true,
        });
        console.log(`Default admin created: ${adminEmail}`);
      } else {
        if (!existingAdmin.roleId) {
          const superAdminRole = await Role.findOne({ name: 'super_admin' });
          if (superAdminRole) {
            await User.findByIdAndUpdate(existingAdmin._id, { roleId: superAdminRole._id });
          }
        } else {
          console.log('Default admin already exists.');
        }
      }
    }

    const defaultUserEmail = process.env.DEFAULT_USER_EMAIL;

    if (!defaultUserEmail) {
      console.log('DEFAULT_USER_EMAIL not set, skipping default user creation');
    } else {
      const existingUser = await User.findOne({ email: defaultUserEmail });
      if (!existingUser) {
        const defaultUserPassword = process.env.DEFAULT_USER_PASSWORD || 'user123';
        const hashedPassword = await bcrypt.hash(defaultUserPassword, 10);
        const userRole = await Role.findOne({ name: 'user' });

        await User.create({
          name: process.env.DEFAULT_USER_NAME || 'Default User',
          email: defaultUserEmail,
          password: hashedPassword,
          roleId: userRole ? userRole._id : null,
          isVerified: true,
          isActive: true,
        });
        console.log(`Default user created: ${defaultUserEmail}`);
      } else {
        if (!existingUser.roleId) {
          const userRole = await Role.findOne({ name: 'user' });
          if (userRole) {
            await User.findByIdAndUpdate(existingUser._id, { roleId: userRole._id });
          }
        } else {
          console.log('Default user already exists.');
        }
      }
    }

  } catch (error) {
    console.error('Error seeding permissions:', error);
    throw error;
  }
};

module.exports = { up: seedPermissions };