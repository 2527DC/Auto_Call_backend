'use strict';

module.exports = {
  up: async ({ db }) => {
    const User = db.User;
    const Flow = db.Flow;
    const Role = db.Role;

    const superAdminRole = await Role.findOne({ name: 'super_admin' });
    if (!superAdminRole) {
      console.log('Super admin role not found, skipping appointment flow seeding');
      return;
    }

    const admin = await User.findOne({ roleId: superAdminRole._id });
    if (!admin) {
      console.log('Super admin user not found, skipping appointment flow seeding');
      return;
    }

    const existingFlow = await Flow.findOne({ name: 'Default Appointment Booking', user_id: admin._id });
    if (existingFlow) {
      console.log('Default Appointment Booking flow already exists');
      return;
    }

    const flowData = {
      user_id: admin._id,
      name: 'Default Appointment Booking',
      description: 'Standard flow for booking appointments via AI call',
      nodes: [
        {
          id: 'node-1',
          type: 'message_output',
          position: { x: 250, y: 0 },
          data: {
            description: 'Hi! Thank you for calling. I can help you schedule an appointment.'
          }
        },
        {
          id: 'node-2',
          type: 'book_slot',
          position: { x: 250, y: 100 },
          data: { 
            description: 'May I have your full name and preferred date for the appointment?',
            wait_for_response: true,
            send_google_meet_link: true,
            google_sheet_id: '',
            google_calendar_id: ''
          }
        },
        {
          id: 'node-3',
          type: 'message_output',
          position: { x: 250, y: 200 },
          data: {
            description: 'Perfect! Your appointment has been confirmed. You will receive a notification shortly.'
          }
        },
        {
          id: 'node-4',
          type: 'whatsapp_notice',
          position: { x: 250, y: 300 },
          data: {
            description: 'Sending WhatsApp notification...',
            template_id: ''
          }
        },
        {
          id: 'node-5',
          type: 'terminate_call',
          position: { x: 250, y: 400 },
          data: {
            description: 'Thank you for scheduling with us! Have a great day.'
          }
        }
      ],
      edges: [
        { id: 'e1-2', source: 'node-1', target: 'node-2' },
        { id: 'e2-3', source: 'node-2', target: 'node-3' },
        { id: 'e3-4', source: 'node-3', target: 'node-4' },
        { id: 'e4-5', source: 'node-4', target: 'node-5' }
      ],
      status: 'active',
      system_flow: true
    };

    await Flow.create(flowData);
    console.log('Default Appointment Booking flow seeded');
  }
};
