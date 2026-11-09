import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { readIdentity } from '../../apps/android/tools/verify-legacy-upgrade.mjs';
import {
  assertLocalOrigin,
  createLocalTls,
  digest,
  exerciseDistribution,
  legacyAppConfig,
  legacyDownloadConfig,
  makeManifest,
  parseByteRange,
  renderLanding,
  requestLocal,
  startLocalDistribution,
} from './migration-distribution.mjs';

const identity = readIdentity(
  await readFile(new URL('../../apps/android/legacy-upgrade.properties', import.meta.url), 'utf8'),
);
const metadata = {
  applicationId: identity.applicationId,
  versionName: identity.versionName,
  versionCode: identity.versionCode,
  certificateSha256: identity.certificateSha256,
  minimumSdk: identity.minimumSdk,
  debuggable: false,
};
// HTTP fixture bytes only, not an APK or an installable test build.
const bytes = Buffer.from(Array.from({ length: 8193 }, (_, index) => index % 251));
const manifest = makeManifest(bytes, metadata, identity);
const origin = 'http://127.0.0.1:19999';

test('release metadata derives both digests and byte count from the same buffer', () => {
  assert.equal(manifest.asset.sizeBytes, bytes.length);
  assert.equal(manifest.asset.sha256, digest(bytes));
  assert.equal(manifest.asset.sha1, digest(bytes, 'sha1'));
  assert.equal(manifest.productionReady, false);
  assert.match(manifest.asset.path, new RegExp(`${identity.versionCode}-${digest(bytes)}\\.apk$`));
  assert.equal(manifest.policy.forceUpdate, false);
  assert.equal(manifest.policy.minSupportedBuild, 0);
});

test('same-identity release checks reject changed package, signer, debug and downgraded versions', () => {
  for (const change of [
    { applicationId: 'other.app' },
    { certificateSha256: '0'.repeat(64) },
    { debuggable: true },
    { versionCode: identity.previousVersionCode },
    { minimumSdk: identity.minimumSdk + 1 },
    { versionCode: identity.versionCode + 1 },
    { versionName: '9.9.9' },
  ]) {
    assert.throws(() => makeManifest(bytes, { ...metadata, ...change }, identity));
  }
});

test('only literal loopback origins are accepted', () => {
  assert.equal(assertLocalOrigin('https://127.0.0.1:8443/'), 'https://127.0.0.1:8443');
  for (const invalid of [
    'https://app.weiban.online',
    'http://localhost:1',
    'http://0.0.0.0:1',
    'http://[::1]:1',
    'http://127.1:1',
    'http://2130706433:1',
    'http://127.0.0.1.evil.test',
    'http://user:pass@127.0.0.1',
    'http://127.0.0.1/path',
    'http://127.0.0.1/?next=outside',
    'ftp://127.0.0.1',
  ])
    assert.throws(() => assertLocalOrigin(invalid));
  assert.throws(() => requestLocal(origin, '//outside.test/file'));
  assert.throws(() => requestLocal(origin, '/\\outside.test/file'));
});

test('old Dart build 120 and Android build 123 receive stable release with all legacy digest fields', () => {
  for (const build of [120, 123, 124, 126]) {
    const config = legacyAppConfig(manifest, origin, build);
    assert.equal(config.has_update, true);
    assert.equal(config.must_update, false);
    assert.equal(config.latest_build, identity.versionCode);
    assert.equal(config.update_channel, 'stable');
    assert.equal(config.download_sha256, digest(bytes));
    assert.equal(config.download_sha1, digest(bytes, 'sha1'));
    assert.equal(config.download_size_bytes, bytes.length);
    assert.equal(config.test_channel, undefined);
  }
});

test('latest, future, missing and malformed builds do not show update', () => {
  for (const build of [
    identity.versionCode,
    identity.versionCode + 1,
    undefined,
    null,
    '',
    'garbage',
    -1,
    0,
    'Infinity',
  ]) {
    const config = legacyAppConfig(manifest, origin, build);
    assert.equal(config.has_update, false);
    assert.equal(config.must_update, false);
  }
});

test('optional/mandatory floor policy follows the old newer-build gate', () => {
  const optionalOff = makeManifest(bytes, metadata, identity, { softUpdate: false });
  assert.equal(legacyAppConfig(optionalOff, origin, 120).has_update, false);
  const mandatory = makeManifest(bytes, metadata, identity, {
    softUpdate: false,
    minSupportedBuild: 123,
  });
  assert.equal(legacyAppConfig(mandatory, origin, 120).must_update, true);
  assert.equal(legacyAppConfig(mandatory, origin, 120).has_update, true);
  assert.equal(legacyAppConfig(mandatory, origin, 123).has_update, false);
  const forced = makeManifest(bytes, metadata, identity, { forceUpdate: true });
  assert.equal(legacyAppConfig(forced, origin, 123).must_update, true);
  assert.equal(legacyAppConfig(forced, origin, identity.versionCode).must_update, false);
  for (const policy of [
    { minSupportedBuild: identity.versionCode + 1 },
    { minSupportedBuild: -1 },
    { forceUpdate: 'true' },
    { test_channel: {} },
  ])
    assert.throws(() => makeManifest(bytes, metadata, identity, policy));
});

test('normal/quick/developer aliases share the selected formal bytes, with no cloud or debug fallbacks', () => {
  const config = legacyDownloadConfig(manifest, origin).config;
  for (const kind of ['normal', 'quick', 'developer'])
    assert.equal(config[kind].url, origin + manifest.asset.path);
  assert.equal(config.quick.code, '');
  assert.equal(config.web.url, `${origin}/new-app/`);
  assert.equal(config.ios.url, config.web.url);
  const html = renderLanding(manifest, origin);
  for (const kind of ['normal', 'web', 'ios'])
    assert.ok(html.includes(`href="${config[kind].url}"`));
  assert.ok(html.includes('重新登录'));
  assert.ok(html.includes('未发送消息'));
  assert.ok(html.includes('主屏幕图标'));
});

test('landing dynamic configuration preserves defaults on failure and refuses external URLs', async () => {
  const html = renderLanding(manifest, origin);
  const script = /<script>([\s\S]+)<\/script>/.exec(html)[1];
  const run = async (data) => {
    const links = {
      normal: { href: 'default-normal' },
      web: { href: 'default-web' },
      ios: { href: 'default-ios' },
    };
    const context = {
      URL,
      location: { origin },
      fetch: async (path) => {
        assert.equal(path, '/api/download-config');
        return { ok: true, json: async () => data };
      },
      document: { querySelectorAll: (selector) => [links[/"([a-z]+)"/.exec(selector)[1]]] },
    };
    await vm.runInNewContext(script, context);
    return links;
  };
  const good = await run(legacyDownloadConfig(manifest, origin));
  assert.equal(good.normal.href, origin + manifest.asset.path);
  const bad = legacyDownloadConfig(manifest, origin);
  bad.config.normal.url = 'https://outside.invalid/file.apk';
  assert.equal((await run(bad)).normal.href, 'default-normal');
  assert.equal((await run({ ok: false })).normal.href, 'default-normal');
});

test('single range parser supports bounded, open, suffix and end clamping', () => {
  assert.deepEqual(parseByteRange('bytes=0-10', 100), { start: 0, end: 10 });
  assert.deepEqual(parseByteRange('bytes=50-', 100), { start: 50, end: 99 });
  assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange('bytes=-1000', 100), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange('bytes=1-1000', 100), { start: 1, end: 99 });
  for (const bad of [
    'bytes=',
    'bytes=-',
    'bytes=100-',
    'bytes=10-1',
    'bytes=-0',
    'bytes=0-1,3-4',
    'items=0-1',
    'bytes=999999999999999999999-',
    'bytes=1.5-2',
    'bytes= 0-1',
  ])
    assert.equal(parseByteRange(bad, 100), null);
});

test('manifest tampering and changed bytes fail before opening a socket', async () => {
  const changedBytes = Buffer.from(bytes);
  changedBytes[0] ^= 1;
  await assert.rejects(startLocalDistribution({ bytes: changedBytes, manifest }), /does not match/);
  const changedManifest = structuredClone(manifest);
  changedManifest.asset.sizeBytes += 1;
  await assert.rejects(
    startLocalDistribution({ bytes, manifest: changedManifest }),
    /does not match/,
  );
  const changedSigner = structuredClone(manifest);
  changedSigner.package.certificateSha256 = '0'.repeat(64);
  await assert.rejects(
    startLocalDistribution({ bytes, manifest: changedSigner }),
    /legacy certificate/,
  );
});

test('HTTP exercise verifies resumed byte assembly, maintenance, compatibility and cache/error contract', async () => {
  const result = await exerciseDistribution(bytes, manifest);
  assert.equal(result.transport, 'HTTP');
  assert.equal(result.checks.length, 19);
  assert.equal(result.sha256, digest(bytes));
});

test('HEAD, conditional caching, suffix/multiple ranges and authorization cannot override stable selection', async () => {
  const lab = await startLocalDistribution({ bytes, manifest });
  const request = (path, options) => requestLocal(lab.origin, path, options);
  try {
    const full = await request(manifest.asset.path);
    const head = await request(manifest.asset.path, {
      method: 'HEAD',
      headers: { Range: 'bytes=0-2' },
    });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers['content-length']), bytes.length);
    assert.equal(head.body.length, 0);
    const suffix = await request(manifest.asset.path, { headers: { Range: 'bytes=-20' } });
    assert.equal(suffix.status, 206);
    assert.deepEqual(suffix.body, bytes.subarray(-20));
    const multiple = await request(manifest.asset.path, { headers: { Range: 'bytes=0-1,3-4' } });
    assert.equal(multiple.status, 416);
    assert.match(multiple.headers['cache-control'], /no-store/);
    const cached = await request(manifest.asset.path, {
      headers: { 'If-None-Match': `W/${full.headers.etag}` },
    });
    assert.equal(cached.status, 304);
    assert.equal(cached.body.length, 0);
    assert.match(cached.headers['cache-control'], /immutable/);
    const modified = await request(manifest.asset.path, {
      headers: { 'If-Modified-Since': full.headers['last-modified'] },
    });
    assert.equal(modified.status, 304);
    const mismatchEtag = await request(manifest.asset.path, {
      headers: { 'If-None-Match': '"old"', 'If-Modified-Since': full.headers['last-modified'] },
    });
    assert.equal(mismatchEtag.status, 200);
    const current = await request(manifest.asset.path, {
      headers: { Range: 'bytes=3-', 'If-Range': full.headers.etag },
    });
    assert.equal(current.status, 206);
    assert.deepEqual(current.body, bytes.subarray(3));
    const tester = await request('/api/app/config?build=123&channel=test', {
      headers: { Authorization: 'Bearer synthetic-local-only' },
    });
    assert.equal(JSON.parse(tester.body).update_channel, 'stable');
    assert.match(tester.headers['cache-control'], /no-store/);
    assert.equal(tester.headers['set-cookie'], undefined);
    const wrongHost = await request('/', { headers: { Host: 'outside.invalid' } });
    assert.equal(wrongHost.status, 421);
    assert.match(wrongHost.headers['cache-control'], /no-store/);
  } finally {
    await lab.close();
  }
});

test('server snapshots keep selected manifest and bytes immutable after caller mutation', async () => {
  const source = Buffer.from(bytes);
  const mutable = structuredClone(manifest);
  const lab = await startLocalDistribution({ bytes: source, manifest: mutable });
  try {
    source.fill(0);
    mutable.asset.sha256 = '0'.repeat(64);
    lab.manifest.asset.sha256 = '1'.repeat(64);
    const response = await requestLocal(lab.origin, manifest.asset.path);
    assert.equal(digest(response.body), manifest.asset.sha256);
  } finally {
    await lab.close();
  }
});

test('HTTPS uses trusted loopback certificate and rejects default untrusted requests', async () => {
  const tls = await createLocalTls();
  try {
    const lab = await startLocalDistribution({ bytes, manifest, tls });
    try {
      await assert.rejects(requestLocal(lab.origin, '/'));
      const trusted = await requestLocal(lab.origin, '/', { ca: tls.cert });
      assert.equal(trusted.status, 200);
    } finally {
      await lab.close();
    }
    const result = await exerciseDistribution(bytes, manifest, tls);
    assert.match(result.transport, /^HTTPS/);
    assert.equal(result.sha256, digest(bytes));
  } finally {
    tls.key.fill(0);
  }
});
