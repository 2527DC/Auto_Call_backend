'use strict';

module.exports = {
  up: async ({ db }) => {
    const User = db.User;
    const Flow = db.Flow;
    const Role = db.Role;
    const Form = db.Form;

    const superAdminRole = await Role.findOne({ name: 'super_admin' });
    if (!superAdminRole) return;

    const admin = await User.findOne({ roleId: superAdminRole._id });
    if (!admin) return;

    let regForm = await Form.findOne({ name: 'Tech Conference Registration', user_id: admin._id });
    if (!regForm) {
      regForm = await Form.create({
        user_id: admin._id,
        name: 'Tech Conference Registration',
        description: 'Collect details for the upcoming Tech Conference',
        fields: [
          {
            label: 'Attendee Name',
            key: 'attendee_name',
            question: 'What is the full name of the attendee?',
            required: true,
            type: 'text'
          },
          {
            label: 'Email Address',
            key: 'email',
            question: 'What is your email address for sending the ticket?',
            required: true,
            type: 'email'
          },
          {
            label: 'Dietary Requirements',
            key: 'dietary',
            question: 'Do you have any dietary requirements we should know about?',
            required: false,
            type: 'text'
          }
        ]
      });
    }
    const existingFlow = await Flow.findOne({ name: 'Event Registration Flow', user_id: admin._id });
    if (existingFlow) return;

    const flowData = {
      user_id: admin._id,
      name: 'Event Registration Flow',
      description: 'Flow for event registration via AI call',
      nodes: [
        {
          id: 'node-1',
          type: 'message_output',
          position: { x: 250, y: 0 },
          data: {
            description: 'Hello! I am calling to help you register for the upcoming Tech Conference.'
          }
        },
        {
          id: 'node-2',
          type: 'data_capture',
          position: { x: 250, y: 100 },
          data: {
            form_id: regForm._id,
            confirmation_message: 'Excellent! Your registration is complete. You will receive an email with your ticket shortly.',
            description: 'Excellent! Your registration is complete. You will receive an email with your ticket shortly.',
            wait_for_response: true,
            google_sheet_id: null
          }
        },
        {
          id: 'node-3',
          type: 'terminate_call',
          position: { x: 250, y: 200 },
          data: {
            description: 'Thank you for registering! We look forward to seeing you there.'
          }
        }
      ],
      edges: [
        { id: 'e1-2', source: 'node-1', target: 'node-2' },
        { id: 'e2-3', source: 'node-2', target: 'node-3' }
      ],
      status: 'active',
      system_flow: true
    };

    await Flow.create(flowData);
    console.log('Event Registration flow seeded');
  }
};
