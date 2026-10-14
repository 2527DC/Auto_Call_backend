'use strict';

// One CSV cell. Cells starting with = + - @ would run as formulas in Excel, so
// they are prefixed with a quote.
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

// Rows (arrays) to CSV text, with a BOM so Excel reads Indian languages correctly.
const toCsv = (rows) => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n');

const istDateTime = (d) => (d ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d)) : '');

module.exports = { csvCell, toCsv, istDateTime };
