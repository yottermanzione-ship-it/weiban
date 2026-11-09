'use strict';
// Run only while the old process is stopped, after the operator's verified DB backup.
// Existing ambiguous deliveries remain untouched. No pending model job is discarded.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function inspect(database) {
  const jobs = database
    .prepare("SELECT count(*) AS n FROM chat_reply_jobs WHERE status IN ('pending','running')")
    .get().n;
  const held = database
    .prepare(
      "SELECT status,count(*) AS n FROM chat_reply_jobs WHERE status IN ('scheduled','awaiting_asr') GROUP BY status ORDER BY status",
    )
    .all();
  const groupJobs = database
    .prepare("SELECT count(*) AS n FROM group_turn_jobs WHERE status IN ('pending','running')")
    .get().n;
  const queues = {};
  for (const channel of ['wechat', 'weibo', 'qq'])
    queues[channel] = database
      .prepare(
        `SELECT status,count(*) AS n FROM ${channel}_deliveries WHERE job_id NOT LIKE 'lrout-%' GROUP BY status ORDER BY status`,
      )
      .all();
  return { jobs, groupJobs, held, queues };
}

function freeze(database, expectedDigest, backupVerified) {
  return database
    .transaction(() => {
      const before = inspect(database);
      if (
        !backupVerified ||
        hash(JSON.stringify(before)) !== expectedDigest ||
        before.jobs !== 0 ||
        before.groupJobs !== 0
      )
        throw new Error('QUEUE_FREEZE_PRECONDITION_FAILED');
      const changed = {};
      for (const channel of ['wechat', 'weibo', 'qq']) {
        const reason = channel === 'wechat' ? 'error' : 'last_error';
        changed[channel] = database
          .prepare(
            `UPDATE ${channel}_deliveries SET status='skipped',${reason}='legacy_cutover_frozen',updated_at=?
        WHERE status IN ('pending','retry','claimed','sending') AND job_id NOT LIKE 'lrout-%'`,
          )
          .run(new Date().toISOString()).changes;
      }
      return changed;
    })
    .immediate();
}

module.exports = { inspect, freeze };
if (require.main === module) {
  let database;
  try {
    const args = process.argv.slice(2),
      root = path.resolve(args[0] || '/opt/weiban-server');
    const Driver = require(path.join(root, 'node_modules/better-sqlite3'));
    const apply = args.includes('--apply');
    database = new Driver(path.join(root, 'weiban.db'), { readonly: !apply, fileMustExist: true });
    const snapshot = inspect(database),
      digest = hash(JSON.stringify(snapshot));
    let changed = null;
    if (apply) {
      const attestationPath = args[args.indexOf('--backup-attestation') + 1];
      const expected = args[args.indexOf('--expect-queue-sha256') + 1];
      const attestation = args.includes('--backup-attestation')
        ? JSON.parse(fs.readFileSync(attestationPath, 'utf8'))
        : null;
      const verified = Boolean(
        attestation &&
        attestation.oldProcessStopped === true &&
        attestation.verifiedBackupSha256 &&
        /^[0-9a-f]{64}$/.test(attestation.verifiedBackupSha256),
      );
      changed = freeze(database, expected, verified);
    }
    process.stdout.write(
      JSON.stringify({ applied: apply, snapshot, queueSha256: digest, changed }) + '\n',
    );
  } catch {
    process.stderr.write('LEGACY_RELAY_QUEUE_FREEZE_FAILED\n');
    process.exitCode = 1;
  } finally {
    database?.close();
  }
}
