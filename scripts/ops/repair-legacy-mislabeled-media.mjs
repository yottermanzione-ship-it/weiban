#!/usr/bin/env node
/** Repair the four verified legacy image rows whose original files are actually MP4 video/audio. */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import { loadConfig } from '../../apps/server/src/platform/config/config.ts';
import { loadKekRing } from '../../apps/server/src/platform/crypto/kek-ring.ts';
import { EnvelopeCrypto } from '../../apps/server/src/platform/crypto/envelope.ts';
import { SystemClock } from '../../apps/server/src/platform/clock/clock.ts';
import { AuditLog } from '../../apps/server/src/platform/audit/audit-log.ts';
import { createImportMediaService } from '../../apps/server/src/modules/media/application/import-runtime.ts';
const config = loadConfig(),
  clock = new SystemClock(),
  ring = loadKekRing(config),
  db = new Database({ url: config.database.url, poolMax: 2 }),
  crypto = new EnvelopeCrypto(db, clock, ring),
  audit = new AuditLog(db, clock);
const OP = '01a12a78-aeb5-711a-a7ce-b373c65b8e53',
  planPath = '/reports/content-media-plan.json',
  plan = JSON.parse(fs.readFileSync(planPath, 'utf8')),
  initial = JSON.parse(fs.readFileSync('/reports/content-media-report.json', 'utf8'));
async function main() {
  if (
    !(
      await db.query(
        "SELECT 1 FROM identity.users WHERE id=$1 AND role='admin' AND status='active'",
        [OP],
      )
    ).rows.length
  )
    throw new Error('ACTIVE_ADMIN_REQUIRED');
  const media = createImportMediaService({
    database: db,
    config,
    clock,
    crypto,
    audit,
    apply: true,
    accountStatus: {
      getAccountStatus: async (id, tx) => {
        const r = await (tx ?? db).query(
          'SELECT status FROM identity.users WHERE id=$1 FOR KEY SHARE',
          [id],
        );
        return r.rows[0]?.status ?? 'deleted';
      },
    },
  });
  const repairs = [];
  for (const issue of initial.issues) {
    const object = plan.objects.find((o) => o.id === issue.id);
    if (!object || object.purpose !== 'chat_image' || object.asset.kind !== 'file')
      throw new Error('UNEXPECTED_REPAIR_TARGET');
    const file = path.resolve('/work', object.asset.archive);
    if (!file.startsWith('/work/media/') || fs.lstatSync(file).isSymbolicLink())
      throw new Error('REPAIR_PATH_REJECTED');
    const bytes = fs.readFileSync(file);
    if (bytes.length !== object.asset.bytes || bytes.toString('ascii', 4, 8) !== 'ftyp')
      throw new Error('REPAIR_CONTAINER_NOT_MP4');
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration:stream=codec_type,codec_name,width,height',
          '-of',
          'json',
          file,
        ],
        { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 },
      ),
    );
    const video = probe.streams.find((s) => s.codec_type === 'video'),
      audio = probe.streams.find((s) => s.codec_type === 'audio'),
      durationMs = Math.round(Number(probe.format.duration) * 1000);
    if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 300000)
      throw new Error('REPAIR_DURATION_INVALID');
    let kind;
    if (video) {
      if (video.codec_name !== 'h264') throw new Error('REPAIR_VIDEO_CODEC_UNSUPPORTED');
      const poster = execFileSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          file,
          '-an',
          '-frames:v',
          '1',
          '-vf',
          'scale=480:-2',
          '-c:v',
          'png',
          '-f',
          'image2pipe',
          'pipe:1',
        ],
        { timeout: 45000, maxBuffer: 10 * 1024 * 1024 },
      );
      await media.importLegacyObject({
        id: object.id,
        adminId: OP,
        ownerUserId: object.ownerUserId,
        purpose: 'chat_image',
        bytes,
        mimeType: 'video/mp4',
        legacyVideo: { width: video.width, height: video.height, durationMs, posterPng: poster },
      });
      kind = 'video';
      object.asset.detectedKind = 'video';
    } else if (audio) {
      const ogg = execFileSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          file,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '24000',
          '-c:a',
          'libopus',
          '-b:a',
          '48k',
          '-f',
          'ogg',
          'pipe:1',
        ],
        { timeout: 45000, maxBuffer: 10 * 1024 * 1024 },
      );
      await media.importLegacyObject({
        id: object.id,
        adminId: OP,
        ownerUserId: object.ownerUserId,
        purpose: 'chat_voice',
        bytes: ogg,
        mimeType: 'audio/ogg',
        durationMs,
      });
      kind = 'audio';
      object.purpose = 'chat_voice';
      object.durationMs = durationMs;
      object.asset.detectedKind = 'audio';
    } else throw new Error('REPAIR_MEDIA_STREAM_MISSING');
    const rows = (
      await db.query(
        "SELECT m.id,m.content_ciphertext FROM chat.messages m JOIN chat.conversations c ON c.id=m.conversation_id WHERE c.owner_user_id=$1 AND m.content_type IN ('image','voice') AND m.content_ciphertext IS NOT NULL",
        [object.ownerUserId],
      )
    ).rows;
    const plains = await crypto.openMany(
      object.ownerUserId,
      rows.map((r) => ({ aad: `chat:message:${r.id}`, sealed: r.content_ciphertext })),
    );
    let changed = 0;
    for (let i = 0; i < rows.length; i++) {
      const content = JSON.parse(plains[i].toString('utf8'));
      plains[i].fill(0);
      if (content.mediaId !== object.id) continue;
      const replacement =
        kind === 'audio'
          ? { type: 'voice', mediaId: object.id, durationMs, transcript: null }
          : { ...content, width: video.width, height: video.height, sizeBytes: bytes.length };
      const sealed = await crypto.seal(
        object.ownerUserId,
        `chat:message:${rows[i].id}`,
        JSON.stringify(replacement),
      );
      await db.query('UPDATE chat.messages SET content_type=$2,content_ciphertext=$3 WHERE id=$1', [
        rows[i].id,
        replacement.type,
        sealed,
      ]);
      changed++;
    }
    bytes.fill(0);
    repairs.push({ id: object.id, kind, durationMs, messages: changed });
  }
  fs.writeFileSync(planPath, JSON.stringify(plan), { mode: 0o600 });
  const count = Number(
    (
      await db.query(
        "SELECT count(*) n FROM media.objects WHERE id=ANY($1::uuid[]) AND state='ready'",
        [plan.objects.map((o) => o.id)],
      )
    ).rows[0].n,
  );
  const result = {
    ok: count === plan.objects.length,
    total: plan.objects.length,
    ready: count,
    remainingFailed: plan.objects.length - count,
    repairs,
  };
  fs.writeFileSync('/reports/content-media-final-report.json', JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
  await audit.record({
    module: 'media',
    action: 'legacy_mislabeled_media.repaired',
    actorType: 'admin',
    actorId: OP,
    targetType: 'legacy_media_snapshot',
    details: {
      video: repairs.filter((r) => r.kind === 'video').length,
      audio: repairs.filter((r) => r.kind === 'audio').length,
      ready: count,
    },
  });
  process.stdout.write(JSON.stringify(result) + '\n');
}
main()
  .catch((error) => {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        code:
          error.code ??
          (String(error.message).match(/^[A-Z0-9_]+$/)
            ? error.message
            : 'LEGACY_MEDIA_REPAIR_FAILED'),
      }) + '\n',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
    for (const key of ring?.keys.values() ?? []) key.fill(0);
  });
