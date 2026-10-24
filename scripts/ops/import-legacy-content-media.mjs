#!/usr/bin/env node
/** Encrypt snapshot media with deterministic per-user identity. Only pinned public image hosts may download. */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import { loadConfig } from '../../apps/server/src/platform/config/config.ts';
import { loadKekRing } from '../../apps/server/src/platform/crypto/kek-ring.ts';
import { EnvelopeCrypto } from '../../apps/server/src/platform/crypto/envelope.ts';
import { SystemClock } from '../../apps/server/src/platform/clock/clock.ts';
import { AuditLog } from '../../apps/server/src/platform/audit/audit-log.ts';
import { createImportMediaService } from '../../apps/server/src/modules/media/application/import-runtime.ts';
import { sniffAudioMime } from '../../apps/server/src/modules/media/application/media.ts';
import { normalizeDashscopeWav } from '../../apps/server/src/modules/model-access/infra/media-adapter.ts';
const args = new Map();
for (let i = 2; i < process.argv.length; i++) { const key = process.argv[i]; if (!['--plan', '--root', '--report', '--operator-id'].includes(key) || !process.argv[i + 1]) throw new Error('ARGUMENT_INVALID'); args.set(key, process.argv[++i]); }
for (const key of ['--plan', '--root', '--report', '--operator-id']) if (!args.has(key)) throw new Error('REQUIRED_ARGUMENT_MISSING');
const config = loadConfig(), clock = new SystemClock(), ring = loadKekRing(config), db = new Database({ url: config.database.url, poolMax: 6 });
const crypto = new EnvelopeCrypto(db, clock, ring), audit = new AuditLog(db, clock), OP = args.get('--operator-id');
const root = path.resolve(args.get('--root')), reportPath = args.get('--report');
const plan = JSON.parse(fs.readFileSync(args.get('--plan'), 'utf8'));
const cacheRoot = path.join(path.dirname(reportPath), 'external-media-cache'); fs.mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
const stats = { total: plan.objects.length, created: 0, reused: 0, failed: 0, downloadedSources: 0, audioRepaired: 0, audioTranscoded: 0, avatarBindings: 0, byPurpose: {} }, issues = [], ready = new Map(), downloads = new Map();
let next = 0;
function safeUrl(value) { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.port || !['picsum.photos', 'fastly.picsum.photos'].includes(url.hostname)) throw new Error('EXTERNAL_MEDIA_HOST_REJECTED'); return url; }
async function download(source) {
  const filename = path.join(cacheRoot, createHash('sha256').update(source).digest('hex') + '.bin');
  if (fs.existsSync(filename)) return fs.readFileSync(filename);
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let url = safeUrl(source);
      for (let hop = 0; hop < 4; hop++) {
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(25000) });
        if ([301, 302, 303, 307, 308].includes(response.status)) { await response.body?.cancel(); url = safeUrl(new URL(response.headers.get('location'), url).href); continue; }
        if (response.status !== 200) { await response.body?.cancel(); throw new Error('EXTERNAL_MEDIA_HTTP_' + response.status); }
        const chunks = []; let size = 0;
        for await (const chunk of response.body) { size += chunk.length; if (size > 10 * 1024 * 1024) throw new Error('EXTERNAL_MEDIA_TOO_LARGE'); chunks.push(chunk); }
        const bytes = Buffer.concat(chunks); if (!bytes.length) throw new Error('EXTERNAL_MEDIA_EMPTY');
        fs.writeFileSync(filename, bytes, { mode: 0o600, flag: 'wx' }); stats.downloadedSources++; return bytes;
      }
      throw new Error('EXTERNAL_MEDIA_TOO_MANY_REDIRECTS');
    } catch (error) { last = error; if (attempt < 2) await delay((attempt + 1) * 1500); }
  }
  throw last;
}
async function sourceBytes(asset) {
  if (asset.kind === 'url') { if (!downloads.has(asset.source)) downloads.set(asset.source, download(asset.source)); return Buffer.from(await downloads.get(asset.source)); }
  const filename = path.resolve(root, asset.archive);
  if (!filename.startsWith(root + path.sep) || fs.lstatSync(filename).isSymbolicLink()) throw new Error('MEDIA_SOURCE_PATH_REJECTED');
  const bytes = fs.readFileSync(filename); if (bytes.length !== asset.bytes) throw new Error('MEDIA_SOURCE_SIZE_CHANGED'); return bytes;
}
function transcode(bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-map_metadata', '-1', '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'libopus', '-b:a', '48k', '-f', 'ogg', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const output = []; let size = 0, ended = false;
    const timeout = setTimeout(() => { ended = true; child.kill('SIGKILL'); reject(new Error('LEGACY_AUDIO_TRANSCODE_TIMEOUT')); }, 45000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 10 * 1024 * 1024) child.kill('SIGKILL'); else output.push(chunk); });
    child.on('error', () => { clearTimeout(timeout); if (!ended) reject(new Error('LEGACY_AUDIO_TRANSCODE_START_FAILED')); });
    child.on('close', code => { clearTimeout(timeout); if (ended) return; if (code !== 0 || size === 0 || size > 10 * 1024 * 1024) reject(new Error('LEGACY_AUDIO_TRANSCODE_FAILED')); else resolve(Buffer.concat(output)); });
    child.stdin.on('error', () => {}); child.stdin.end(bytes);
  });
}
async function normalized(object, source) {
  const audio = ['chat_voice', 'generated_voice'].includes(object.purpose);
  if (audio) {
    let bytes = source, mime = sniffAudioMime(bytes), durationMs = Number(object.durationMs) || undefined;
    if (!mime) throw new Error('LEGACY_AUDIO_HEADER_INVALID');
    if (mime === 'audio/wav') { const fixed = normalizeDashscopeWav(bytes); if (fixed) { if (!Buffer.from(fixed).equals(bytes)) stats.audioRepaired++; bytes = Buffer.from(fixed); } else { bytes = await transcode(bytes); mime = 'audio/ogg'; stats.audioTranscoded++; } }
    if (bytes.length > 10 * 1024 * 1024) { bytes = await transcode(bytes); mime = 'audio/ogg'; stats.audioTranscoded++; }
    if (durationMs && (durationMs < 1 || durationMs > 300000)) throw new Error('LEGACY_AUDIO_DURATION_OUTSIDE_LIMIT');
    return { bytes, mimeType: mime, durationMs };
  }
  let bytes = source;
  const meta = await sharp(bytes, { animated: true, limitInputPixels: 40000000 }).metadata();
  let mimeType = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[meta.format];
  if (meta.format === 'svg') {
    const text = bytes.toString('utf8');
    if (bytes.length > 1024 * 1024 || /<!ENTITY|<!DOCTYPE|<script\b|(?:href|url\()\s*['" ]*(?:https?:|file:|\/\/)/i.test(text)) throw new Error('LEGACY_SVG_EXTERNAL_CONTENT_REJECTED');
    bytes = await sharp(bytes, { density: 144, limitInputPixels: 40000000 }).png().toBuffer(); mimeType = 'image/png';
  }
  if (!mimeType) throw new Error('LEGACY_IMAGE_FORMAT_UNSUPPORTED');
  return { bytes, mimeType };
}
async function main() {
  if (!(await db.query("SELECT 1 FROM identity.users WHERE id=$1 AND role='admin' AND status='active'", [OP])).rows.length) throw new Error('ACTIVE_ADMIN_REQUIRED');
  const media = createImportMediaService({ database: db, config, clock, crypto, audit, apply: true, accountStatus: { getAccountStatus: async (id, tx) => { const sql = tx ?? db; const r = await sql.query('SELECT status FROM identity.users WHERE id=$1 FOR KEY SHARE', [id]); return r.rows[0]?.status ?? 'deleted'; } } });
  const existing = new Map((await db.query('SELECT id,owner_id,purpose,state FROM media.objects WHERE id=ANY($1::uuid[])', [plan.objects.map(o => o.id)])).rows.map(r => [r.id, r]));
  async function worker() {
    while (next < plan.objects.length) {
      const object = plan.objects[next++];
      try {
        const old = existing.get(object.id);
        if (old) { if (old.owner_id !== object.ownerUserId || old.purpose !== object.purpose || old.state !== 'ready') throw new Error('LEGACY_MEDIA_ID_CONFLICT'); stats.reused++; ready.set(object.id, object); if (object.stickerId) await db.query('INSERT INTO media.user_stickers(id,user_id,media_id,content_hash,sort_order,created_at) VALUES($1,$2,$3,NULL,0,$4) ON CONFLICT DO NOTHING', [object.stickerId, object.ownerUserId, object.id, plan.capturedAt]); continue; }
        const source = await sourceBytes(object.asset), file = await normalized(object, source);
        const result = await media.importLegacyObject({ id: object.id, adminId: OP, ownerUserId: object.ownerUserId, purpose: object.purpose, ...file });
        if (result.created) stats.created++; else stats.reused++;
        ready.set(object.id, object); stats.byPurpose[object.purpose] = (stats.byPurpose[object.purpose] ?? 0) + 1;
        if (object.stickerId) await db.query('INSERT INTO media.user_stickers(id,user_id,media_id,content_hash,sort_order,created_at) VALUES($1,$2,$3,NULL,0,$4) ON CONFLICT DO NOTHING', [object.stickerId, object.ownerUserId, object.id, plan.capturedAt]);
        source.fill(0); file.bytes.fill(0);
      } catch (error) { stats.failed++; issues.push({ id: object.id, purpose: object.purpose, code: error.code ?? (String(error.message).match(/^[A-Z0-9_]+$/) ? error.message : 'LEGACY_MEDIA_IMPORT_FAILED') }); }
      if ((stats.created + stats.reused + stats.failed) % 250 === 0) process.stdout.write(JSON.stringify({ progress: { ...stats, byPurpose: undefined } }) + '\n');
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  for (const binding of plan.avatarBindings) {
    if (!ready.has(binding.mediaId)) continue;
    const result = binding.table === 'identity.profiles' ? await db.query('UPDATE identity.profiles SET avatar_media_id=$2 WHERE user_id=$1 AND avatar_media_id IS NULL', [binding.userId, binding.mediaId]) : await db.query('UPDATE chat.conversations SET group_avatar_media_id=$2 WHERE id=$1 AND group_avatar_media_id IS NULL', [binding.conversationId, binding.mediaId]);
    stats.avatarBindings += result.rowCount;
  }
  const result = { ok: stats.failed === 0, capturedAt: plan.capturedAt, stats, issues };
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), { mode: 0o600 });
  await audit.record({ module: 'media', action: 'legacy_content_media.imported', actorType: 'admin', actorId: OP, targetType: 'legacy_media_snapshot', details: stats });
  process.stdout.write(JSON.stringify({ ...result, issues: issues.length }) + '\n');
}
main().catch(error => { process.stdout.write(JSON.stringify({ ok: false, code: error.code ?? (String(error.message).match(/^[A-Z0-9_]+$/) ? error.message : 'LEGACY_MEDIA_BATCH_FAILED') }) + '\n'); process.exitCode = 1; }).finally(async () => { await db.close(); for (const key of ring?.keys.values() ?? []) key.fill(0); });
