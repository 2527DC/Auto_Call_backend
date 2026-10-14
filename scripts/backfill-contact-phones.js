/**
 * backfill-contact-phones.js
 * Fills contacts.phone_e164 (the number in one form, "+919845012345") for
 * contacts saved before the field existed, so calls and imports find them
 * however the number was typed. New and edited contacts get it automatically.
 * Dry run by default; writes only with --apply. Never changes phone_number.
 * Run: node scripts/backfill-contact-phones.js [--apply]
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
const APPLY = process.argv.includes('--apply');

(async () => {
  await mongoose.connect(MONGO_URI);
  const contacts = mongoose.connection.collection('contacts');
  let checked = 0, filled = 0, unreadable = 0;
  let ops = [];
  const flush = async () => {
    if (APPLY && ops.length) await contacts.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for await (const c of contacts.find({ $or: [{ phone_e164: { $exists: false } }, { phone_e164: null }] }, { projection: { phone_number: 1 } })) {
    checked++;
    const e164 = normalizePhone(c.phone_number);
    if (!e164) { unreadable++; continue; }
    filled++;
    ops.push({ updateOne: { filter: { _id: c._id }, update: { $set: { phone_e164: e164 } } } });
    if (ops.length >= 500) await flush();
  }
  await flush();

  console.log(`${APPLY ? 'Updated' : 'Would update'} ${filled} of ${checked} contacts; ${unreadable} numbers can't be read (left as they are).`);
  if (!APPLY) console.log('Dry run. Re-run with --apply to write.');
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
