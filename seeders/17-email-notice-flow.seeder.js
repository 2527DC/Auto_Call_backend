'use strict';

module.exports = {
  up: async ({ db }) => {
    const User = db.User;
    const Flow = db.Flow;
    const Role = db.Role;
    const EmailTemplate = db.EmailTemplate;

    const superAdminRole = await Role.findOne({ name: 'super_admin' });
    if (!superAdminRole) {
      console.log('Super admin role not found, skipping email notice flow seeding');
      return;
    }

    const admin = await User.findOne({ roleId: superAdminRole._id });
    if (!admin) {
      console.log('Super admin user not found, skipping email notice flow seeding');
      return;
    }

    let emailTemplate = await EmailTemplate.findOne({ name: 'Welcome Email Template', user_id: admin._id });
    if (!emailTemplate) {
      emailTemplate = await EmailTemplate.create({
        user_id: admin._id,
        name: 'Welcome Email Template',
        subject: 'Welcome to our platform!',
        body: '<p>Hi there,</p><p>Thank you for joining our platform. We are excited to have you.</p><p>Best,<br>The Team</p>',
        type: 'standard',
        is_active: true
      });
      console.log('Welcome Email Template seeded');
    } else {
      console.log('Welcome Email Template already exists');
    }

    const existingFlow = await Flow.findOne({ name: 'Email Notification Flow', user_id: admin._id });
    if (existingFlow) {
      console.log('Email Notification Flow already exists');
      return;
    }

    const flowData = {
      user_id: admin._id,
      name: 'Email Notification Flow',
      description: 'A system flow that demonstrates sending an email notification using an email template.',
      nodes: [
        {
          id: 'node-1',
          type: 'message_output',
          position: { x: -288.09842251328143, y: 176.84502970482737 },
          data: {
            description: 'Hello! I am going to send you a welcome email now.',
            type: 'message_output'
          }
        },
        {
          id: 'node-2',
          type: 'email_notice',
          position: { x: 135.3550844579183, y: 291.5587818840046 },
          data: {
            description: 'Sending welcome email...',
            template_id: emailTemplate._id,
            email: '',
            type: 'email_notice'
          }
        },
        {
          id: 'node-3',
          type: 'terminate_call',
          position: { x: 591.0686237376932, y: 163.54486169445644 },
          data: {
            description: 'The email has been sent. Goodbye!',
            type: 'terminate_call'
          }
        }
      ],
      edges: [
        { id: 'e1-2', source: 'node-1', target: 'node-2', sourceHandle: null, targetHandle: null },
        { id: 'e2-3', source: 'node-2', target: 'node-3', sourceHandle: null, targetHandle: null }
      ],
      status: 'active',
      system_flow: true
    };

    await Flow.create(flowData);
    console.log('Email Notification Flow seeded');
  }
};
