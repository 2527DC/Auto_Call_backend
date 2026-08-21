'use strict';

module.exports = {
  up: async ({ db }) => {
    const User = db.User;
    const Flow = db.Flow;
    const Role = db.Role;

    const superAdminRole = await Role.findOne({ name: 'super_admin' });
    if (!superAdminRole) return;

    const admin = await User.findOne({ roleId: superAdminRole._id });
    if (!admin) return;

    const existingFlow = await Flow.findOne({
      name: 'Customer Verification Flow',
      user_id: admin._id
    });

    if (existingFlow) return;

    console.log('Creating Customer Verification Flow');

    const flowData = {
      user_id: admin._id,
      name: 'Customer Verification Flow',
      description: 'Verify customer identity and collect required information through AI voice interaction.',
      nodes: [
        {
          id: 'node-1',
          type: 'message_output',
          position: { x: -338, y: -26 },
          data: {
            description: 'Hello! Welcome to our verification service, Please tell me your name first.'
          }
        },
        {
          id: 'node-2',
          type: 'data_capture',
          position: { x: 81, y: -33 },
          data: {
            field: 'full_name',
            question: 'Please tell me your full name.',
            description: 'Please tell me your full name.',
            google_sheet_id: null
          }
        },
        {
          id: 'node-3',
          type: 'message_output',
          position: { x: 498, y: -50 },
          data: {
            description: 'Thanks for sharing your name, Now I want to know the invoice number.'
          }
        },
        {
          id: 'node-4',
          type: 'data_capture',
          position: { x: 898, y: -126 },
          data: {
            field: 'invoice_number',
            question: 'Please provide your invoice number.',
            description: 'Please provide your invoice number.',
            google_sheet_id: null
          }
        },
        {
          id: 'node-5',
          type: 'decision_split',
          position: { x: -204, y: 313 },
          data: {
            condition: 'invoice_verified'
          }
        },
        {
          id: 'node-6',
          type: 'message_output',
          position: { x: 318, y: 245 },
          data: {
            description: 'Your identity has been successfully verified.'
          }
        },
        {
          id: 'node-7',
          type: 'team_alert',
          position: { x: 783, y: 236 },
          data: {
            message: 'Customer successfully verified.'
          }
        },
        {
          id: 'node-8',
          type: 'message_output',
          position: { x: 390, y: 498 },
          data: {
            description: 'We could not verify your information. Please try again later.'
          }
        },
        {
          id: 'node-9',
          type: 'terminate_call',
          position: { x: 1038, y:430 },
          data: {
            description: ""
          }
        }
      ],
      edges: [
        {
          id: 'e1-2',
          source: 'node-1',
          target: 'node-2'
        },
        {
          id: 'e2-3',
          source: 'node-2',
          target: 'node-3'
        },
        {
          id: 'e3-4',
          source: 'node-3',
          target: 'node-4'
        },
        {
          id: 'e4-5',
          source: 'node-4',
          target: 'node-5'
        },
        {
          id: 'e5-6',
          source: 'node-5',
          target: 'node-6',
          sourceHandle: 'true'
        },
        {
          id: 'xy-edge__node-4true-node-5',
          source: 'node-4',
          target: 'node-5',
          sourceHandle: 'true'
        },
        {
          id: 'xy-edge__node-5false-node-8',
          source: 'node-5',
          target: 'node-8',
          sourceHandle: 'false'
        },
        {
          id: 'xy-edge__node-6-node-7',
          source: 'node-6',
          target: 'node-7',
          sourceHandle: ''
        },
        {
          id: 'xy-edge__node-7-node-9',
          source: 'node-7',
          target: 'node-9'
        },
        {
          id: 'xy-edge__node-8-node-9',
          source: 'node-8',
          target: 'node-9'
        },
        {
          id : 'xy-edge__node-5-node-6',
          source : 'node-5',
          target : 'node-6'
        }
      ],
      status: 'active'
    };

    await Flow.create(flowData);

    console.log('Customer Verification Flow seeded');
  }
};