// Offline preparation only. There is no production URL, SSH, upload, DNS or device operation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertUpgrade,
  readApkMetadata,
  readIdentity,
} from '../../apps/android/tools/verify-legacy-upgrade.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const scratchRoot = join(scriptDirectory, 'fixtures', 'migration-distribution');
const identityFile = resolve(scriptDirectory, '../../apps/android/legacy-upgrade.properties');
const host = '127.0.0.1';
const noStore = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };
const releaseNotes =
  '本机迁移演练：沿用原应用覆盖安装，无需卸载。更新后需重新登录。旧版草稿、未发送消息和未同步编辑不保证自动迁移，请先保留。维护时间尚未安排；已付费会员按核对结果承接。';

export function digest(bytes, algorithm = 'sha256') {
  return createHash(algorithm).update(bytes).digest('hex');
}

export function assertLocalOrigin(value) {
  if (typeof value !== 'string' || !/^https?:\/\/127\.0\.0\.1(?::\d+)?\/?$/.test(value))
    throw new Error('Only a literal 127.0.0.1 HTTP(S) origin is allowed');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.hostname !== host ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Only a literal 127.0.0.1 HTTP(S) origin is allowed');
  }
  return url.origin;
}

export function makeManifest(bytes, metadata, identity, policy = {}) {
  assertUpgrade(metadata, identity);
  if (
    metadata.versionCode !== identity.versionCode ||
    metadata.versionName !== identity.versionName
  )
    throw new Error('APK differs from the selected release identity');
  if (!/^\d+\.\d+\.\d+$/.test(metadata.versionName))
    throw new Error('Release version name must be a numeric semantic version');
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('Release bytes are required');
  const sha256 = digest(bytes);
  const floor = policy.minSupportedBuild ?? 0;
  if (!Number.isSafeInteger(floor) || floor < 0 || floor > metadata.versionCode)
    throw new Error('Invalid minimum supported build');
  for (const key of Object.keys(policy))
    if (!['softUpdate', 'forceUpdate', 'minSupportedBuild'].includes(key))
      throw new Error('Unsupported update policy');
  for (const key of ['softUpdate', 'forceUpdate'])
    if (policy[key] !== undefined && typeof policy[key] !== 'boolean')
      throw new Error('Update switches must be booleans');
  return {
    schema: 'weiban-migration-distribution-local-v1',
    productionReady: false,
    package: { ...metadata },
    asset: {
      path: `/download-assets/weiban-${metadata.versionName}-${metadata.versionCode}-${sha256}.apk`,
      sizeBytes: bytes.length,
      sha256,
      sha1: digest(bytes, 'sha1'),
    },
    policy: {
      softUpdate: policy.softUpdate ?? true,
      forceUpdate: policy.forceUpdate ?? false,
      minSupportedBuild: floor,
    },
    updateNotes: releaseNotes,
    updatedAt: new Date().toISOString(),
  };
}

async function validateManifest(bytes, manifest) {
  const identity = readIdentity(await readFile(identityFile, 'utf8'));
  const rebuilt = makeManifest(bytes, manifest.package, identity, manifest.policy);
  if (
    manifest.schema !== rebuilt.schema ||
    manifest.productionReady !== false ||
    JSON.stringify(manifest.asset) !== JSON.stringify(rebuilt.asset)
  )
    throw new Error('Manifest does not match the release bytes');
  if (!Number.isFinite(Date.parse(manifest.updatedAt)) || typeof manifest.updateNotes !== 'string')
    throw new Error('Invalid manifest metadata');
}

export function legacyAppConfig(manifest, origin, clientBuild) {
  const base = assertLocalOrigin(origin);
  // Match old app_config_store.toBuild; an absent/invalid build never prompts.
  const number = Number(clientBuild);
  const build = Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  const newer = build > 0 && manifest.package.versionCode > build;
  const must =
    newer &&
    (manifest.policy.forceUpdate ||
      (manifest.policy.minSupportedBuild > 0 && build < manifest.policy.minSupportedBuild));
  return {
    latest_version: manifest.package.versionName,
    latest_build: manifest.package.versionCode,
    min_supported_version: '1.0.0',
    min_supported_build: manifest.policy.minSupportedBuild,
    update_notes: manifest.updateNotes,
    download_url: base + manifest.asset.path,
    soft_update: manifest.policy.softUpdate,
    force_update: manifest.policy.forceUpdate,
    disabled_versions: [],
    features: { voice: false, group_chat: false, early_access_panel: false },
    has_update: newer && (manifest.policy.softUpdate || must),
    must_update: must,
    version_disabled: false,
    update_channel: 'stable',
    download_size_bytes: manifest.asset.sizeBytes,
    download_sha256: manifest.asset.sha256,
    download_sha1: manifest.asset.sha1,
  };
}

export function legacyDownloadConfig(manifest, origin) {
  const base = assertLocalOrigin(origin);
  const url = base + manifest.asset.path;
  return {
    ok: true,
    config: {
      quick: { url, code: '' },
      normal: { url },
      developer: { url },
      web: { url: `${base}/new-app/` },
      ios: { url: `${base}/new-app/` },
      updated_at: manifest.updatedAt,
    },
  };
}

export function renderLanding(manifest, origin) {
  const config = legacyDownloadConfig(manifest, origin).config;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>微伴迁移入口 · 本机演练</title><body>
<h1>微伴迁移入口 · 本机演练</h1><p>仅用于本机准备，尚未发布或切换网站。</p>
<a data-download-link="normal" href="${config.normal.url}">Android 正式安装包</a>
<a data-download-link="web" href="${config.web.url}">网页版入口占位</a>
<a data-download-link="ios" href="${config.ios.url}">iPhone 网页入口占位</a>
<p>覆盖安装无需卸载，更新后重新登录；草稿、未发送消息及未同步编辑需先保留。维护日期与时长待正式通知。</p>
<p>iPhone 请用 Safari 打开新网页版，再按需要添加新的主屏幕图标与授权通知；旧登录态和图标不会自动转换。已付费会员按迁移核对结果承接。</p>
<script>fetch('/api/download-config',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(data=>{if(!data||!data.ok)return;for(const kind of ['normal','web','ios']){const value=data.config?.[kind]?.url;if(!value)continue;const url=new URL(value,location.origin);if(url.origin!==location.origin)throw new Error('Nonlocal link');document.querySelectorAll('[data-download-link="'+kind+'"]').forEach(link=>link.href=url.href);}}).catch(()=>{});</script>
</body></html>`;
}

export function parseByteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
      return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

export async function startLocalDistribution({ bytes, manifest, tls }) {
  // Freeze both together before any socket opens: source changes cannot mix metadata and bytes.
  const release = Buffer.from(bytes);
  const selected = structuredClone(manifest);
  await validateManifest(release, selected);
  const etag = `"sha256-${selected.asset.sha256}"`;
  const modified = new Date(selected.updatedAt).toUTCString();
  let origin;
  const handler = (req, res) => {
    const send = (status, body, headers = {}) => {
      const data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      res.writeHead(status, {
        ...noStore,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': data.length,
        ...headers,
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    };
    if (req.headers.host !== new URL(origin).host) return send(421, { error: 'Unexpected host' });
    if (!req.url?.startsWith('/') || req.url.startsWith('//'))
      return send(400, { error: 'Invalid request target' });
    let url;
    try {
      url = new URL(req.url, origin);
    } catch {
      return send(400, { error: 'Invalid request target' });
    }
    const known =
      ['/', '/api/app/config', '/api/download-config', '/new-app/'].includes(url.pathname) ||
      url.pathname === selected.asset.path ||
      url.pathname === '/app' ||
      url.pathname.startsWith('/app/');
    // No auth/session/database or upstream service is used, even with old Authorization headers.
    if (
      url.pathname.startsWith('/api/') &&
      !['/api/app/config', '/api/download-config'].includes(url.pathname)
    )
      return send(
        503,
        { code: 'MIGRATION_MAINTENANCE', error: '本机迁移演练：旧业务暂停，更新下载仍可用。' },
        { 'Retry-After': '300' },
      );
    if (!known) return send(404, { error: 'Not found' });
    if (!['GET', 'HEAD'].includes(req.method))
      return send(405, { error: 'Read-only endpoint' }, { Allow: 'GET, HEAD' });
    if (url.pathname === '/api/app/config')
      return send(200, legacyAppConfig(selected, origin, url.searchParams.get('build')));
    if (url.pathname === '/api/download-config')
      return send(200, legacyDownloadConfig(selected, origin));
    if (url.pathname === '/')
      return send(200, renderLanding(selected, origin), {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy':
          "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
    if (url.pathname === '/new-app/')
      return send(
        200,
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本机入口占位</title><p>新版入口占位：本演练不执行登录、不读取历史，也不连接正式站。</p></html>',
        { 'Content-Type': 'text/html; charset=utf-8' },
      );
    if (url.pathname === '/app' || url.pathname.startsWith('/app/'))
      return send(
        302,
        { message: '本机旧入口临时引导；不转发旧深链接或查询参数。' },
        { Location: `${origin}/new-app/` },
      );
    const headers = {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': `attachment; filename="${selected.asset.path.split('/').at(-1)}"`,
      'Cache-Control': 'public, max-age=31536000, immutable, no-transform',
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'Last-Modified': modified,
      'X-Content-Type-Options': 'nosniff',
    };
    const match = req.headers['if-none-match'];
    if (
      match &&
      match
        .split(',')
        .some((item) => item.trim() === '*' || item.trim().replace(/^W\//, '') === etag)
    ) {
      res.writeHead(304, headers);
      return res.end();
    }
    const since = req.headers['if-modified-since'];
    if (
      !match &&
      since &&
      Number.isFinite(Date.parse(since)) &&
      Date.parse(since) >= Date.parse(modified)
    ) {
      res.writeHead(304, headers);
      return res.end();
    }
    const ifRange = req.headers['if-range'];
    const rangeAllowed =
      !ifRange ||
      ifRange === etag ||
      (Number.isFinite(Date.parse(ifRange)) && Date.parse(ifRange) >= Date.parse(modified));
    if (req.method === 'GET' && req.headers.range && rangeAllowed) {
      const range = parseByteRange(req.headers.range, release.length);
      if (!range)
        return send(
          416,
          { error: 'Unsatisfiable single byte range' },
          { 'Content-Range': `bytes */${release.length}`, 'Accept-Ranges': 'bytes' },
        );
      res.writeHead(206, {
        ...headers,
        'Content-Length': range.end - range.start + 1,
        'Content-Range': `bytes ${range.start}-${range.end}/${release.length}`,
      });
      return res.end(release.subarray(range.start, range.end + 1));
    }
    res.writeHead(200, { ...headers, 'Content-Length': release.length });
    res.end(req.method === 'HEAD' ? undefined : release);
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolveListen);
  });
  origin = `${tls ? 'https' : 'http'}://${host}:${server.address().port}`;
  return {
    origin,
    manifest: structuredClone(selected),
    close: () =>
      new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      ),
  };
}

export function requestLocal(origin, pathname, { headers, method = 'GET', ca } = {}) {
  const base = assertLocalOrigin(origin);
  if (
    !pathname.startsWith('/') ||
    pathname.startsWith('//') ||
    new URL(pathname, base).origin !== base
  )
    throw new Error('Only local paths are allowed');
  return new Promise((resolveRequest, reject) => {
    const url = new URL(pathname, base);
    const request = (url.protocol === 'https:' ? https : http).request(
      url,
      { method, headers, ca, rejectUnauthorized: true, timeout: 5000 },
      (response) => {
        const parts = [];
        const tlsAuthorized = response.socket?.authorized ?? null;
        response.on('data', (part) => parts.push(part));
        response.on('error', reject);
        response.on('end', () =>
          resolveRequest({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(parts),
            tlsAuthorized,
          }),
        );
      },
    );
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Local request timed out')));
    request.end();
  });
}

export async function withLocalScratch(callback) {
  await mkdir(scratchRoot, { recursive: true });
  const directory = await mkdtemp(join(scratchRoot, '.scratch-'));
  const target = resolve(directory);
  if (
    !target.startsWith(resolve(scratchRoot) + sep) ||
    !target.slice(resolve(scratchRoot).length + 1).startsWith('.scratch-')
  )
    throw new Error('Refusing cleanup outside local scratch');
  try {
    return await callback(directory);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}

export async function createLocalTls(
  openssl = process.env.OPENSSL_PATH ||
    (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl'),
) {
  // Ephemeral synthetic RSA key stays in memory. Signing consumes stdin and emits only
  // the public certificate on stdout. No key file or trust-store change is permitted.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  if (process.platform === 'win32') {
    // Native Git OpenSSL does not recognize '-' or /dev/stdin as its -key input.
    // Existing PowerShell/.NET signs the public fixture using in-memory RSA parameters.
    const signPublicCertificate = String.raw`
$ErrorActionPreference = 'Stop'
$jwk = [Console]::In.ReadToEnd() | ConvertFrom-Json
function DecodeBase64Url([string]$value) {
  $encoded = $value.Replace('-', '+').Replace('_', '/')
  $encoded = $encoded.PadRight($encoded.Length + (4 - $encoded.Length % 4) % 4, '=')
  return ,([Convert]::FromBase64String($encoded))
}
$parameters = [System.Security.Cryptography.RSAParameters]::new()
$parameters.Modulus = DecodeBase64Url $jwk.n
$parameters.Exponent = DecodeBase64Url $jwk.e
$parameters.D = DecodeBase64Url $jwk.d
$parameters.P = DecodeBase64Url $jwk.p
$parameters.Q = DecodeBase64Url $jwk.q
$parameters.DP = DecodeBase64Url $jwk.dp
$parameters.DQ = DecodeBase64Url $jwk.dq
$parameters.InverseQ = DecodeBase64Url $jwk.qi
$rsa = [System.Security.Cryptography.RSA]::Create()
try {
  $rsa.ImportParameters($parameters)
  $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
    'CN=127.0.0.1', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
  $san.AddIpAddress([System.Net.IPAddress]::Parse('127.0.0.1'))
  $request.CertificateExtensions.Add($san.Build())
  $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1), [DateTimeOffset]::UtcNow.AddDays(1))
  try { [Console]::Out.Write($certificate.ExportCertificatePem()) }
  finally { $certificate.Dispose() }
} finally { $rsa.Dispose() }
`;
    const parameters = Buffer.from(JSON.stringify(privateKey.export({ format: 'jwk' })));
    try {
      const cert = execFileSync(
        process.env.POWERSHELL_PATH || 'pwsh.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', signPublicCertificate],
        { input: parameters, stdio: 'pipe', timeout: 30000, windowsHide: true },
      );
      return { key, cert };
    } catch {
      key.fill(0);
      throw new Error('In-memory local certificate signing failed');
    } finally {
      parameters.fill(0);
    }
  }
  const cert = execFileSync(
    openssl,
    [
      'req',
      '-x509',
      '-new',
      '-key',
      '/dev/stdin',
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { input: key, stdio: 'pipe', timeout: 30000 },
  );
  return { key, cert };
}

export async function inspectRelease(apk, previousApk, options = {}) {
  const sdk = options.sdk || process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('Set ANDROID_HOME to the installed SDK');
  const java =
    options.java ||
    (process.env.JAVA_HOME
      ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
      : 'java');
  const buildTools = join(sdk, 'build-tools', process.env.ANDROID_BUILD_TOOLS_VERSION || '36.0.0');
  const identity = readIdentity(await readFile(identityFile, 'utf8'));
  return withLocalScratch(async (directory) => {
    const inspect = async (input, name) => {
      const bytes = await readFile(resolve(input));
      const local = join(directory, name);
      // aapt on Windows fails with the Chinese desktop filename; inspect an identical ASCII copy.
      await writeFile(local, bytes, { flag: 'wx' });
      assert.equal(digest(await readFile(local)), digest(bytes));
      const badging = execFileSync(
        join(buildTools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'),
        ['dump', 'badging', local],
        { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 30000 },
      );
      const certificates = execFileSync(
        java,
        ['-jar', join(buildTools, 'lib/apksigner.jar'), 'verify', '--print-certs', local],
        { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30000 },
      );
      return { bytes, metadata: readApkMetadata(badging, certificates) };
    };
    const candidate = await inspect(apk, 'candidate.apk');
    const previous = previousApk ? await inspect(previousApk, 'previous.apk') : null;
    const verification = assertUpgrade(candidate.metadata, identity, previous?.metadata);
    return {
      ...candidate,
      manifest: makeManifest(candidate.bytes, candidate.metadata, identity),
      verification,
      previous: previous
        ? { ...previous.metadata, sizeBytes: previous.bytes.length, sha256: digest(previous.bytes) }
        : null,
    };
  });
}

export async function exerciseDistribution(bytes, manifest, tls) {
  const lab = await startLocalDistribution({ bytes, manifest, tls });
  const request = (path, options = {}) =>
    requestLocal(lab.origin, path, { ...options, ca: tls?.cert });
  try {
    const checks = [];
    const config = JSON.parse((await request('/api/app/config?version=2.1.2&build=120')).body);
    assert.equal(config.download_sha256, digest(bytes));
    assert.equal(config.download_size_bytes, bytes.length);
    for (const build of [120, 123, 124, 126, 127, 128, 0, 'invalid']) {
      const result = await request(`/api/app/config?build=${build}`);
      assert.equal(result.status, 200);
      const payload = JSON.parse(result.body);
      assert.equal(
        payload.has_update,
        Number(build) > 0 && Number(build) < manifest.package.versionCode,
      );
      assert.equal(payload.must_update, false);
      assert.equal(payload.update_channel, 'stable');
      assert.match(result.headers['cache-control'], /no-store/);
      checks.push(`legacy-build-${build}`);
    }
    const downloadConfig = JSON.parse((await request('/api/download-config')).body).config;
    for (const kind of ['quick', 'normal', 'developer'])
      assert.equal(downloadConfig[kind].url, config.download_url);
    const landing = (await request('/')).body.toString();
    for (const kind of ['normal', 'web', 'ios'])
      assert.ok(landing.includes(`href="${downloadConfig[kind].url}"`));
    const maintenance = await request('/api/chat/send', { method: 'POST' });
    assert.equal(maintenance.status, 503);
    const redirected = await request('/app/chat/old-id?token=synthetic');
    assert.equal(redirected.status, 302);
    assert.equal(redirected.headers.location, `${lab.origin}/new-app/`);
    checks.push(
      'default-and-dynamic-links',
      'business-maintenance-update-available',
      'old-route-no-query-forwarding',
    );
    const full = await request(manifest.asset.path);
    assert.equal(full.status, 200);
    assert.equal(digest(full.body), manifest.asset.sha256);
    assert.equal(digest(full.body, 'sha1'), manifest.asset.sha1);
    assert.equal(full.headers['content-type'], 'application/vnd.android.package-archive');
    assert.equal(Number(full.headers['content-length']), bytes.length);
    assert.equal(full.headers['accept-ranges'], 'bytes');
    if (tls) assert.equal(full.tlsAuthorized, true);
    const split = Math.max(1, Math.floor(bytes.length / 3));
    const first = await request(manifest.asset.path, {
      headers: { Range: `bytes=0-${split - 1}` },
    });
    const resumed = await request(manifest.asset.path, { headers: { Range: `bytes=${split}-` } });
    assert.equal(first.status, 206);
    assert.equal(resumed.status, 206);
    assert.equal(
      resumed.headers['content-range'],
      `bytes ${split}-${bytes.length - 1}/${bytes.length}`,
    );
    assert.equal(digest(Buffer.concat([first.body, resumed.body])), manifest.asset.sha256);
    const stale = await request(manifest.asset.path, {
      headers: { Range: `bytes=${split}-`, 'If-Range': '"obsolete"' },
    });
    assert.equal(stale.status, 200);
    assert.equal(digest(stale.body), manifest.asset.sha256);
    const cached = await request(manifest.asset.path, {
      headers: { 'If-None-Match': full.headers.etag },
    });
    assert.equal(cached.status, 304);
    const head = await request(manifest.asset.path, { method: 'HEAD' });
    assert.equal(Number(head.headers['content-length']), bytes.length);
    assert.equal(head.body.length, 0);
    const invalidRange = await request(manifest.asset.path, {
      headers: { Range: `bytes=${bytes.length}-` },
    });
    assert.equal(invalidRange.status, 416);
    assert.equal(invalidRange.headers['content-range'], `bytes */${bytes.length}`);
    assert.match(invalidRange.headers['cache-control'], /no-store/);
    assert.equal((await request('/download-assets/missing.apk')).status, 404);
    assert.equal((await request(manifest.asset.path, { method: 'POST' })).status, 405);
    checks.push(
      'full-release-sha256-sha1',
      'range-reassembly-sha256',
      'stale-if-range-full-body',
      'head',
      'etag-304',
      'range-416',
      'missing-404',
      'write-405',
    );
    return {
      transport: tls ? 'HTTPS (explicit local CA; hostname verified)' : 'HTTP',
      bind: lab.origin,
      bytes: bytes.length,
      sha256: manifest.asset.sha256,
      checks,
    };
  } finally {
    await lab.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--help') {
    console.log(
      'Usage: node scripts/ops/migration-distribution.mjs <formal.apk> [previous-formal.apk]\nANDROID_HOME and Java required; PowerShell 7 on Windows (OpenSSL elsewhere) signs an in-memory loopback certificate. No server/device/production changes.',
    );
    return;
  }
  if (
    args.length < 1 ||
    args.length > 2 ||
    args.some((arg) => arg.startsWith('--') || !existsSync(arg))
  )
    throw new Error(
      'Supply an existing formal APK and optionally the previous formal APK; use --help',
    );
  const release = await inspectRelease(args[0], args[1]);
  const httpResult = await exerciseDistribution(release.bytes, release.manifest);
  const tls = await createLocalTls();
  let httpsResult;
  try {
    httpsResult = await exerciseDistribution(release.bytes, release.manifest, tls);
  } finally {
    tls.key.fill(0);
  }
  console.log(
    JSON.stringify(
      {
        mode: 'local-development-rehearsal',
        manifest: release.manifest,
        verification: release.verification,
        previous: release.previous,
        results: [httpResult, httpsResult],
        limits: [
          'No production DNS, TLS certificate, server or endpoint verified',
          'No device upgrade, login or migrated-history verification',
          'No load/bandwidth test',
          'No APK built, changed or delivered',
        ],
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Local rehearsal failed');
    process.exitCode = 1;
  });
}
