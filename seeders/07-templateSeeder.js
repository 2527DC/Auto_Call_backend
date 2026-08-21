require('dotenv').config();

const seedTemplates = async (dbConnection, mongoose) => {
    try {
        const Template = dbConnection.db.Template;
        const Category = dbConnection.db.Category;
        const User = dbConnection.db.User;
        const Role = dbConnection.db.Role;

        console.log('Seeding templates...');

        let adminUser = await User.findOne({});
        const superAdminRole = await Role.findOne({ name: 'super_admin' });

        if (superAdminRole) {
            const superAdmin = await User.findOne({ role: superAdminRole._id });
            if (superAdmin) {
                adminUser = superAdmin;
            }
        }

        if (!adminUser) {
            console.warn('No user found to assign templates to, Skipping template seeding.');
            return;
        }

        let category = await Category.findOne({ name: 'Marketing' });

        if (!category) {
            console.warn('Marketing category not found. Using a fallback or skipping template seeding.');
            category = await Category.findOne({});
            if (!category) return;
        }

        const templatesData = [
            {
                name: 'Lead Generation Bot',
                category: category._id,
                content: 'A bot designed to capture leads and qualify them.',
                system_prompt: 'You are a helpful assistant that qualifies leads for our marketing team.',
                welcome_message: 'Hi there! I can help you find the right solution. What are you looking for?',
                communication_style: 'professional',
                behavior_style: 'helpful',
                is_system: true,
                is_public: true,
                user_id: adminUser._id
            },
            {
                name: 'Customer Support Bot',
                category: category._id,
                content: 'A bot designed to handle frequently asked questions.',
                system_prompt: 'You are a friendly customer support assistant.',
                welcome_message: 'Hello! How can I assist you today?',
                communication_style: 'casual',
                behavior_style: 'friendly',
                is_system: true,
                is_public: true,
                user_id: adminUser._id
            }
        ];

        for (const templateData of templatesData) {
            const existing = await Template.findOne({ name: templateData.name });
            if (!existing) {
                await Template.create(templateData);
            }
        }

        console.log('Template seeding completed');
    } catch (error) {
        console.error('Template seeding error:', error);
        throw error;
    }
};

module.exports = { up: seedTemplates };
