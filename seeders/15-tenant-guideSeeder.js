require('dotenv').config();

const seedTenantGuides = async (dbConnection, mongoose) => {
  try {
    const TenantGuide = dbConnection.db.TenantGuide;

    console.log('Seeding Tenant Guides...');

    const guidesData = [
      {
        title: 'AI Assistants API',
        description: 'API documentation for managing AI Voice and Flow Assistants programmatically.',
        endpoints: [
          {
            sub_title: 'List AI Assistants',
            sub_description: 'Retrieve a paginated list of all active AI Assistants along with their call analytics.',
            http_method: 'GET',
            url_path: '/api/agents?page=1&limit=10&type=incoming',
            payload: {},
            response: {
              success: true,
              data: [
                {
                  _id: '6a2a9e5e73ccdf947d5091a1',
                  name: 'Sales Assistant',
                  type: 'flow',
                  language: 'en',
                  telephony_provider: 'elevenlabs_twilio',
                  status: 'active',
                  analytics: { total_calls: 15, success_rate: 85.5, avg_duration: 120, total_credits: 30 }
                },
                {
                  _id: '6a2a9e5e73ccdf947d5091a2',
                  name: 'Support Bot',
                  type: 'incoming',
                  language: 'en',
                  telephony_provider: 'elevenlabs_twilio',
                  status: 'active',
                  analytics: { total_calls: 42, success_rate: 92.1, avg_duration: 85, total_credits: 42 }
                }
              ],
              total: 2,
              page: 1,
              limit: 10
            }
          },
          {
            sub_title: 'Get AI Assistant by ID',
            sub_description: 'Retrieve detailed information about a specific AI Assistant.',
            http_method: 'GET',
            url_path: '/api/agents/:id',
            payload: {},
            response: {
              success: true,
              data: {
                _id: '6a2a9e5e73ccdf947d5091a1',
                name: 'Sales Assistant',
                type: 'flow',
                language: 'en',
                status: 'active'
              }
            }
          },
          {
            sub_title: 'Create AI Assistant',
            sub_description: 'Create a new incoming or flow-based AI Assistant.',
            http_method: 'POST',
            url_path: '/api/agents/create',
            payload: {
              name: 'Support Bot',
              type: 'incoming',
              voice_id: 'EXAVITQu4vr4xnSDxMaL',
              language: 'en',
              llm_model: '6a2a9e5e73ccdf947d5091a3',
              system_prompt: 'You are a helpful customer support agent.',
              telephony_provider: 'elevenlabs_twilio',
              speech_speed: 1.0,
              pitch: 0,
              empathy_level: 'medium',
              energy_level: 'balanced',
              response_length: 'balanced',
              enable_call_recording: true
            },
            response: {
              success: true,
              message: 'Agent created successfully',
              data: {
                _id: '6a2a9e5e73ccdf947d5091a4',
                name: 'Support Bot',
                type: 'incoming',
                status: 'active'
              }
            }
          },
          {
            sub_title: 'Update AI Assistant',
            sub_description: 'Update an existing AI Assistant configuration.',
            http_method: 'PUT',
            url_path: '/api/agents/:id',
            payload: {
              name: 'Updated Support Bot',
              system_prompt: 'You are a technical support agent.'
            },
            response: {
              success: true,
              message: 'Agent updated successfully',
              data: {
                _id: '6a2a9e5e73ccdf947d5091a4',
                name: 'Updated Support Bot',
                status: 'active'
              }
            }
          },
          {
            sub_title: 'Delete AI Assistant',
            sub_description: 'Delete a single AI Assistant.',
            http_method: 'DELETE',
            url_path: '/api/agents/:id',
            payload: {},
            response: {
              success: true,
              message: 'Agent deleted successfully'
            }
          }
        ],
        is_system: true,
        is_active: true
      },
      {
        title: 'AI Campaign Hub API',
        description: 'API documentation for managing and automating AI Voice Campaigns. Note: Create and Update endpoints require multipart/form-data if uploading a CSV contact file.',
        endpoints: [
          {
            sub_title: 'List Campaigns',
            sub_description: 'Retrieve a paginated list of all AI campaigns for your account.',
            http_method: 'GET',
            url_path: '/api/campaigns?page=1&limit=10',
            payload: {},
            response: {
              success: true,
              data: [
                {
                  _id: '6a2a9e5e73ccdf947d5091b1',
                  name: 'Holiday Outreach Campaign',
                  campaignStatus: 'Draft',
                  agentId: { _id: '6a2a9e5e73ccdf947d5091a1', name: 'Sales Assistant' },
                  typeId: { _id: '6a2a9e5e73ccdf947d5091c1', name: 'Voice Campaign' }
                },
                {
                  _id: '6a2a9e5e73ccdf947d5091b2',
                  name: 'Product Launch Q3',
                  campaignStatus: 'Active',
                  agentId: { _id: '6a2a9e5e73ccdf947d5091a2', name: 'Support Bot' },
                  typeId: { _id: '6a2a9e5e73ccdf947d5091c1', name: 'Voice Campaign' }
                }
              ],
              pagination: { total: 2, page: 1, pages: 1 }
            }
          },
          {
            sub_title: 'Get Campaign by ID',
            sub_description: 'Retrieve detailed information about a specific campaign.',
            http_method: 'GET',
            url_path: '/api/campaigns/:id',
            payload: {},
            response: {
              success: true,
              data: {
                _id: '6a2a9e5e73ccdf947d5091b1',
                name: 'Holiday Outreach Campaign',
                campaignStatus: 'Draft'
              }
            }
          },
          {
            sub_title: 'Get Campaign History',
            sub_description: 'Retrieve call metrics and history for a specific campaign.',
            http_method: 'GET',
            url_path: '/api/campaigns/:id/history',
            payload: {},
            response: {
              success: true,
              data: {
                campaign: {
                  _id: '6a2a9e5e73ccdf947d5091b1',
                  name: 'Holiday Outreach Campaign',
                  campaignStatus: 'Active',
                  created_at: '2026-06-10T10:00:00.000Z'
                },
                agent: { _id: '6a2a9e5e73ccdf947d5091a1', name: 'Sales Assistant' },
                metrics: { totalLeads: 100, completedCount: 85, avgDuration: 120, successRate: 85 },
                calls: [
                  { _id: '6a2a9e5e73ccdf947d5091d1', lead_name: 'John Doe', to_number: '+1234567890', status: 'completed', duration: 125, recording_url: 'https://example.com/recording.wav' },
                  { _id: '6a2a9e5e73ccdf947d5091d2', lead_name: 'Jane Smith', to_number: '+1987654321', status: 'completed', duration: 90, recording_url: 'https://example.com/recording2.wav' }
                ]
              }
            }
          },
          {
            sub_title: 'Create Campaign',
            sub_description: 'Launch a new AI outbound calling campaign. (Requires Content-Type: multipart/form-data)',
            http_method: 'POST',
            url_path: '/api/campaigns/create',
            payload: {
              name: 'Holiday Outreach',
              typeId: '6a2a9e5e73ccdf947d5091c1',
              agentId: '6a2a9e5e73ccdf947d5091a1',
              phoneNumberId: '6a2a9e5e73ccdf947d5091e1',
              contactIds: '["6a2a9e5e73ccdf947d5091f1"]',
              callSchedule: '{"callStartTime": "09:00", "callEndTime": "17:00", "dayOfWeek": [1,2,3,4,5]}',
              contactFile: '(binary CSV file)'
            },
            response: {
              success: true,
              message: 'Campaign created successfully.',
              data: {
                _id: '6a2a9e5e73ccdf947d5091b3',
                name: 'Holiday Outreach',
                campaignStatus: 'Draft'
              }
            }
          },
          {
            sub_title: 'Update Campaign',
            sub_description: 'Update a draft campaign or activate it. (Requires Content-Type: multipart/form-data)',
            http_method: 'PUT',
            url_path: '/api/campaigns/:id/update',
            payload: {
              name: 'Updated Holiday Outreach',
              campaignStatus: 'Active'
            },
            response: {
              success: true,
              data: {
                _id: '6a2a9e5e73ccdf947d5091b1',
                name: 'Updated Holiday Outreach',
                campaignStatus: 'Active'
              }
            }
          },
          {
            sub_title: 'Delete Campaign',
            sub_description: 'Delete an existing campaign.',
            http_method: 'DELETE',
            url_path: '/api/campaigns/:id/delete',
            payload: {},
            response: {
              success: true,
              message: 'Campaign deleted successfully'
            }
          }
        ],
        is_system: true,
        is_active: true
      },
      {
        title: 'SMS Templates API',
        description: 'API documentation for managing SMS Templates.',
        endpoints: [
          {
            sub_title: 'List All Templates',
            sub_description: 'Retrieve all SMS templates.',
            http_method: 'GET',
            url_path: '/api/sms-templates/all',
            payload: {},
            response: {
              success: true,
              data: [
                {
                  _id: '6a2a9e5e73ccdf947d5092a1',
                  user_id: '6a2a9e5e73ccdf947d5092u1',
                  name: 'Welcome Template',
                  description: 'Used for new signups',
                  content: 'Hello {{name}}, welcome to our platform!',
                  status: 'active',
                  created_at: '2026-06-10T10:00:00.000Z',
                  updated_at: '2026-06-10T10:00:00.000Z'
                },
                {
                  _id: '6a2a9e5e73ccdf947d5092a2',
                  user_id: '6a2a9e5e73ccdf947d5092u1',
                  name: 'Follow Up',
                  description: 'Used after a missed call',
                  content: 'Hi {{name}}, sorry we missed you. When is a good time to call back?',
                  status: 'active',
                  created_at: '2026-06-11T10:00:00.000Z',
                  updated_at: '2026-06-11T10:00:00.000Z'
                }
              ]
            }
          },
          {
            sub_title: 'List Self Templates',
            sub_description: 'Retrieve SMS templates created by the current user.',
            http_method: 'GET',
            url_path: '/api/sms-templates/self',
            payload: {},
            response: {
              success: true,
              data: [
                {
                  _id: '6a2a9e5e73ccdf947d5092a1',
                  user_id: '6a2a9e5e73ccdf947d5092u1',
                  name: 'Welcome Template',
                  description: 'Used for new signups',
                  content: 'Hello {{name}}, welcome to our platform!',
                  status: 'active',
                  created_at: '2026-06-10T10:00:00.000Z',
                  updated_at: '2026-06-10T10:00:00.000Z'
                }
              ]
            }
          },
          { sub_title: 'Create Template', sub_description: 'Create a new SMS Template.', http_method: 'POST', url_path: '/api/sms-templates/create', payload: { name: 'Welcome', description: 'desc', content: 'Hello {{name}}', status: 'active' }, response: { success: true, message: 'SMS template created successfully', data: {} } },
          { sub_title: 'Update Template', sub_description: 'Update an existing SMS Template.', http_method: 'PUT', url_path: '/api/sms-templates/:id/update', payload: { content: 'Hi {{name}}' }, response: { success: true, message: 'SMS Template updated successfully', data: {} } },
          { sub_title: 'Delete Template', sub_description: 'Delete an SMS Template.', http_method: 'DELETE', url_path: '/api/sms-templates/:id/delete', payload: {}, response: { success: true, message: 'SMS Template deleted successfully' } }
        ],
        is_system: true,
        is_active: true
      },
      {
        title: 'SMS Campaigns API',
        description: 'API documentation for managing SMS Campaigns.',
        endpoints: [
          {
            sub_title: 'List SMS Campaigns',
            sub_description: 'Retrieve all SMS Campaigns.',
            http_method: 'GET',
            url_path: '/api/sms-campaigns',
            payload: {},
            response: {
              success: true,
              data: [
                {
                  _id: '6a2a9e5e73ccdf947d5093a1',
                  name: 'Summer Promo',
                  status: 'Draft',
                  templateId: { _id: '6a2a9e5e73ccdf947d5092a1', name: 'Promo Template' },
                  phoneNumberId: { _id: '6a2a9e5e73ccdf947d5091e1', phone_number: '+1234567890' },
                  created_at: '2026-06-10T10:00:00.000Z'
                },
                {
                  _id: '6a2a9e5e73ccdf947d5093a2',
                  name: 'Winter Sale',
                  status: 'Active',
                  templateId: { _id: '6a2a9e5e73ccdf947d5092a2', name: 'Sale Template' },
                  phoneNumberId: { _id: '6a2a9e5e73ccdf947d5091e2', phone_number: '+1987654321' },
                  created_at: '2026-06-11T10:00:00.000Z'
                }
              ],
              pagination: { total: 2, page: 1, pages: 1 }
            }
          },
          {
            sub_title: 'Get SMS Campaign by ID',
            sub_description: 'Retrieve a specific SMS Campaign.',
            http_method: 'GET',
            url_path: '/api/sms-campaigns/:id',
            payload: {},
            response: {
              success: true,
              data: {
                  _id: '6a2a9e5e73ccdf947d5093a1',
                  name: 'Summer Promo',
                  status: 'Draft',
                  templateId: { _id: '6a2a9e5e73ccdf947d5092a1', name: 'Promo Template' },
                  phoneNumberId: { _id: '6a2a9e5e73ccdf947d5091e1', phone_number: '+1234567890' },
                  contactIds: [],
                  contactGroupIds: [],
                  created_at: '2026-06-10T10:00:00.000Z'
              }
            }
          },
          {
            sub_title: 'Get SMS Campaign History',
            sub_description: 'Retrieve metrics for a specific SMS Campaign.',
            http_method: 'GET',
            url_path: '/api/sms-campaigns/:id/history',
            payload: {},
            response: {
              success: true,
              data: {
                campaign: { _id: '6a2a9e5e73ccdf947d5093a1', name: 'Summer Promo', status: 'Active' },
                metrics: { totalLeads: 500, sentCount: 450, failedCount: 50, successRate: 90 },
                messages: [
                  { _id: '6a2a9e5e73ccdf947d5093m1', to_number: '+1234567890', status: 'sent', sent_at: '2026-06-10T10:05:00.000Z' },
                  { _id: '6a2a9e5e73ccdf947d5093m2', to_number: '+1987654321', status: 'failed', sent_at: '2026-06-10T10:06:00.000Z' }
                ]
              }
            }
          },
          { sub_title: 'Create SMS Campaign', sub_description: 'Create a new SMS Campaign. (multipart/form-data)', http_method: 'POST', url_path: '/api/sms-campaigns/create', payload: { name: 'Promo', templateId: '6a2a9e5e73ccdf947d5092a1', phoneNumberId: '6a2a9e5e73ccdf947d5091e1' }, response: { success: true, message: 'SMS Campaign created successfully', data: {} } },
          { sub_title: 'Update SMS Campaign', sub_description: 'Update an SMS Campaign. (multipart/form-data)', http_method: 'PUT', url_path: '/api/sms-campaigns/:id/update', payload: { status: 'Active' }, response: { success: true, data: {} } },
          { sub_title: 'Delete SMS Campaign', sub_description: 'Delete an SMS Campaign.', http_method: 'DELETE', url_path: '/api/sms-campaigns/:id/delete', payload: {}, response: { success: true, message: 'SMS Campaign deleted successfully' } }
        ],
        is_system: true,
        is_active: true
      },
      {
        title: 'Contact Groups API',
        description: 'API documentation for managing Contact Groups.',
        endpoints: [
          {
            sub_title: 'List Groups',
            sub_description: 'Retrieve all Contact Groups.',
            http_method: 'GET',
            url_path: '/api/contact-groups',
            payload: {},
            response: {
              success: true,
              data: [
                {
                  _id: '6a2a9e5e73ccdf947d5094a1',
                  name: 'VIP Customers',
                  description: 'High-value clients',
                  user_id: '6a2a9e5e73ccdf947d5092u1',
                  created_at: '2026-06-10T10:00:00.000Z',
                  updated_at: '2026-06-10T10:00:00.000Z'
                },
                {
                  _id: '6a2a9e5e73ccdf947d5094a2',
                  name: 'Newsletter Subs',
                  description: 'General mailing list',
                  user_id: '6a2a9e5e73ccdf947d5092u1',
                  created_at: '2026-06-11T10:00:00.000Z',
                  updated_at: '2026-06-11T10:00:00.000Z'
                }
              ]
            }
          },
          {
            sub_title: 'Get Group by ID',
            sub_description: 'Retrieve a specific Contact Group.',
            http_method: 'GET',
            url_path: '/api/contact-groups/:id',
            payload: {},
            response: {
              success: true,
              data: {
                _id: '6a2a9e5e73ccdf947d5094a1',
                name: 'VIP Customers',
                description: 'High-value clients',
                user_id: '6a2a9e5e73ccdf947d5092u1',
                created_at: '2026-06-10T10:00:00.000Z',
                updated_at: '2026-06-10T10:00:00.000Z'
              }
            }
          },
          { sub_title: 'Create Group', sub_description: 'Create a new Contact Group.', http_method: 'POST', url_path: '/api/contact-groups/create', payload: { name: 'VIPs', description: 'Very Important Persons' }, response: { success: true, message: 'Contact group created successfully', data: {} } },
          { sub_title: 'Update Group', sub_description: 'Update a Contact Group.', http_method: 'PUT', url_path: '/api/contact-groups/:id/update', payload: { name: 'VIP Users' }, response: { success: true, message: 'Contact group updated successfully', data: {} } },
          { sub_title: 'Delete Group', sub_description: 'Delete a Contact Group.', http_method: 'DELETE', url_path: '/api/contact-groups/:id/delete', payload: {}, response: { success: true, message: 'Contact group deleted successfully' } }
        ],
        is_system: true,
        is_active: true
      },
      {
        title: 'Contact Hub API',
        description: 'API documentation for managing Contacts.',
        endpoints: [
          {
            sub_title: 'List Contacts',
            sub_description: 'Retrieve all Contacts.',
            http_method: 'GET',
            url_path: '/api/contacts',
            payload: {},
            response: {
              success: true,
              data: [
                {
                  _id: '6a2a9e5e73ccdf947d5095a1',
                  first_name: 'John',
                  last_name: 'Doe',
                  email: 'john@example.com',
                  phone_number: '+1234567890',
                  group_id: { _id: '6a2a9e5e73ccdf947d5094a1', name: 'VIP Customers' },
                  user_id: '6a2a9e5e73ccdf947d5092u1',
                  created_at: '2026-06-10T10:00:00.000Z'
                },
                {
                  _id: '6a2a9e5e73ccdf947d5095a2',
                  first_name: 'Jane',
                  last_name: 'Smith',
                  email: 'jane@example.com',
                  phone_number: '+1987654321',
                  group_id: { _id: '6a2a9e5e73ccdf947d5094a2', name: 'Newsletter Subs' },
                  user_id: '6a2a9e5e73ccdf947d5092u1',
                  created_at: '2026-06-11T10:00:00.000Z'
                }
              ],
              pagination: { total: 2, page: 1, pages: 1 }
            }
          },
          { sub_title: 'Create Contact', sub_description: 'Create a new Contact.', http_method: 'POST', url_path: '/api/contacts/create', payload: { first_name: 'John', last_name: 'Doe', phone_number: '+1234567890', email: 'john@example.com', group_id: '6a2a9e5e73ccdf947d5094a1' }, response: { success: true, message: 'Contact created successfully', data: {} } },
          { sub_title: 'Update Contact', sub_description: 'Update a Contact.', http_method: 'PUT', url_path: '/api/contacts/:id/update', payload: { first_name: 'Johnny' }, response: { success: true, message: 'Contact updated successfully', data: {} } },

          { sub_title: 'Import Contacts', sub_description: 'Import Contacts via CSV.', http_method: 'POST', url_path: '/api/contacts/import', payload: { contactFile: '(binary CSV file)', group_id: '6a2a9e5e73ccdf947d5094a1' }, response: { success: true, message: 'Contacts imported successfully' } },
          { sub_title: 'Export Contacts', sub_description: 'Export Contacts to CSV.', http_method: 'GET', url_path: '/api/contacts/export/csv', payload: {}, response: { success: true, message: 'CSV downloaded' } }
        ],
        is_system: true,
        is_active: true
      },
      {
        title: 'Team API',
        description: 'API documentation for managing Teams.',
        endpoints: [
          {
            sub_title: 'List Teams',
            sub_description: 'Retrieve all Teams.',
            http_method: 'GET',
            url_path: '/api/teams',
            payload: {},
            response: {
              success: true,
              data: {
                  teams: [
                      {
                          _id: "6a2160065df7a114432244dd",
                          user_id: "6a02bf85d1ba5d07b9dd03d0",
                          name: "Coder",
                          description: "Coding Ninja",
                          status: "active",
                          sort_order: 0,
                          deleted_at: null,
                          created_at: "2026-06-04T11:22:46.075Z",
                          updated_at: "2026-06-04T12:40:23.497Z",
                          __v: 0,
                          members: [
                              {
                                  _id: "6a2173097672fbd84fa3f0c8",
                                  user_id: "6a02bf85d1ba5d07b9dd03d0",
                                  team_id: "6a2160065df7a114432244dd",
                                  first_name: "Demo",
                                  last_name: "Team",
                                  email: "teamdemo@gmail.com",
                                  phone_number: "+917485963214",
                                  avatar: null,
                                  status: "active",
                                  created_at: "2026-06-04T12:43:53.271Z",
                                  updated_at: "2026-06-04T12:43:53.271Z",
                                  __v: 0
                              }
                          ]
                      },
                      {
                          _id: "6a28ed6b875821b381d91323",
                          user_id: "6a099ffaaeb468acd6703638",
                          name: "Support aaa",
                          description: "",
                          status: "active",
                          sort_order: 0,
                          deleted_at: null,
                          created_at: "2026-06-10T04:51:55.660Z",
                          updated_at: "2026-06-10T05:00:48.839Z",
                          __v: 0,
                          members: [
                              {
                                  _id: "6a28edb2875821b381d913c6",
                                  user_id: "6a099ffaaeb468acd6703638",
                                  team_id: "6a28ed6b875821b381d91323",
                                  first_name: "Smith",
                                  last_name: "",
                                  email: "smith@gmail.com",
                                  phone_number: "+919723242040",
                                  avatar: null,
                                  status: "active",
                                  created_at: "2026-06-10T04:53:06.920Z",
                                  updated_at: "2026-06-10T04:53:06.920Z",
                                  __v: 0
                              }
                          ]
                      },
                      {
                          _id: "6a28ef55875821b381d91757",
                          user_id: "6a02bf85d1ba5d07b9dd03cc",
                          name: "Support",
                          description: "",
                          status: "active",
                          sort_order: 0,
                          deleted_at: null,
                          created_at: "2026-06-10T05:00:05.754Z",
                          updated_at: "2026-06-10T12:29:02.881Z",
                          __v: 0,
                          members: [
                              {
                                  _id: "6a28f910a209e84c358572dd",
                                  user_id: "6a02bf85d1ba5d07b9dd03cc",
                                  team_id: "6a28ef55875821b381d91757",
                                  first_name: "Sam",
                                  last_name: "",
                                  email: "sam@gmail.com",
                                  phone_number: "9737082019",
                                  avatar: null,
                                  status: "active",
                                  created_at: "2026-06-10T05:41:36.036Z",
                                  updated_at: "2026-06-10T05:41:36.036Z",
                                  __v: 0
                              },
                          ]
                      }
                  ],
                  pagination: {
                      currentPage: 1,
                      totalPages: 1,
                      totalItems: 3,
                      itemsPerPage: 10
                  }
              }
            }
          },
          {
            sub_title: 'Get Team by ID',
            sub_description: 'Retrieve a specific Team.',
            http_method: 'GET',
            url_path: '/api/teams/:id',
            payload: {},
            response: {
              success: true,
              data: {
                _id: '6a2160065df7a114432244dd',
                user_id: '6a02bf85d1ba5d07b9dd03d0',
                name: 'Coder',
                description: 'Coding Ninja',
                status: 'active',
                sort_order: 0,
                permissions: ['view.dashboard'],
                created_at: '2026-06-10T10:00:00.000Z',
                updated_at: '2026-06-10T10:00:00.000Z'
              }
            }
          },
          { sub_title: 'Create Team', sub_description: 'Create a new Team.', http_method: 'POST', url_path: '/api/teams/create', payload: { name: 'Support', description: 'Support team', status: 'active', permissions: ['view.dashboard'] }, response: { success: true, message: 'Team created successfully', data: {} } },
          { sub_title: 'Update Team', sub_description: 'Update a Team.', http_method: 'PUT', url_path: '/api/teams/:id', payload: { name: 'Support Squad' }, response: { success: true, message: 'Team updated successfully', data: {} } },
          { sub_title: 'Delete Teams', sub_description: 'Bulk Delete Teams.', http_method: 'DELETE', url_path: '/api/teams/delete', payload: { ids: ['6a2160065df7a114432244dd'] }, response: { success: true, message: 'Teams deleted successfully' } },
          { sub_title: 'Toggle Team Status', sub_description: 'Toggle Active/Inactive status.', http_method: 'PATCH', url_path: '/api/teams/:id/toggle-status', payload: {}, response: { success: true, message: 'Team status toggled successfully' } },
          { sub_title: 'Get Permissions', sub_description: 'List available permissions to assign to Teams.', http_method: 'GET', url_path: '/api/teams/permissions', payload: {}, response: { success: true, data: [{ _id: '6a21p0065df7a114432244p1', name: 'View Dashboard', slug: 'view.dashboard' }, { _id: '6a21p0065df7a114432244p2', name: 'Create Team', slug: 'create.team' }] } }
        ],
        is_system: true,
        is_active: true
      },
      {
        title: 'Team Member API',
        description: 'API documentation for managing Team Members.',
        endpoints: [
          {
            sub_title: 'Get Team Members',
            sub_description: 'Retrieve members for a specific Team.',
            http_method: 'GET',
            url_path: '/api/team-members/:id',
            payload: {},
            response: {
              success: true,
              data: [
                  {
                      _id: "6a28f910a209e84c358572dd",
                      user_id: "6a02bf85d1ba5d07b9dd03cc",
                      team_id: "6a28ef55875821b381d91757",
                      first_name: "Sam",
                      last_name: "",
                      email: "sam@gmail.com",
                      phone_number: "9737082019",
                      avatar: null,
                      status: "active",
                      created_at: "2026-06-10T05:41:36.036Z",
                      updated_at: "2026-06-10T05:41:36.036Z",
                      __v: 0
                  },
                  {
                      _id: "6a290449785d1708d51e2ffa",
                      user_id: "6a02bf85d1ba5d07b9dd03cc",
                      team_id: "6a28ef55875821b381d91757",
                      first_name: "Bhakti Ma;am",
                      last_name: "",
                      email: "bhakti@gmail.coom",
                      phone_number: "+919510641828",
                      avatar: null,
                      status: "active",
                      created_at: "2026-06-10T06:29:29.662Z",
                      updated_at: "2026-06-10T06:29:29.662Z",
                      __v: 0
                  }
              ]
            }
          },
          { sub_title: 'Get Teams with Transfer Permission', sub_description: 'List teams that have transfer permissions.', http_method: 'GET', url_path: '/api/team-members/transfer-teams', payload: {}, response: { success: true, data: [ { _id: "6a28ef55875821b381d91757", name: "Support" }, { _id: "6a28ed6b875821b381d91323", name: "Technical" } ] } },
          { sub_title: 'Add Team Member', sub_description: 'Add a new member to a team.', http_method: 'POST', url_path: '/api/team-members/add', payload: { team_id: '6a28ef55875821b381d91757', first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com', password: 'password123', phone_number: '+1234567890' }, response: { success: true, message: 'Team member added successfully', data: {} } },
          { sub_title: 'Remove Team Member', sub_description: 'Remove a member from a team.', http_method: 'POST', url_path: '/api/team-members/remove', payload: { team_id: '6a28ef55875821b381d91757', member_id: '6a28f910a209e84c358572dd' }, response: { success: true, message: 'Team member removed successfully' } }
        ],
        is_system: true,
        is_active: true
      }
    ];

    for (const guide of guidesData) {
      const existing = await TenantGuide.findOne({ title: guide.title });
      if (!existing) {
        await TenantGuide.create(guide);
        console.log(`Created Tenant Guide: ${guide.title}`);
      } else {
        await TenantGuide.updateOne({ title: guide.title }, { $set: guide });
      }
    }

    console.log('Tenant Guide seeding completed');
  } catch (error) {
    console.error('Tenant Guide seeding error:', error);
    throw error;
  }
};

module.exports = { up: seedTenantGuides };
