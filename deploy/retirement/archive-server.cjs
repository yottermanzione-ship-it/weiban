'use strict';
// Runs beside a frozen copy of the old backend. Never starts server.js or any worker.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadEnvironment } = require('./archive-environment.cjs');
const { buildNumber, downloadName, legacyVersion, manifest } = require('./public-entry.cjs');
const { retiredWorker } = require('./retired-worker.cjs');
const root = loadEnvironment();
const express = require(path.join(root, 'node_modules/express'));
const { createMaintenanceMiddleware } = require(path.join(root, 'lib/legacy_channel_relay.cjs'));
const { createRateLimiter, securityHeaders, errorHandler, notFoundHandler } = require(
  path.join(root, 'lib/http_security'),
);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
app.use(securityHeaders);
const downloads = '/downloads';
let policyCache = null;
const fileCache = new Map();
async function policy() {
  if (policyCache && Date.now() - policyCache.at < 15000) return policyCache.value;
  try {
    const r = await fetch(
      'http://app:3000/api/v1/app/version-check?platform=android&versionCode=1',
      { signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) throw new Error('policy');
    const value = await r.json();
    if (!buildNumber(value.latestVersionCode) || !downloadName(value.downloadUrl))
      throw new Error('policy');
    policyCache = { at: Date.now(), value };
    return value;
  } catch {
    return (
      policyCache?.value || {
        latestVersion: manifest.version,
        latestVersionCode: manifest.versionCode,
        minSupportedVersionCode: manifest.minimumVersionCode,
        downloadUrl: manifest.downloadUrl,
      }
    );
  }
}
function fileInfo(name) {
  const file = path.join(downloads, name);
  const stat = fs.statSync(file);
  const previous = fileCache.get(name);
  if (previous?.mtime === stat.mtimeMs && previous?.sizeBytes === stat.size) return previous;
  const bytes = fs.readFileSync(file);
  const info = {
    sizeBytes: stat.size,
    mtime: stat.mtimeMs,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    sha1: crypto.createHash('sha1').update(bytes).digest('hex'),
  };
  fileCache.set(name, info);
  return info;
}
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
app.get('/_tls/allow', (req, res) =>
  res.sendStatus(
    ['weiban.online', 'www.weiban.online', 'dl.weiban.online'].includes(
      String(req.query.domain || ''),
    )
      ? 200
      : 403,
  ),
);
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', mode: 'archive-read-only', legacyWorkers: false }),
);
app.get(
  '/api/app/config',
  asyncRoute(async (req, res) => {
    const current = await policy();
    const name = downloadName(current.downloadUrl) || manifest.filename;
    res.setHeader('Cache-Control', 'no-store');
    res.json(legacyVersion(current, req.query.build, fileInfo(name)));
  }),
);
app.get(
  '/api/download-config',
  asyncRoute(async (_req, res) => {
    const current = await policy();
    const name = downloadName(current.downloadUrl) || manifest.filename;
    const url = `https://weiban.online/download-assets/${name}`;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      config: { quick: { url, code: '' }, normal: { url }, developer: { url } },
    });
  }),
);
app.get(['/app/flutter_service_worker.js', '/app/sw.js'], (_req, res) =>
  res
    .type('application/javascript')
    .set('Cache-Control', 'no-store')
    .set('Service-Worker-Allowed', '/app/')
    .send(retiredWorker),
);
app.use(createMaintenanceMiddleware());
app.use(
  '/api/admin/login',
  createRateLimiter({ keyPrefix: 'archive-admin-login', windowMs: 900000, limit: 20 }),
);
app.use(express.json({ limit: '2mb' }));
app.use('/api', require(path.join(root, 'routes/admin')));
app.use('/api', require(path.join(root, 'routes/ops')));
app.use('/api', require(path.join(root, 'routes/feedback')));
app.use('/api', require(path.join(root, 'routes/invite')));
app.get('/admin', (_req, res) => res.redirect(302, '/console/'));
const consoleHtml = fs
  .readFileSync(path.join(root, 'public/console/index.html'), 'utf8')
  .replace(
    '<body>',
    '<body><div style="position:sticky;top:0;z-index:99999;background:#fff4d6;color:#735100;padding:8px 16px;font-size:13px">旧版历史资料副本，仅供查看；当前业务请使用新版管理后台。</div>',
  );
app.get(['/console', '/console/', '/console/index.html'], (_req, res) =>
  res.type('html').set('Cache-Control', 'no-store').send(consoleHtml),
);
app.use('/console', express.static(path.join(root, 'public/console'), { index: false }));
app.get('/console/*', (_req, res) =>
  res.type('html').set('Cache-Control', 'no-store').send(consoleHtml),
);
const { generatedStaticGuard, generatedStaticOptions } = require(
  path.join(root, 'lib/generated_media_store'),
);
app.use(
  '/generated',
  generatedStaticGuard,
  express.static(path.join(root, 'public/generated'), generatedStaticOptions()),
);
app.use('/official-assets', express.static(path.join(root, 'public/official-assets')));
app.use('/payment-assets', express.static(path.join(root, 'public/payment-assets')));
app.use('/stickers', express.static(path.join(root, 'public/stickers')));
app.use(
  '/download-assets',
  express.static(downloads, {
    index: false,
    setHeaders(res, file) {
      if (file.endsWith('.apk'))
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
    },
  }),
);
app.use(
  '/download-assets',
  express.static(path.join(root, 'public/download-page'), { index: false }),
);
app.get(
  '/download-assets/:name',
  asyncRoute(async (req, res, next) => {
    if (!/^[a-zA-Z0-9._-]+\.apk$/.test(req.params.name)) return next();
    const current = await policy();
    const name = downloadName(current.downloadUrl) || manifest.filename;
    if (name === req.params.name) return res.sendStatus(404);
    return res.redirect(302, `https://weiban.online/download-assets/${name}`);
  }),
);
const landingHtml = fs
  .readFileSync(path.join(root, 'public/download-page/index.html'), 'utf8')
  .replaceAll('内测阶段', '正式版本')
  .replaceAll('当前为 Android 内测版本', '当前提供 Android 正式版本');
app.get(['/', '/download', '/download/'], (req, res) => {
  if (req.hostname === 'dl.weiban.online')
    return res.redirect(302, 'https://weiban.online/#download');
  return res.type('html').set('Cache-Control', 'no-store').send(landingHtml);
});
app.use(notFoundHandler);
app.use(errorHandler);
app.listen(8080, '0.0.0.0', () => console.log('archive-entry-ready'));
