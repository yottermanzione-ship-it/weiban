/** New-site version policy only; default is read-only planning. No automatic connection. */
export async function setFastCutoverPublicPolicy(client, entry, { execute = false } = {}) {
  if (
    entry.version !== '3.0.0' ||
    entry.versionCode !== 127 ||
    entry.downloadUrl !==
      'https://app.weiban.online/download-assets/weiban-3.0.0-127-5e0918707cdb.apk'
  )
    throw new Error('PUBLIC_ENTRY_MISMATCH');
  if (execute) await client.query('SAVEPOINT fast_public_policy');
  const old = (
    await client.query(
      "SELECT latest_version_code FROM identity.app_version_policies WHERE platform='android'" +
        (execute ? ' FOR UPDATE' : ''),
    )
  ).rows[0];
  if (Number(old?.latest_version_code ?? 0) > entry.versionCode)
    throw new Error('PUBLIC_POLICY_NEWER');
  if (execute) {
    await client.query(
      "INSERT INTO identity.app_version_policies(platform,latest_version,latest_version_code,download_url,min_supported_version_code,force_update_message,updated_at) VALUES('android',$1,$2,$3,$2,$4,now()) ON CONFLICT(platform) DO UPDATE SET latest_version=EXCLUDED.latest_version,latest_version_code=EXCLUDED.latest_version_code,download_url=EXCLUDED.download_url,min_supported_version_code=EXCLUDED.min_supported_version_code,force_update_message=EXCLUDED.force_update_message,updated_at=EXCLUDED.updated_at",
      [
        entry.version,
        entry.versionCode,
        entry.downloadUrl,
        '请覆盖安装微伴3.0.0正式版，再使用原账号登录。',
      ],
    );
    await client.query('RELEASE SAVEPOINT fast_public_policy');
  }
  return { status: execute ? 'applied' : 'planned', versionCode: entry.versionCode };
}
