'use strict';

const { normalizePhone } = require('./phone');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const YES = /^(yes|y|true|haan|ha|han|ho|houdu|sure|correct|right|ok|okay)$/i;
const NO = /^(no|n|false|nahi|nahin|na|illa|illai|nope)$/i;

// Checks and tidies one captured answer against its form field. Returns the
// value to save, or null when the answer doesn't fit the field's type (the
// question is then asked again or left empty).
function cleanFieldValue(field = {}, value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const text = typeof value === 'string' ? value.trim() : value;

  switch (field.type) {
    case 'number': {
      const n = typeof text === 'number' ? text : Number(String(text).replace(/[, ]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    case 'email': {
      const email = String(text).replace(/\s+at\s+/gi, '@').replace(/\s+dot\s+/gi, '.').replace(/\s+/g, '').toLowerCase();
      return EMAIL.test(email) ? email : null;
    }
    case 'phone':
      return normalizePhone(text);
    case 'yes_no':
      if (typeof text === 'boolean') return text;
      if (YES.test(String(text))) return true;
      if (NO.test(String(text))) return false;
      return null;
    case 'choice': {
      const options = field.options || [];
      if (!options.length) return String(text);
      const match = options.find(o => o.toLowerCase() === String(text).toLowerCase());
      return match || null;
    }
    case 'date': {
      // ISO date (YYYY-MM-DD) as the AI is asked to give it, or anything Date can read.
      const d = /^\d{4}-\d{2}-\d{2}$/.test(String(text)) ? new Date(`${text}T00:00:00Z`) : new Date(text);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    case 'time': {
      const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(String(text).replace(/\./g, ':').trim());
      if (!m) return null;
      let h = Number(m[1]);
      const min = Number(m[2] || 0);
      if (m[3]) h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
      return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null;
    }
    default:
      return typeof text === 'string' ? text : String(text);
  }
}

module.exports = { cleanFieldValue };
