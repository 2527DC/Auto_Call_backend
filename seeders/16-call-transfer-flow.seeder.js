'use strict';

module.exports = {
  up: async ({ db }) => {
    const User = db.User;
    const Flow = db.Flow;
    const Role = db.Role;
    const TeamMember = db.TeamMember;

    const superAdminRole = await Role.findOne({ name: 'super_admin' });
    if (!superAdminRole) {
      console.log('Super admin role not found, skipping Virtual Receptionist flow seeding');
      return;
    }

    const admin = await User.findOne({ roleId: superAdminRole._id });
    if (!admin) {
      console.log('Super admin user not found, skipping Virtual Receptionist flow seeding');
      return;
    }

    const existingFlow = await Flow.findOne({ name: 'Virtual Receptionist', user_id: admin._id });
    if (existingFlow) {
      console.log('Virtual Receptionist flow already exists');
      return;
    }

    const flowData = {
      user_id: admin._id,
      name: 'Virtual Receptionist',
      description: 'Welcomes callers, determines their purpose, and routes them to the correct team. Contains a default fallback for unmatched requests.',
      nodes: [
        {
          id: 'node-1',
          type: 'message_output',
          position: { x: -1599.7818181818182, y: -61.372727272727275 },
          data: {
            description: 'Welcome! Thank you for reaching out to us. How can I assist you today?',
            type: 'message_output'
          }
        },
        {
          id: 'node-2',
          type: 'input_capture',
          position: { x: -1084.4363636363637, y: 15.272727272727252 },
          data: {
            description: 'Please let me know the reason for your call so I can route you to the correct department.',
            wait_for_response: true,
            type: 'input_capture'
          }
        },
        {
          id: 'node-3',
          type: 'decision_split',
          position: { x: -486, y: -2 },
          data: {
            description: 'Does the caller need to speak with a human agent?',
            condition: 'The caller is asking to speak to support, sales, or any human representative.',
            true_branch: 'node-4',
            false_branch: 'node-5',
            type: 'decision_split'
          }
        },
        {
          id: 'node-4',
          type: 'redirect_call',
          position: { x: -62, y: -148 },
          data: {
            description: 'Transferring you to an available representative now. Please stay on the line.',
            member_id: null,
            phone_number: '',
            type: 'redirect_call'
          }
        },
        {
          id: 'node-5',
          type: 'message_output',
          position: { x: -62, y: 358 },
          data: {
            description: "I'm sorry, I couldn't understand your request. Please try calling back later.",
            type: 'message_output'
          }
        },
        {
          id: 'node-6',
          type: 'terminate_call',
          position: { x: 362, y: 46 },
          data: {
            description: 'Goodbye!',
            type: 'terminate_call'
          }
        }
      ],
      edges: [
        { id: 'e1-2', source: 'node-1', target: 'node-2', sourceHandle: null, targetHandle: null },
        { id: 'e2-3', source: 'node-2', target: 'node-3', sourceHandle: null, targetHandle: null },
        { id: 'xy-edge__node-3true-node-4', source: 'node-3', target: 'node-4', sourceHandle: 'true', targetHandle: null },
        { id: 'xy-edge__node-3false-node-5', source: 'node-3', target: 'node-5', sourceHandle: 'false', targetHandle: null },
        { id: 'e5-6', source: 'node-5', target: 'node-6', sourceHandle: null, targetHandle: null }
      ],
      status: 'active',
      system_flow: true
    };

    await Flow.create(flowData);
    console.log('Virtual Receptionist flow seeded');
  }
};
