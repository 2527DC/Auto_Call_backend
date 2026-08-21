require('dotenv').config();

const seedRoles = async (dbConnection, mongoose) => {
  try {
    const Role = dbConnection.db.Role;

    console.log('Seeding roles...');

    const rolesData = [
      { name: 'super_admin', description: 'Super Administrator with full access', system_reserved: true },
      { name: 'user', description: 'Regular User', system_reserved: true },
    ];

    for (const roleData of rolesData) {
      const existing = await Role.findOne({ name: roleData.name });
      if (!existing) {
        await Role.create(roleData);
        console.log(`Created role: ${roleData.name}`);
      } else {
        console.log(`Role already exists: ${roleData.name}`);
      }
    }

    console.log('Role seeding completed');
  } catch (error) {
    console.error('Role seeding error:', error);
    throw error;
  }
};

module.exports = { up: seedRoles };