/** Synthetic bytes only: filesystem/transfer measurement, not provider bandwidth or playback. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { legacyId } from './legacy-content-rules.mjs';
import { buildLegacyDeltaMediaPlan, transferLegacyDeltaMedia } from './legacy-delta-media.mjs';

const temporary = await fs.realpath(os.tmpdir());
const root = await fs.mkdtemp(path.join(temporary, 'codex-migration-media-scale-'));
const sourceRoot = path.join(root, 'source'),
  stagingRoot = path.join(root, 'staging');
const files = 3228,
  bytes = 832237435,
  objects = [],
  milliseconds = {};
try {
  await fs.mkdir(sourceRoot);
  await fs.mkdir(stagingRoot);
  const start = performance.now();
  for (let index = 0; index < files; index++) {
    const size = Math.floor(bytes / files) + (index < bytes % files ? 1 : 0);
    const data = randomFillSync(Buffer.alloc(size));
    const archive = `synthetic-${index}.bin`;
    await fs.writeFile(path.join(sourceRoot, archive), data);
    const ownerUserId = legacyId('synthetic-media-owner', index % 580);
    const asset = {
      kind: 'file',
      source: `synthetic:${index}`,
      path: `/synthetic/${index}`,
      archive,
      bytes: size,
    };
    objects.push({
      id: legacyId('media', ownerUserId, 'chat_voice', asset.path),
      ownerUserId,
      purpose: 'chat_voice',
      asset,
      durationMs: 1000,
    });
    if (index < 448) {
      const secondOwner = legacyId('synthetic-media-owner', (index + 1) % 580);
      objects.push({
        id: legacyId('media', secondOwner, 'chat_voice', asset.path),
        ownerUserId: secondOwner,
        purpose: 'chat_voice',
        asset,
        durationMs: 1000,
      });
    }
  }
  milliseconds.seed = Math.round(performance.now() - start);
  let at = performance.now();
  const plan = await buildLegacyDeltaMediaPlan({ objects, sourceRoot });
  milliseconds.planAndHash = Math.round(performance.now() - at);
  assert.equal(plan.summary.ok, true);
  at = performance.now();
  const result = await transferLegacyDeltaMedia({ plan, sourceRoot, stagingRoot });
  milliseconds.transferAndVerify = Math.round(performance.now() - at);
  assert.equal(result.summary.ok, true);
  at = performance.now();
  const repeated = await transferLegacyDeltaMedia({
    plan,
    sourceRoot,
    stagingRoot,
    checkpoint: result.checkpoint,
  });
  milliseconds.resumeAndReverify = Math.round(performance.now() - at);
  assert.equal(repeated.summary.ok, true);
  console.log(
    JSON.stringify(
      {
        kind: 'synthetic-local-file-transfer',
        productionTouched: false,
        sourceFiles: files,
        sourceBytes: bytes,
        perOwnerObjects: objects.length,
        allHashesVerified: true,
        repeatedTransferVerified: true,
        mediaDecodingMeasured: false,
        networkTransferMeasured: false,
        milliseconds,
      },
      null,
      2,
    ),
  );
} finally {
  const resolved = await fs.realpath(root),
    relative = path.relative(temporary, resolved);
  assert.ok(relative.startsWith('codex-migration-media-scale-') && !relative.includes(path.sep));
  await fs.rm(resolved, { recursive: true });
}
