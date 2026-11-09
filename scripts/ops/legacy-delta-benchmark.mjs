/** Representative synthetic rehearsal, including an actual pg_dump/pg_restore round trip.
 * Requires a dedicated local container/DB pair. No production flag exists.
 */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import { EnvelopeCrypto } from '../../apps/server/src/platform/crypto/envelope.ts';
import {
  openLab,
  addFixtureUser,
  addFixtureConversation,
  fixtureIncoming,
  fixturePlan,
  maintenance,
  validateContent,
  clock,
  cutoff,
} from './legacy-delta-lab.mjs';
import { applyConversationDelta, readConversationBaseline } from './legacy-delta-db.mjs';
import { fingerprint, invariant, assertIsolatedTarget } from './legacy-delta-core.mjs';

const execute = promisify(execFile);
const dockerEnv = { ...process.env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'])
  delete dockerEnv[key];
const dockerContext = (
  await execute('docker', ['context', 'show'], { env: dockerEnv })
).stdout.trim();
const dockerEndpoint = (
  await execute(
    'docker',
    ['context', 'inspect', dockerContext, '--format', '{{(index .Endpoints "docker").Host}}'],
    { env: dockerEnv },
  )
).stdout.trim();
invariant(
  /^(?:npipe:\/\/\/\/.\/pipe\/dockerDesktopLinuxEngine|unix:\/\/\/var\/run\/docker.sock)$/.test(
    dockerEndpoint,
  ),
  'LOCAL_DOCKER_REQUIRED',
);
const docker = (args, options = {}) =>
  execute('docker', ['--context', dockerContext, ...args], { ...options, env: dockerEnv });
const url = process.env.MIGRATION_BENCHMARK_DATABASE_URL;
invariant(url, 'MIGRATION_BENCHMARK_DATABASE_URL_REQUIRED');
const name = assertIsolatedTarget({ kind: 'isolated-fixture', synthetic: true, url });
invariant(name === 'codex_migration_benchmark_1109', 'BENCHMARK_DATABASE_REQUIRED');
const container = 'codex-migration-chat-1109';
const inspect = JSON.parse((await docker(['inspect', container])).stdout)[0];
invariant(
  inspect.Config.Labels['weiban.fixture'] === 'migration-1109',
  'FIXTURE_CONTAINER_REQUIRED',
);
const bindings = inspect.NetworkSettings.Ports['5432/tcp'];
invariant(
  bindings.some((item) => item.HostIp === '127.0.0.1' && item.HostPort === new URL(url).port),
  'CONTAINER_PORT_MISMATCH',
);

const measurements = {},
  total = performance.now();
const timed = async (key, action) => {
  const start = performance.now();
  const result = await action();
  measurements[key] = Math.round(performance.now() - start);
  return result;
};
let lab, recovery;
try {
  lab = await timed('schema', () => openLab(url));
  invariant(
    Number((await lab.database.query('SELECT count(*) AS n FROM identity.users')).rows[0].n) === 0,
    'EMPTY_BENCHMARK_DATABASE_REQUIRED',
  );
  const users = [],
    fixtures = [];
  await timed('seed', async () => {
    for (let n = 0; n < 580; n++) users.push((await addFixtureUser(lab)).id);
    for (let n = 0; n < 820; n++) {
      fixtures.push(
        await addFixtureConversation(lab, {
          owner: users[n % users.length],
          type: n % 30 === 0 ? 'group' : 'direct',
          oldCount: n < 700 ? 366 : 365,
          seed: n * 1000,
        }),
      );
    }
    await lab.database.query(
      "INSERT INTO billing.accounts(id,kind,user_id,balance_micros,held_micros,low_balance_threshold_micros,background_daily_limit_micros,time_zone,created_at,updated_at,version) SELECT gen_random_uuid(),'user',id,123456,0,0,0,'Asia/Shanghai',$1,$1,1 FROM identity.users",
      [cutoff],
    );
    await lab.database.query(
      'INSERT INTO identity.memberships(user_id,pro_plus_until,updated_at) SELECT id,$1,$2 FROM identity.users',
      ['2027-01-01T00:00:00Z', cutoff],
    );
  });
  const oldTotal = Number(
    (await lab.database.query('SELECT count(*) AS n FROM chat.messages')).rows[0].n,
  );
  const protectedState = async (db) => {
    const digests = {};
    for (const [table, id] of [
      ['identity.users', 'id'],
      ['identity.memberships', 'user_id'],
      ['identity.profiles', 'user_id'],
      ['billing.accounts', 'id'],
    ]) {
      digests[table] = (
        await db.query(
          `SELECT md5(string_agg(md5(row_to_json(t)::text),'' ORDER BY ${id})) AS digest FROM ${table} t`,
        )
      ).rows[0].digest;
    }
    return digests;
  };
  const protectedBefore = await protectedState(lab.database);
  const messageDigest = async (db) =>
    (
      await db.query(
        "SELECT md5(string_agg(md5(row_to_json(t)::text),'' ORDER BY id)) AS digest FROM chat.messages t",
      )
    ).rows[0].digest;
  const baselineDigest = await messageDigest(lab.database);
  const backup = await timed(
    'backup',
    async () =>
      (
        await docker(
          ['exec', container, 'pg_dump', '-U', 'postgres', '--format=custom', '--compress=1', name],
          { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 },
        )
      ).stdout,
  );
  const plans = await timed('plan', async () => {
    const result = [];
    for (let n = 0; n < fixtures.length; n++)
      result.push(
        await fixturePlan(lab, fixtures[n], fixtureIncoming(fixtures[n], n < 80 ? 57 : 56)),
      );
    return result;
  });
  const apply = (plan, fault) =>
    applyConversationDelta({ ...lab, plan, maintenance, validateContent, fault });
  let firstHalf = 0;
  await timed('partialApplyWithFailure', async () => {
    for (let n = 0; n < 410; n++) firstHalf += (await apply(plans[n])).inserted;
    const before = fingerprint(
      await readConversationBaseline(lab.database, plans[410].conversationId),
    );
    await assert.rejects(
      apply(plans[410], (stage) => {
        if (stage === 'before_receipt') throw new Error('SYNTHETIC_STOP');
      }),
      /SYNTHETIC_STOP/,
    );
    assert.equal(
      fingerprint(await readConversationBaseline(lab.database, plans[410].conversationId)),
      before,
    );
  });
  let resumed = 0,
    already = 0;
  await timed('resumeIncludingIdempotentHalf', async () => {
    for (const plan of plans) {
      const result = await apply(plan);
      resumed += result.inserted;
      if (result.status === 'already_applied') already++;
    }
  });
  await timed('reconcileAndDecryptAllNew', async () => {
    assert.equal(
      Number((await lab.database.query('SELECT count(*) AS n FROM chat.messages')).rows[0].n),
      oldTotal + 46000,
    );
    assert.equal(firstHalf + resumed, 46000);
    assert.equal(already, 410);
    assert.deepEqual(await protectedState(lab.database), protectedBefore);
    assert.equal(
      Number((await lab.database.query('SELECT count(*) AS n FROM platform.outbox')).rows[0].n),
      0,
    );
    assert.equal(
      Number(
        (await lab.database.query('SELECT count(*) AS n FROM billing.ledger_entries')).rows[0].n,
      ),
      0,
    );
    for (const plan of plans) {
      const result = await readConversationBaseline(lab.database, plan.conversationId);
      const actual = new Map(result.messages.map((row) => [row.id, row]));
      for (const old of plan.remap) assert.equal(Number(actual.get(old.id).seq), old.newSeq);
      const plaintexts = await lab.crypto.openMany(
        plan.ownerUserId,
        plan.newMessages.map((row) => ({
          aad: `chat:message:${row.id}`,
          sealed: actual.get(row.id).content_ciphertext,
        })),
      );
      try {
        for (const [index, plain] of plaintexts.entries())
          assert.deepEqual(
            validateContent(JSON.parse(plain.toString())),
            plan.newMessages[index].content,
          );
      } finally {
        plaintexts.forEach((plain) => plain.fill(0));
      }
    }
  });
  const recoveryName = 'codex_migration_recovery_1109';
  await docker(['exec', container, 'createdb', '-U', 'postgres', recoveryName]);
  await timed(
    'restore',
    () =>
      new Promise((resolve, reject) => {
        const child = spawn(
          'docker',
          [
            '--context',
            dockerContext,
            'exec',
            '-i',
            container,
            'pg_restore',
            '-U',
            'postgres',
            '--exit-on-error',
            '--dbname',
            recoveryName,
          ],
          { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true, env: dockerEnv },
        );
        let errorBytes = 0;
        child.stderr.on('data', (chunk) => {
          errorBytes += chunk.length;
        });
        child.on('error', reject);
        child.stdin.on('error', reject);
        child.on('close', (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`SYNTHETIC_RESTORE_FAILED_${code}_${errorBytes}`)),
        );
        child.stdin.end(backup);
      }),
  );
  const recoveryUrl = new URL(url);
  recoveryUrl.pathname = '/' + recoveryName;
  recovery = new Database({ url: recoveryUrl.toString(), poolMax: 2 });
  await timed('verifyRestoredBaseline', async () => {
    assert.equal(await messageDigest(recovery), baselineDigest);
    assert.deepEqual(await protectedState(recovery), protectedBefore);
    const first = (
      await recovery.query(
        'SELECT m.id,m.content_ciphertext,c.owner_user_id FROM chat.messages m JOIN chat.conversations c ON c.id=m.conversation_id ORDER BY m.id LIMIT 1',
      )
    ).rows[0];
    const restoredCrypto = new EnvelopeCrypto(recovery, clock, {
      currentVersion: 1,
      keys: new Map([[1, lab.key]]),
    });
    const plain = await restoredCrypto.open(
      first.owner_user_id,
      `chat:message:${first.id}`,
      first.content_ciphertext,
    );
    try {
      validateContent(JSON.parse(plain.toString()));
    } finally {
      plain.fill(0);
    }
    assert.equal(
      Number(
        (await recovery.query('SELECT count(*) AS n FROM public.codex_migration_receipts')).rows[0]
          .n,
      ),
      0,
    );
  });
  measurements.total = Math.round(performance.now() - total);
  console.log(
    JSON.stringify(
      {
        kind: 'synthetic-local-rehearsal',
        productionTouched: false,
        users: 580,
        conversations: 820,
        oldMessages: oldTotal,
        newMessages: 46000,
        backupBytes: backup.length,
        resumedUnits: 410,
        protectedAccountsUnchanged: true,
        allNewMessagesDecrypted: true,
        baselineRestoreVerified: true,
        milliseconds: measurements,
      },
      null,
      2,
    ),
  );
  backup.fill(0);
} finally {
  await recovery?.pool.end();
  await lab?.close();
}
