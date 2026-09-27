/**
 * reset-admin.js
 * Resets or creates the super_admin account using credentials from .env
 * Run: node scripts/reset-admin.js
 */

require('dotenv').config();
// Force Google DNS — default system DNS blocks MongoDB Atlas SRV lookups
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGO_URI = process.env.MONGODB_URI;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@autocall.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Admin';

if (!MONGO_URI) {
  console.error('❌ MONGODB_URI is not set in .env');
  process.exit(1);
}

// ── Minimal schemas (no need to load full app) ────────────────────────────────

const RoleSchema = new mongoose.Schema({
  name: String,
  description: String,
  system_reserved: Boolean,
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', default: null },
  isVerified: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

async function run() {
  console.log('🔌 Connecting to MongoDB Atlas...');
  await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('✅ Connected\n');

  const Role = mongoose.model('Role', RoleSchema);
  const User = mongoose.model('User', UserSchema);

  // 1. Ensure super_admin role exists
  let role = await Role.findOne({ name: 'super_admin' });
  if (!role) {
    role = await Role.create({
      name: 'super_admin',
      description: 'Super Administrator with full access',
      system_reserved: true,
    });
    console.log('✅ Created role: super_admin');
  } else {
    console.log('ℹ️  Role super_admin already exists');
  }

  // 2. Hash the password
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

  // 3. Upsert the admin user
  const existing = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() });

  if (existing) {
    existing.password = hashedPassword;
    existing.roleId = role._id;
    existing.isVerified = true;
    existing.isActive = true;
    existing.name = ADMIN_NAME;
    await existing.save();
    console.log(`✅ Reset existing admin: ${ADMIN_EMAIL}`);
  } else {
    await User.create({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL.toLowerCase(),
      password: hashedPassword,
      roleId: role._id,
      isVerified: true,
      isActive: true,
    });
    console.log(`✅ Created new admin: ${ADMIN_EMAIL}`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Super Admin Credentials');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Email    : ${ADMIN_EMAIL}`);
  console.log(`  Password : ${ADMIN_PASSWORD}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await mongoose.disconnect();
  console.log('🔌 Disconnected. Done!');
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
