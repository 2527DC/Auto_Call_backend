'use strict';

function generateInvoiceNumber() {
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `INV-${timestamp}-${random}`;
}

module.exports = { generateInvoiceNumber };
