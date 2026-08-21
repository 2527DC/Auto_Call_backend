require('dotenv').config();

const seedCategories = async (dbConnection, mongoose) => {
    try {
        const Category = dbConnection.db.Category;
        const User = dbConnection.db.User;
        const Role = dbConnection.db.Role;

        console.log('Seeding categories...');

        let adminUser = await User.findOne({});
        const superAdminRole = await Role.findOne({ name: 'super_admin' });

        if (superAdminRole) {
            const superAdmin = await User.findOne({ role: superAdminRole._id });
            if (superAdmin) {
                adminUser = superAdmin;
            }
        }

        if (!adminUser) {
            console.warn('No user found to assign categories to, Skipping category seeding.');
            return;
        }

        const categoriesData = [
            { name: 'Marketing', description: 'Manage promotional campaigns and customer engagement activities', is_system: true, user_id: adminUser._id },
            { name: 'Helpdesk', description: 'Provide customer support and resolve service-related inquiries', is_system: true, user_id: adminUser._id },
            { name: 'Scheduling', description: 'Schedule and manage appointments, meetings and bookings', is_system: true, user_id: adminUser._id },
        ];

        for (const categoryData of categoriesData) {
            const existing = await Category.findOne({ name: categoryData.name });
            if (!existing) {
                await Category.create(categoryData);
            }
        }

        console.log('Category seeding completed');
    } catch (error) {
        console.error('Category seeding error:', error);
        throw error;
    }
};

module.exports = { up: seedCategories };
