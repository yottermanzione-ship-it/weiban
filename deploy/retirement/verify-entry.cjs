'use strict';
// Run inside the isolated archive container. Never prints credentials or user records.
const assert = require('node:assert/strict');
const { loadEnvironment } = require('./archive-environment.cjs');
const { manifest } = require('./public-entry.cjs');
loadEnvironment();
const base = 'http://127.0.0.1:8080';
async function request(path, options = {}) {
  return fetch(base + path, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) });
}
async function main() {
  const outcomes = [];
  const landing = await request('/');
  assert.equal(landing.status, 200);
  assert.ok((await landing.text()).includes('下载 Android 版'));
  outcomes.push('landing');
  const download = await request('/download-assets/' + manifest.filename, { method: 'HEAD' });
  assert.equal(download.status, 200);
  assert.equal(Number(download.headers.get('content-length')), manifest.sizeBytes);
  assert.ok(download.headers.get('content-disposition')?.includes('attachment'));
  outcomes.push('apk-download');
  for (const build of [66, 127]) {
    const response = await request('/api/app/config?version=2.0.1&build=' + build);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.latest_build, 127);
    assert.equal(result.must_update, build < 127);
    assert.equal(result.download_sha256, manifest.sha256);
  }
  outcomes.push('old-upgrade-contract');
  const redirect = await request('/app/chat?token=SYNTHETIC-NOT-A-CREDENTIAL');
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://app.weiban.online/');
  assert.equal((await request('/api/admin/overview')).status, 401);
  assert.equal((await request('/_tls/allow?domain=weiban.online')).status, 200);
  assert.equal((await request('/_tls/allow?domain=unowned.invalid')).status, 403);
  outcomes.push('redirect-and-auth-boundaries');
  const login = await request('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_TOKEN }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.ok(setCookie.includes('HttpOnly') && setCookie.includes('Secure'));
  const cookie = setCookie.split(';')[0];
  const session = await login.json();
  const headers = {
    Cookie: cookie,
    'x-admin-csrf': session.csrf_token,
    'Content-Type': 'application/json',
  };
  try {
    const overview = await request('/api/admin/overview', { headers });
    assert.equal(overview.status, 200);
    const data = await overview.json();
    assert.equal(typeof data.personas, 'number');
    outcomes.push('original-admin-login-and-overview');
    assert.equal(
      (
        await request('/api/admin/users/__synthetic_no_user__', {
          method: 'PATCH',
          headers,
          body: '{}',
        })
      ).status,
      409,
    );
    assert.equal((await request('/api/account/profile', { headers })).status, 503);
    outcomes.push('archive-mutations-blocked');
  } finally {
    assert.equal(
      (await request('/api/admin/logout', { method: 'POST', headers, body: '{}' })).status,
      200,
    );
  }
  assert.equal((await request('/api/admin/session', { headers })).status, 401);
  outcomes.push('admin-logout');
  const Sqlite = require('../node_modules/better-sqlite3');
  const db = new Sqlite('/archive-data/history.sqlite', { readonly: true, fileMustExist: true });
  try {
    assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
    const counts = {};
    for (const table of ['app_users', 'characters_v2', 'chat_history', 'group_messages'])
      counts[table] = db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
    console.log(
      JSON.stringify({
        passed: outcomes,
        archiveIntegrity: 'ok',
        counts,
        userContentPrinted: false,
      }),
    );
  } finally {
    db.close();
  }
}
main().catch(() => {
  console.error('ENTRY_VERIFICATION_FAILED');
  process.exitCode = 1;
});
