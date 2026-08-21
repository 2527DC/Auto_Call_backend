require('dotenv').config();

const seedPages = async (dbConnection, mongoose) => {
  try {
    const Page = dbConnection.db.Page;
    const User = dbConnection.db.User;
    const Role = dbConnection.db.Role;

    console.log('Seeding pages...');

    let adminUser = await User.findOne({});
    const superAdminRole = await Role.findOne({ name: 'super_admin' });

    if (superAdminRole) {
      const superAdmin = await User.findOne({ roleId: superAdminRole._id });
      if (superAdmin) {
        adminUser = superAdmin;
      }
    }

    if (!adminUser) {
      console.warn('No user found to assign pages to. Skipping page seeding.');
      return;
    }

    const pages = [
      {
        title: 'Privacy Policy',
        slug: 'privacy-policy',
        content: '<h1>Privacy Policy</h1><p>This is the default Privacy Policy content. Please update it in the admin panel.</p>',
        meta_title: 'Privacy Policy',
        meta_description: 'Privacy Policy for Autocall',
        status: true,
        created_by: adminUser._id
      },
      {
        title: 'Terms and Conditions',
        slug: 'terms-and-conditions',
        content: '<h1>Terms and Conditions</h1><p>This is the default Terms and Conditions content. Please update it in the admin panel.</p>',
        meta_title: 'Terms and Conditions',
        meta_description: 'Terms and Conditions for Autocall',
        status: true,
        created_by: adminUser._id
      },
      {
        title: 'Refund Policy',
        slug: 'refund-policy',
        content: '<h1>Refund Policy</h1><p>This is the default Refund Policy content. Please update it in the admin panel.</p>',
        meta_title: 'Refund Policy',
        meta_description: 'Refund Policy for Autocall',
        status: true,
        created_by: adminUser._id
      }
    ];

    for (const pageData of pages) {
      const existingPage = await Page.findOne({ slug: pageData.slug });
      if (!existingPage) {
        await new Page(pageData).save();
      }
    }

    console.log('Pages seeded successfully!');
  } catch (error) {
    console.error('Error seeding pages:', error);
    throw error;
  }
};

const down = async (dbConnection, mongoose) => {
  try {
    const Page = dbConnection.db.Page;
    await Page.deleteMany({
      slug: { $in: ['privacy-policy', 'terms-and-conditions', 'refund-policy'] }
    });
    console.log('Pages seed removed successfully!');
  } catch (error) {
    console.error('Error removing pages seed:', error);
    throw error;
  }
};

module.exports = {
  up: seedPages,
  down: down
};
