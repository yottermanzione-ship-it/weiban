import { createECDH, timingSafeEqual } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  writeFileSync,
  chownSync,
  chmodSync,
  linkSync,
  rmSync,
  openSync,
  closeSync,
} from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateCredentials(value) {
  const v = value?.webpush;
  const subject = new URL(v?.subject);
  if (!['https:', 'mailto:'].includes(subject.protocol)) throw new Error('Invalid push subject');
  if (!/^[A-Za-z0-9_-]{87}$/.test(v?.publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(v?.privateKey))
    throw new Error('Invalid push key format');
  const pair = createECDH('prime256v1');
  pair.setPrivateKey(Buffer.from(v.privateKey, 'base64url'));
  if (!timingSafeEqual(pair.getPublicKey(), Buffer.from(v.publicKey, 'base64url')))
    throw new Error('Push keys do not match');
}

export function newCredentials(subject) {
  const pair = createECDH('prime256v1');
  pair.generateKeys();
  const privateKey = Buffer.alloc(32);
  const rawPrivateKey = pair.getPrivateKey();
  rawPrivateKey.copy(privateKey, 32 - rawPrivateKey.length);
  const value = {
    webpush: {
      subject,
      publicKey: pair.getPublicKey().toString('base64url'),
      privateKey: privateKey.toString('base64url'),
    },
  };
  validateCredentials(value);
  return value;
}

// Executed only in a network-isolated, short-lived container with the dedicated secret directory mounted.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, file, subject] = process.argv.slice(2);
  if (mode !== '--write' || file !== '/secrets/credentials.json' || !subject)
    throw new Error('Explicit dedicated secret target required');
  let created = false;
  const existing = lstatSync(file, { throwIfNoEntry: false });
  if (existing) {
    if (!existing.isFile()) throw new Error('Push secret must be a regular file');
    // Never let JSON.parse include a fragment of a malformed secret in stderr.
    let value;
    try {
      value = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new Error('Existing push credential file is unreadable or invalid');
    }
    validateCredentials(value);
  } else {
    const temporary = `${file}.${process.pid}.new`;
    let ownedTemporary = false;
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      ownedTemporary = true;
      try {
        writeFileSync(fd, JSON.stringify(newCredentials(subject)));
      } finally {
        closeSync(fd);
      }
      chownSync(temporary, 1000, 1000);
      // Exclusive publication: even a concurrent creator must never rotate an existing key.
      linkSync(temporary, file);
      created = true;
    } finally {
      if (ownedTemporary) rmSync(temporary, { force: true });
    }
  }
  chownSync(file, 1000, 1000);
  chmodSync(file, 0o600);
  console.log(JSON.stringify({ pushCredentialsValid: true, created, uid: 1000, mode: '0600' }));
}
