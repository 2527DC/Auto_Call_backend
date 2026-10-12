'use strict';

const { db } = require('../models');
const { Permission, Role, RolePermission } = db;

// Permissions added after production was seeded. The seeder replaces every role's
// permissions, so it isn't re-run on deploy; instead each of these is created on
// startup if missing and granted to its roles that one time. Later changes made
// on the Permissions page are left alone.
const NEW_PERMISSIONS = [
  { slug: 'view.price_estimator', name: 'View Price_estimator', description: 'Permission to view price_estimator', roles: ['super_admin', 'admin'] },
  { slug: 'manage.price_estimator', name: 'Manage Price_estimator', description: 'Permission to manage price_estimator', roles: ['super_admin', 'admin'] },
];

const ensurePermissions = async () => {
  for (const { roles, ...permission } of NEW_PERMISSIONS) {
    if (await Permission.exists({ slug: permission.slug })) continue;

    const created = await Permission.create(permission);
    const roleDocs = await Role.find({ name: { $in: roles } }).select('_id').lean();
    if (roleDocs.length) {
      await RolePermission.insertMany(roleDocs.map((r) => ({ role_id: r._id, permission_id: created._id })));
    }
    console.log(`Added permission ${permission.slug} for ${roles.join(', ')}`);
  }
};

module.exports = { ensurePermissions };
