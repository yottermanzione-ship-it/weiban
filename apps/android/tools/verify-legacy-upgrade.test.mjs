import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertUpgrade, readApkMetadata, readIdentity } from './verify-legacy-upgrade.mjs';
const identity = readIdentity(readFileSync(new URL('../legacy-upgrade.properties', import.meta.url), 'utf8'));
const candidate = { applicationId: identity.applicationId, versionCode: identity.versionCode, versionName: identity.versionName, minimumSdk: identity.minimumSdk, certificateSha256: identity.certificateSha256, debuggable: false };
const previous = { ...candidate, versionCode: identity.previousVersionCode };
test('public identity continues the verified legacy app and never contains signing credentials', () => {
  assert.equal(identity.applicationId, 'com.weiban.weiban');
  assert.equal(identity.previousVersionCode, 123);
  assert.equal(identity.minimumSdk, 24);
  assert.equal('storePassword' in identity, false);
  assert.equal('keyPassword' in identity, false);
});
test('matching APK metadata passes without pretending to have run device or data migration tests', () => {
  assert.equal(assertUpgrade(candidate, identity, previous).packageSignatureVersionChecks, 'passed');
  assert.equal(assertUpgrade(candidate, identity, previous).deviceUpgradeTest, 'not_performed');
  assert.equal(assertUpgrade(candidate, identity, previous).accountDataMigrationVerified, false);
});
for (const [label, change] of [
  ['different application', { applicationId: 'app.weiban' }],
  ['debug certificate', { certificateSha256: 'a'.repeat(64) }],
  ['debuggable release', { debuggable: true }],
  ['version downgrade', { versionCode: 1 }],
  ['same version', { versionCode: 123 }],
  ['old Android excluded', { minimumSdk: 26 }],
]) test(`rejects ${label}`, () => assert.throws(() => assertUpgrade({ ...candidate, ...change }, identity, previous)));
test('a later previously distributed APK cannot be overwritten by an older candidate', () => {
  assert.throws(() => assertUpgrade(candidate, identity, { ...previous, versionCode: candidate.versionCode + 1 }));
});
test('previous APK must actually have the original certificate', () => {
  assert.throws(() => assertUpgrade(candidate, identity, { ...previous, certificateSha256: 'b'.repeat(64) }));
});
test('badging and public certificate parsers require a single verified signer', () => {
  const badging = `package: name='${candidate.applicationId}' versionCode='${candidate.versionCode}' versionName='${candidate.versionName}'\nsdkVersion:'24'\n`;
  const certificate = `Signer #1 certificate SHA-256 digest: ${identity.certificateSha256}\n`;
  assert.deepEqual(readApkMetadata(badging, certificate), candidate);
  assert.throws(() => readApkMetadata(badging, ''));
  assert.throws(() => readApkMetadata(badging, certificate + certificate.replace('#1', '#2')));
});
test('duplicate fields and non-advancing public defaults are refused', () => {
  const content = readFileSync(new URL('../legacy-upgrade.properties', import.meta.url), 'utf8');
  assert.throws(() => readIdentity(content + '\nversionCode=999\n'));
  assert.throws(() => readIdentity(content.replace('versionCode=124', 'versionCode=123')));
});
