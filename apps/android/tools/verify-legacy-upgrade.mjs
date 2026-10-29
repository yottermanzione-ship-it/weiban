import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readIdentity(text) {
  const entries = text.split(/\r?\n/u).filter((line) => line.trim() && !line.trim().startsWith('#')).map((line) => {
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Invalid public upgrade identity');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  });
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error('Duplicate upgrade identity field');
  const value = Object.fromEntries(entries);
  const identity = { ...value, minimumSdk: Number(value.minimumSdk), previousVersionCode: Number(value.previousVersionCode), versionCode: Number(value.versionCode) };
  if (!identity.applicationId || !/^[a-f0-9]{64}$/u.test(identity.certificateSha256 ?? '') || !Number.isSafeInteger(identity.minimumSdk) || !Number.isSafeInteger(identity.previousVersionCode) || !Number.isSafeInteger(identity.versionCode) || identity.versionCode <= identity.previousVersionCode) throw new Error('Invalid public upgrade identity');
  return identity;
}
export function readApkMetadata(badging, certificates) {
  const match = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/mu.exec(badging);
  const sdk = /^sdkVersion:'(\d+)'/mu.exec(badging);
  const signers = [...certificates.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})$/gimu)].map((item) => item[1].toLowerCase());
  if (!match || !sdk || signers.length !== 1) throw new Error('APK identity or single signing certificate not available');
  return { applicationId: match[1], versionCode: Number(match[2]), versionName: match[3], minimumSdk: Number(sdk[1]), certificateSha256: signers[0], debuggable: /^application-debuggable$/mu.test(badging) };
}
export function assertUpgrade(candidate, identity, previous = null) {
  if (candidate.applicationId !== identity.applicationId) throw new Error('APK package does not continue the legacy application');
  if (candidate.debuggable) throw new Error('A debug APK is not a release upgrade');
  if (candidate.certificateSha256 !== identity.certificateSha256) throw new Error('APK is not signed by the verified legacy certificate');
  if (!Number.isSafeInteger(candidate.versionCode) || candidate.versionCode <= Math.max(identity.previousVersionCode, previous?.versionCode ?? 0)) throw new Error('APK versionCode does not advance the distributed legacy version');
  if (candidate.minimumSdk > identity.minimumSdk) throw new Error('APK excludes devices supported by the verified legacy baseline');
  if (previous && (previous.applicationId !== identity.applicationId || previous.certificateSha256 !== identity.certificateSha256)) throw new Error('The supplied previous APK does not match the legacy baseline');
  return { applicationId: candidate.applicationId, versionCode: candidate.versionCode, versionName: candidate.versionName, minimumSdk: candidate.minimumSdk, certificateSha256: candidate.certificateSha256, packageSignatureVersionChecks: 'passed', deviceUpgradeTest: 'not_performed', accountDataMigrationVerified: false };
}
function inspectApk(apk, sdk, java) {
  const buildTools = join(sdk, 'build-tools', process.env.ANDROID_BUILD_TOOLS_VERSION || '36.0.0');
  const badging = execFileSync(join(buildTools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'), ['dump', 'badging', resolve(apk)], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  const certificates = execFileSync(java, ['-jar', join(buildTools, 'lib', 'apksigner.jar'), 'verify', '--print-certs', resolve(apk)], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  return readApkMetadata(badging, certificates);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length < 1 || args.length > 2) throw new Error('Usage: node verify-legacy-upgrade.mjs <candidate.apk> [previous.apk]');
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (!sdk) throw new Error('Set ANDROID_HOME to the installed Android SDK');
    const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
    const identity = readIdentity(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'legacy-upgrade.properties'), 'utf8'));
    console.log(JSON.stringify(assertUpgrade(inspectApk(args[0], sdk, java), identity, args[1] ? inspectApk(args[1], sdk, java) : null), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'APK verification failed');
    process.exitCode = 1;
  }
}
