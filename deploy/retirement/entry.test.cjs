'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { seal, open } = require('./sealed-json.cjs');
const { legacyVersion, downloadName, manifest } = require('./public-entry.cjs');
const { retiredWorker } = require('./retired-worker.cjs');
const vm = require('node:vm');

test('legacy clients retain mandatory upgrade while current/newer builds do not loop', () => {
  const p = {
    latestVersion: '3.0.0',
    latestVersionCode: 127,
    minSupportedVersionCode: 127,
    downloadUrl: manifest.downloadUrl,
  };
  const info = { sizeBytes: 5392086, sha256: manifest.sha256, sha1: 'synthetic' };
  for (const build of [66, 123, 126]) {
    const result = legacyVersion(p, String(build), info);
    assert.equal(result.must_update, true);
    assert.equal(result.has_update, true);
    assert.equal(result.download_size_bytes, 5392086);
    assert.equal(result.download_sha256, manifest.sha256);
    assert.ok(result.download_url.startsWith('https://weiban.online/download-assets/'));
    assert.equal(result.update_channel, 'stable');
  }
  for (const build of [0, 127, 128, 'invalid']) {
    assert.equal(legacyVersion(p, build, info).must_update, false);
    assert.equal(legacyVersion(p, build, info).has_update, false);
  }
});

test('public new-site policy can advance without repackaging the archive', () => {
  const result = legacyVersion(
    {
      latestVersion: '3.0.1',
      latestVersionCode: 128,
      minSupportedVersionCode: 127,
      downloadUrl: 'https://app.weiban.online/download-assets/weiban-3.0.1-128.apk',
      latestNote: { body: 'release' },
    },
    127,
    { sizeBytes: 1, sha256: 'synthetic' },
  );
  assert.equal(result.has_update, true);
  assert.equal(result.must_update, false);
  assert.equal(result.download_url, 'https://weiban.online/download-assets/weiban-3.0.1-128.apk');
  assert.equal(result.update_notes, 'release');
  for (const address of [
    'https://other.invalid/x.apk',
    'http://weiban.online/download-assets/x.apk',
    'https://weiban.online/download-assets/..%2Fsecret.apk',
  ])
    assert.equal(downloadName(address), null);
});

test('archive credential material stays encrypted and tampering is rejected', () => {
  const key = crypto.randomBytes(32);
  const value = { kind: 'archive', environment: { ADMIN_TOKEN: 'FAKE-TEST-PASSWORD' } };
  const envelope = seal(value, key);
  assert.equal(JSON.stringify(envelope).includes('FAKE-TEST-PASSWORD'), false);
  assert.deepEqual(open(envelope, key), value);
  const bad = { ...envelope, tag: crypto.randomBytes(16).toString('base64') };
  assert.throws(() => open(bad, key));
  assert.throws(() => open(envelope, crypto.randomBytes(32)));
});

test('old web worker moves only legacy app windows and never clears stored user data', async () => {
  const events = new Map();
  const navigated = [];
  let claimed = false,
    skipped = false;
  const clients = [
    'https://weiban.online/app/#/chat',
    'https://weiban.online/app/chat?token=FAKE',
    'https://weiban.online/console/',
    'https://other.invalid/app/',
  ].map((url) => ({
    url,
    navigate: async (target) => {
      navigated.push({ from: url, target });
    },
  }));
  const self = {
    location: { origin: 'https://weiban.online' },
    addEventListener: (type, handler) => events.set(type, handler),
    skipWaiting: async () => {
      skipped = true;
    },
    clients: {
      claim: async () => {
        claimed = true;
      },
      matchAll: async () => clients,
    },
  };
  vm.runInNewContext(retiredWorker, { self, URL, Response });
  let work;
  events.get('install')({
    waitUntil: (value) => {
      work = value;
    },
  });
  await work;
  events.get('activate')({
    waitUntil: (value) => {
      work = value;
    },
  });
  await work;
  assert.ok(skipped && claimed);
  assert.equal(navigated.length, 2);
  assert.ok(navigated.every((row) => row.target === 'https://app.weiban.online/'));
  let response;
  events.get('fetch')({
    request: { mode: 'navigate' },
    respondWith: (r) => {
      response = r;
    },
  });
  assert.equal(response.headers.get('location'), 'https://app.weiban.online/');
});
