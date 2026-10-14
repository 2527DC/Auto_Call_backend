/**
 * report-duplicate-contacts.js
 * Lists contacts that are the same phone number written differently
 * ("9845012345", "+919845012345", "098450 12345") within one client, and
 * contacts whose number can't be read. Read-only: nothing is merged or changed.
 * Run: node scripts/report-duplicate-contacts.js [--json]
 */

require('dotenv').config();
// Force Google DNS — default system DNS blocks MongoDB Atlas SRV lookups
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const mongoose = require('mongoose');
const { normalizePhone } = require('../utils/phone');

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

(async () => {
  await mongoose.connect(MONGO_URI);
  const contacts = mongoose.connection.collection('contacts');
  const groups = new Map();
  const unreadable = [];
  let total = 0;

  for await (const c of contacts.find({}, { projection: { user_id: 1, phone_number: 1 } })) {
    total++;
    const phone = normalizePhone(c.phone_number);
    if (!phone) {
      unreadable.push({ id: String(c._id), user_id: String(c.user_id), phone_number: c.phone_number });
      continue;
    }
    const key = `${c.user_id}|${phone}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: String(c._id), phone_number: c.phone_number });
  }

  const duplicates = [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ user_id: key.split('|')[0], phone: key.split('|')[1], contacts: list }));

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total, duplicates, unreadable }, null, 2));
  } else {
    console.log(`Contacts checked: ${total}`);
    console.log(`Same number saved more than once: ${duplicates.length} group(s)`);
    for (const d of duplicates) {
      console.log(`  client ${d.user_id}  ${d.phone}: ${d.contacts.map(c => `${c.id} ("${c.phone_number}")`).join(', ')}`);
    }
    console.log(`Numbers that can't be read: ${unreadable.length}`);
    for (const u of unreadable) console.log(`  client ${u.user_id}  ${u.id}: "${u.phone_number}"`);
  }
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
