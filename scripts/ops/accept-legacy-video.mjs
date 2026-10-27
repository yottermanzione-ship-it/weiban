#!/usr/bin/env node
import 'reflect-metadata';
import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import { loadConfig } from '../../apps/server/src/platform/config/config.ts';
import {
  generateSessionToken,
  hashToken,
} from '../../apps/server/src/modules/identity/domain/rules.ts';
import { MediaEndpoints } from '../../packages/contracts/src/http/media.ts';
const config = loadConfig(),
  db = new Database({ url: config.database.url, poolMax: 1 }),
  BASE = 'http://103.231.58.124',
  token = generateSessionToken(),
  sid = randomUUID();
let owner,
  issued = false;
async function main() {
  const video = (
    await db.query(
      "SELECT id,owner_id,content_hash FROM media.objects WHERE mime_type='video/mp4' AND state='ready' LIMIT 1",
    )
  ).rows[0];
  if (!video) throw new Error('MIGRATED_VIDEO_REQUIRED');
  owner = video.owner_id;
  const now = new Date();
  await db.query(
    "INSERT INTO identity.sessions(id,user_id,kind,token_hash,device,created_at,last_active_at,expires_at) VALUES($1,$2,'app',$3,$4::jsonb,$5,$5,$6)",
    [
      sid,
      owner,
      hashToken(token),
      JSON.stringify({
        platform: 'web',
        name: 'Temporary migration video verification',
        appVersion: 'migration-v1',
        timeZone: 'Asia/Shanghai',
      }),
      now,
      new Date(now.getTime() + 300000),
    ],
  );
  issued = true;
  const response = await fetch(`${BASE}/api/v1/media/${video.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  if (response.status !== 200) throw new Error('VIDEO_META_UNAVAILABLE');
  const meta = MediaEndpoints.getMedia.response.parse(await response.json());
  if (meta.mimeType !== 'video/mp4' || !meta.thumbnailUrl) throw new Error('VIDEO_POSTER_MISSING');
  const poster = await fetch(meta.thumbnailUrl, { signal: AbortSignal.timeout(20000) }),
    posterBytes = Buffer.from(await poster.arrayBuffer());
  if (
    poster.status !== 200 ||
    poster.headers.get('content-type')?.split(';')[0] !== 'image/webp' ||
    posterBytes.subarray(0, 4).toString() !== 'RIFF'
  )
    throw new Error('VIDEO_POSTER_UNAVAILABLE');
  const body = await fetch(meta.url, { signal: AbortSignal.timeout(20000) }),
    bytes = Buffer.from(await body.arrayBuffer());
  if (
    body.status !== 200 ||
    createHash('sha256').update(bytes).digest('hex') !== video.content_hash
  )
    throw new Error('VIDEO_ORIGINAL_HASH_MISMATCH');
  const page = await fetch(BASE, { cache: 'no-store', signal: AbortSignal.timeout(20000) }),
    html = await page.text(),
    entry = html.match(/<script[^>]+src="([^"]+\.js)"/);
  if (page.status !== 200 || !entry) throw new Error('WEB_ENTRY_UNAVAILABLE');
  const bundle = await fetch(new URL(entry[1], BASE), {
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  if (bundle.status !== 200) throw new Error('WEB_BUNDLE_UNAVAILABLE');
  const bundleBytes = (await bundle.arrayBuffer()).byteLength;
  if (!bundleBytes) throw new Error('WEB_BUNDLE_EMPTY');
  const result = {
    ok: true,
    checkedAt: new Date().toISOString(),
    videoBytes: bytes.length,
    originalHashMatches: true,
    posterBytes: posterBytes.length,
    posterMime: 'image/webp',
    webEntry: entry[1],
    webBundleStatus: bundle.status,
  };
  fs.writeFileSync('/reports/content-video-acceptance.json', JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
  process.stdout.write(JSON.stringify(result) + '\n');
}
main()
  .catch((error) => {
    process.stdout.write(JSON.stringify({ ok: false, code: error.message }) + '\n');
    process.exitCode = 1;
  })
  .finally(async () => {
    if (issued)
      await db.query('DELETE FROM identity.sessions WHERE id=$1 AND user_id=$2', [sid, owner]);
    await db.close();
  });
