'use strict';

const crypto = require('crypto');

const algorithm = 'aes-256-cbc';
const key = crypto.scryptSync(
  process.env.GOOGLE_ENCRYPTION_KEY || 'default-encryption-key-change-in-production',
  'salt',
  32
);
const iv = crypto.randomBytes(16);

function encrypt(text) {
  if (!text) return text;
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(key), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  if (!text) return text;
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(key), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('[Encryption] Decryption failed:', error.message);
    return text;
  }
}

module.exports = { encrypt, decrypt };
