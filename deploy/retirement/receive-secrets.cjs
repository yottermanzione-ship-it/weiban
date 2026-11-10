'use strict';
// New host only: recipient private key arrives over stdin and is never persisted.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { readKey, seal } = require('./sealed-json.cjs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const encrypted = input.encrypted;
const key = crypto.privateDecrypt(
  { key: input.privateKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
  Buffer.from(encrypted.wrappedKey, 'base64'),
);
input.privateKey = null;
let plain;
try {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
  decipher.setAAD(Buffer.from('weiban-retirement-export-v1'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  plain = Buffer.concat([decipher.update(Buffer.from(encrypted.body, 'base64')), decipher.final()]);
} finally {
  key.fill(0);
}
let value;
try {
  value = JSON.parse(plain.toString('utf8'));
} finally {
  plain.fill(0);
}
if (value.version !== 1 || !['archive', 'wechat'].includes(value.kind))
  throw new Error('PAYLOAD_INVALID');
if (value.kind === 'archive' && (!value.environment || !/^[a-f0-9]{64}$/.test(value.vaultKey)))
  throw new Error('ARCHIVE_SECRET_INVALID');
if (value.kind === 'wechat' && (!Array.isArray(value.entries) || value.entries.length > 1000))
  throw new Error('WECHAT_PAYLOAD_INVALID');
const kek = readKey('/run/secrets/kek');
try {
  const filename =
    value.kind === 'archive'
      ? 'archive.sealed.json'
      : `wechat-${Date.parse(value.createdAt)}.sealed.json`;
  const output = `/entry/${filename}`;
  fs.writeFileSync(output, JSON.stringify(seal(value, kek)), { flag: 'wx', mode: 0o600 });
  fs.chownSync(output, 1000, 1000);
  if (value.kind === 'wechat')
    fs.writeFileSync('/entry/wechat-capture.json', JSON.stringify({ filename }), { mode: 0o600 });
  console.log(
    JSON.stringify({
      stored: value.kind,
      encrypted: true,
      filename,
      readyBindings: value.entries?.filter((e) => !e.needsRebind).length,
      needsRebind: value.entries?.filter((e) => e.needsRebind).length,
    }),
  );
} finally {
  kek.fill(0);
}
