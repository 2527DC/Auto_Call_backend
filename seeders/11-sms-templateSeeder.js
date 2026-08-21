require('dotenv').config();

const seedSMSTemplates = async (dbConnection, mongoose) => {
    try {
        const SMSTemplate = dbConnection.db.SMSTemplate;
        const User = dbConnection.db.User;
        const Role = dbConnection.db.Role;

        console.log('Seeding SMS templates...');

        let adminUser = await User.findOne({});
        const superAdminRole = await Role.findOne({ name: 'super_admin' });

        if (superAdminRole) {
            const superAdmin = await User.findOne({ role: superAdminRole._id });
            if (superAdmin) {
                adminUser = superAdmin;
            }
        }

        if (!adminUser) {
            console.warn('No user found to assign SMS templates to, Skipping SMS template seeding.');
            return;
        }

        const smsTemplatesData = [
            {
                name: 'Appointment Reminder',
                content: 'Hi {{name}}, just a reminder for your appointment at {{appointment_time}} on {{appointment_date}}. Please reply YES to confirm.',
                is_system: true,
                status: 'active',
                user_id: adminUser._id
            },
            {
                name: 'Order Confirmation',
                content: 'Hello {{name}}, your order #{{order_id}} has been confirmed and is being processed. Expected delivery: {{delivery_date}}.',
                is_system: true,
                status: 'active',
                user_id: adminUser._id
            },
            {
                name: 'Payment Received',
                content: 'Thank you {{name}}! We have received your payment of {{amount}} for invoice {{invoice_number}}.',
                is_system: true,
                status: 'active',
                user_id: adminUser._id
            },
            {
                name: 'Welcome Message',
                content: 'Welcome to {{company}}, {{name}}! We are excited to have you on board.',
                is_system: true,
                status: 'active',
                user_id: adminUser._id
            },
            {
                name: 'Special Offer',
                content: 'Hi {{name}}, as a valued customer we are offering you {{discount}} off your next purchase! Use code {{promo_code}} at checkout.',
                is_system: true,
                status: 'active',
                user_id: adminUser._id
            },
            {
                name: 'Delivery Update',
                content: 'Hi {{name}}, your package from {{company}} is out for delivery! Track it here: {{tracking_link}}',
                is_system: true,
                status: 'active',
                user_id: adminUser._id
            },
            {
                name: 'Feedback Request',
                content: 'Hi {{name}}, thanks for visiting {{company}}. We would love to hear your thoughts! Please leave a review: {{review_link}}',
                is_system: true,
                status: 'active',
                user_id: adminUser._id
            },
            {
                name: 'Event Invitation',
                content: 'Hello {{name}}, you are invited to our upcoming {{event_name}} on {{event_date}}! RSVP by {{rsvp_date}}.',
                is_system: true,
                status: 'active',
                user_id: adminUser._id
            }
        ];

        for (const smsData of smsTemplatesData) {
            const existingSMS = await SMSTemplate.findOne({ name: smsData.name, user_id: adminUser._id });
            if (!existingSMS) {
                await SMSTemplate.create(smsData);
            }
        }

        console.log('SMS Template seeding completed');
    } catch (error) {
        console.error('SMS Template seeding error:', error);
        throw error;
    }
};

module.exports = { up: seedSMSTemplates };
