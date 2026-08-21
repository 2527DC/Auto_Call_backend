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

    let feedbackForm = await Form.findOne({ name: 'Customer Feedback Form', user_id: admin._id });
    if (!feedbackForm) {
      feedbackForm = await Form.create({
        user_id: admin._id,
        name: 'Customer Feedback Form',
        description: 'Collect customer ratings and comments',
        fields: [
          {
            label: 'Customer Rating',
            key: 'customer_rating',
            question: 'Please rate our service from 1 to 5.',
            required: true,
            type: 'number'
          },
          {
            label: 'Customer Comment',
            key: 'customer_comment',
            question: 'Please share your feedback about our service.',
            required: false,
            type: 'text'
          }
        ]
      });
      console.log('Customer Feedback Form created');
    }

    const existingFlow = await Flow.findOne({
      name: 'Customer Feedback Collection',
      user_id: admin._id
    });

    if (existingFlow) {
      await Flow.deleteOne({ _id: existingFlow._id });
    }

    const flowData = {
      user_id: admin._id,
      name: 'Customer Feedback Collection',
      description: 'Collect customer feedback through audio interaction and store responses for analysis.',
      nodes: [
        {
          id: 'node-1',
          type: 'audio_playback',
          position: { x: -519, y: -90 },
          data: {
            audio_url: '/uploads/welcome-message.mp3',
            description: 'Welcome! We would like to collect your valuable feedback.'
          }
        },
        {
          id: 'node-2',
          type: 'data_capture',
          position: { x: -12, y: -227 },
          data: {
            form_id: feedbackForm._id,
            wait_for_response: true,
            description: 'Capture customer rating',
            google_sheet_id: null
          }
        },
        {
          id: 'node-3',
          type: 'variable_map',
          position: { x: -65, y: 498 },
          data: {
            variables: [
              { key: 'feedback_score', value: 'customer_rating' }
            ],
            description: 'Map rating to score'
          }
        },
        {
          id: 'node-4',
          type: 'data_capture',
          position: { x: 333, y: 513 },
          data: {
            form_id: feedbackForm._id,
            wait_for_response: true,
            description: 'Capture customer comment',
            google_sheet_id: null
          }
        },
        {
          id: 'node-5',
          type: 'decision_split',
          position: { x: 552, y: -112 },
          data: {
            condition: 'feedback_score >= 4',
            description: 'Check score'
          }
        },
        {
          id: 'node-6',
          type: 'message_output',
          position: { x: 965, y: -175 },
          data: {
            description: 'Thank you for your positive feedback.'
          }
        },
        {
          id: 'node-7',
          type: 'team_alert',
          position: { x: 1228, y: 42 },
          data: {
            message: 'Positive customer feedback received.',
            description: 'Alert Team'
          }
        },
        {
          id: 'node-8',
          type: 'message_output',
          position: { x: 882, y: 722 },
          data: {
            description: 'Thank you for your feedback. We will work on improving our service.'
          }
        },
        {
          id: 'node-9',
          type: 'terminate_call',
          position: { x: 1190, y: 334 },
          data: {
            description: 'Thank you for your time. Goodbye!'
          }
        }
      ],
      edges: [
        { id: 'e1-2', source: 'node-1', target: 'node-2' },
        { id: 'e2-3', source: 'node-2', target: 'node-3' },
        { id: 'e3-4', source: 'node-3', target: 'node-4' },
        { id: 'e4-5', source: 'node-4', target: 'node-5' },
        {
          id: 'xy-edge__node-5true-node-6',
          source: 'node-5',
          target: 'node-6',
          sourceHandle: 'true'
        },
        {
          id: 'xy-edge__node-5false-node-8',
          source: 'node-5',
          target: 'node-8',
          sourceHandle: 'false'
        },
        { id: 'xy-edge__node-6-node-7', source: 'node-6', target: 'node-7' },
        { id: 'xy-edge__node-7-node-9', source: 'node-7', target: 'node-9' },
        { id: 'e8-9', source: 'node-8', target: 'node-9' }
      ],
      status: 'active',
      system_flow: true
    };

    await Flow.create(flowData);
    console.log('Customer Feedback Collection flow seeded');
  }
};