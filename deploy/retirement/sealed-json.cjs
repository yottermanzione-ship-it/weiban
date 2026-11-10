'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const AAD = Buffer.from('weiban:retirement:archive-bundle:v1');
function readKey(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  const key = Buffer.from(text, /^[a-f0-9]{64}$/i.test(text) ? 'hex' : 'base64');
  if (key.length !== 32) throw new Error('INVALID_HOST_KEY');
  return key;
}
function seal(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const plain = Buffer.from(JSON.stringify(value));
  try {
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return {
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      body: body.toString('base64'),
    };
  } finally {
    plain.fill(0);
  }
}
function open(value, key) {
  if (value.version !== 1) throw new Error('INVALID_ARCHIVE_ENVELOPE');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(value.body, 'base64')),
    decipher.final(),
  ]);
  try {
    return JSON.parse(plain.toString('utf8'));
  } finally {
    plain.fill(0);
  }
}
module.exports = { readKey, seal, open };
