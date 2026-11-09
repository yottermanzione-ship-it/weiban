/** Candidate only. Old server receives public JSON on stdin; no app bootstrap or private output. */
const fs = require('node:fs');
const { createRequire } = require('node:module');
const args = process.argv.slice(2),
  apply = args.includes('--apply');
try {
  if (args.some((a) => !['--apply', '--plan'].includes(a)) || args.length !== 1)
    throw new Error('ARGUMENT_REQUIRED');
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (
    input.version !== '3.0.0' ||
    input.versionCode !== 127 ||
    input.minimumVersionCode !== 127 ||
    input.applicationId !== 'com.weiban.weiban' ||
    input.sha256 !== '5e0918707cdb814d6dae5a32c895fe61eb2e3b78dfdf98961cfa82c108318e87' ||
    input.sizeBytes !== 5392086 ||
    input.downloadUrl !==
      'https://app.weiban.online/download-assets/weiban-3.0.0-127-5e0918707cdb.apk' ||
    typeof input.notes !== 'string' ||
    input.notes.length > 1000
  )
    throw new Error('PUBLIC_RELEASE_MISMATCH');
  const requireOld = createRequire('/opt/weiban-server/package.json');
  const Sqlite = requireOld('better-sqlite3');
  const database = new Sqlite('/opt/weiban-server/weiban.db', {
    readonly: !apply,
    fileMustExist: true,
  });
  try {
    const result = database.transaction(() => {
      const get = (key) => {
        const r = database.prepare('SELECT value FROM system_settings WHERE key=?').get(key);
        if (!r) throw new Error('PUBLIC_CONFIG_MISSING');
        return JSON.parse(r.value);
      };
      const config = get('app.config'),
        download = get('download.config');
      const build = Number(config.latest_build);
      if (!Number.isInteger(build) || build > input.versionCode)
        throw new Error('PUBLIC_CONFIG_NEWER_OR_INVALID');
      const next = {
        ...config,
        latest_version: input.version,
        latest_build: input.versionCode,
        min_supported_build: input.minimumVersionCode,
        download_url: input.downloadUrl,
        soft_update: true,
        force_update: true,
        update_notes: input.notes,
        download_size_bytes: input.sizeBytes,
        download_sha256: input.sha256,
        test_channel: { ...(config.test_channel ?? {}), enabled: false },
      };
      const nextDownload = {
        ...download,
        quick: { ...(download.quick ?? {}), url: input.downloadUrl, code: '' },
        normal: { ...(download.normal ?? {}), url: input.downloadUrl },
        developer: { ...(download.developer ?? {}), url: input.downloadUrl },
        updated_at: new Date().toISOString(),
      };
      if (apply) {
        const update = database.prepare('UPDATE system_settings SET value=? WHERE key=?');
        update.run(JSON.stringify(next), 'app.config');
        update.run(JSON.stringify(nextDownload), 'download.config');
      }
      return {
        mode: apply ? 'applied' : 'plan',
        fromBuild: build,
        toBuild: input.versionCode,
        keys: 2,
        secretsReturned: false,
      };
    })();
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    database.close();
  }
} catch {
  process.stdout.write(
    JSON.stringify({ ok: false, category: 'PUBLIC_ENTRY_UPDATE_FAILED', secretsReturned: false }) +
      '\n',
  );
  process.exitCode = 1;
}
