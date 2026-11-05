import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { newCredentials, validateCredentials } from './provision-webpush.mjs';

const requireServer = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const webpush = requireServer('web-push');

test('VAPID pairs are valid, distinct and never printed or persisted by generation', () => {
  const a = newCredentials('https://weiban.online');
  const b = newCredentials('https://weiban.online');
  assert.notEqual(a.webpush.privateKey, b.webpush.privateKey);
  assert.doesNotThrow(() => validateCredentials(a));
  assert.doesNotThrow(() =>
    webpush.getVapidHeaders(
      'https://web.push.apple.com',
      a.webpush.subject,
      a.webpush.publicKey,
      a.webpush.privateKey,
      'aes128gcm',
    ),
  );
  assert.throws(() =>
    validateCredentials({ webpush: { ...a.webpush, privateKey: b.webpush.privateKey } }),
  );
  assert.throws(() => newCredentials('file:///tmp/contact'));
  assert.throws(() => validateCredentials({ webpush: { ...a.webpush, publicKey: 'invalid' } }));
});
