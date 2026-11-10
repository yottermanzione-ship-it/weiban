'use strict';
const path = require('node:path');
const manifest = require('./public-release.json');
function buildNumber(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}
function downloadName(url) {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      !['app.weiban.online', 'weiban.online', 'dl.weiban.online'].includes(parsed.hostname)
    )
      return null;
    if (!parsed.pathname.startsWith('/download-assets/')) return null;
    const name = path.posix.basename(parsed.pathname);
    return /^[a-zA-Z0-9._-]+\.apk$/.test(name) ? name : null;
  } catch {
    return null;
  }
}
function legacyVersion(policy, clientBuild, info) {
  const build = buildNumber(clientBuild);
  const latest = buildNumber(policy.latestVersionCode) || manifest.versionCode;
  const minimum = buildNumber(policy.minSupportedVersionCode) || manifest.minimumVersionCode;
  const name = downloadName(policy.downloadUrl) || manifest.filename;
  const hasUpdate = build > 0 && build < latest;
  return {
    latest_version: policy.latestVersion || manifest.version,
    latest_build: latest,
    min_supported_version: '1.0.0',
    min_supported_build: minimum,
    update_notes: policy.latestNote?.body || manifest.notes,
    download_url: `https://weiban.online/download-assets/${name}`,
    soft_update: true,
    force_update: minimum >= latest,
    disabled_versions: [],
    features: { voice: true, group_chat: true, early_access_panel: false },
    version_disabled: false,
    has_update: hasUpdate,
    must_update: build > 0 && build < minimum,
    update_channel: 'stable',
    download_size_bytes: info?.sizeBytes || 0,
    download_sha256: info?.sha256 || '',
    download_sha1: info?.sha1 || '',
  };
}
module.exports = { buildNumber, downloadName, legacyVersion, manifest };
