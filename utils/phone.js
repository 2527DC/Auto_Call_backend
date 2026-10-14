'use strict';

// Phone numbers arrive in many shapes: Plivo sends "919845012345", Twilio
// "+919845012345", contacts are typed or imported as "98450 12345" or
// "09845012345". These helpers give one canonical form (E.164, India by
// default) and the stored shapes a number may already have, so the same
// person is matched to one contact.

const COUNTRY_CODE = '91';

// Caller IDs that are not real numbers (hidden caller ID, browser widget).
const NOT_A_NUMBER = /^(anonymous|unknown|private|restricted|unavailable|web widget)$/i;

// E.164 ("+919845012345"), or null when the value isn't a usable phone number.
function normalizePhone(raw) {
  const text = String(raw || '').trim();
  if (!text || NOT_A_NUMBER.test(text)) return null;
  const hasPlus = text.startsWith('+') || text.startsWith('00');
  let digits = text.replace(/\D/g, '');
  if (text.startsWith('00')) digits = digits.slice(2);
  if (!digits) return null;

  if (hasPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  // Indian mobiles (10 digits) and landlines written with the trunk 0 ("080 4711 0000").
  if (digits.length === 10) return `+${COUNTRY_CODE}${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+${COUNTRY_CODE}${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith(COUNTRY_CODE)) return `+${digits}`;
  // Other countries written without "+" (Plivo sends every number this way).
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

// Every stored shape the number may have, for lookups in existing data.
function phoneVariants(raw) {
  const variants = new Set();
  const original = String(raw || '').trim();
  if (original) variants.add(original);
  const e164 = normalizePhone(raw);
  if (e164) {
    const digits = e164.slice(1);
    variants.add(e164);
    variants.add(digits);
    if (digits.startsWith(COUNTRY_CODE) && digits.length === 12) {
      const local = digits.slice(2);
      variants.add(local);
      variants.add(`0${local}`);
      variants.add(`+${COUNTRY_CODE} ${local}`);
      variants.add(`+${COUNTRY_CODE} ${local.slice(0, 5)} ${local.slice(5)}`);
      variants.add(`${local.slice(0, 5)} ${local.slice(5)}`);
    }
  }
  return [...variants];
}

// The client's contact for this number, or null.
// Contacts saved before phone_e164 existed are matched on the usual shapes of
// the number until scripts/backfill-contact-phones.js has filled it in.
async function findContactByPhone(Contact, userId, raw) {
  if (!userId) return null;
  const e164 = normalizePhone(raw);
  const variants = phoneVariants(raw);
  if (!e164 && !variants.length) return null;
  const or = [{ phone_number: { $in: variants } }];
  if (e164) or.unshift({ phone_e164: e164 });
  return Contact.findOne({ user_id: userId, $or: or });
}

// The client's contact for this number, created (E.164) when there is none.
// Two calls from a new number at the same moment both try to create it: the
// unique index rejects the second, which then reads the first one's contact.
async function findOrCreateContact(Contact, userId, raw, fields = {}) {
  const phone = normalizePhone(raw);
  if (!userId || !phone) return null;
  const existing = await findContactByPhone(Contact, userId, raw);
  if (existing) return existing;
  try {
    return await Contact.create({ user_id: userId, phone_number: phone, ...fields });
  } catch (err) {
    if (err?.code === 11000) return findContactByPhone(Contact, userId, raw);
    throw err;
  }
}

module.exports = { normalizePhone, phoneVariants, findContactByPhone, findOrCreateContact };
