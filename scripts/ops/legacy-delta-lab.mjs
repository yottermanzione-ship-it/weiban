/** Synthetic fixtures for the isolated migration rehearsal; no real snapshots accepted. */
import '../../apps/server/node_modules/reflect-metadata/Reflect.js';
import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import { Migrator } from '../../apps/server/src/platform/db/migrator.ts';
import { EnvelopeCrypto } from '../../apps/server/src/platform/crypto/envelope.ts';
import { SettingsService } from '../../apps/server/src/modules/identity/application/settings.ts';
import { PasswordHasher } from '../../apps/server/src/modules/identity/infra/password-hasher.ts';
import { MessageContent } from '../../packages/contracts/src/http/chat.ts';
import { legacyId } from './legacy-content-rules.mjs';
import { assertIsolatedTarget, planConversationDelta } from './legacy-delta-core.mjs';
import { readConversationBaseline } from './legacy-delta-db.mjs';

export const initialCutoff = '2026-10-24T12:02:47.053609Z';
export const cutoff = '2026-11-09T00:00:00Z';
export const clock = { now: () => new Date(cutoff), nowMs: () => new Date(cutoff).getTime() };
export const validateContent = (content) => MessageContent.parse(content);
export const maintenance = { writersStopped: true, notificationsCaptured: true };
const runSeed = randomInt(1, 2000000000) * 1000000;

export async function openLab(url) {
  const target = { kind: 'isolated-fixture', synthetic: true, url };
  assertIsolatedTarget(target);
  const database = new Database({ url, poolMax: 4 });
  const existing = await database.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type='BASE TABLE'",
  );
  if (existing.rows[0].n > 0) {
    const marker = await database.query(
      "SELECT to_regclass('public.codex_migration_fixture') AS marker",
    );
    if (!marker.rows[0].marker) {
      await database.pool.end();
      throw new Error('EXISTING_NON_FIXTURE_DATABASE_REFUSED');
    }
    const marked = await database.query(
      "SELECT synthetic FROM public.codex_migration_fixture WHERE id='migration-1109'",
    );
    if (marked.rows[0]?.synthetic !== true) {
      await database.pool.end();
      throw new Error('EXISTING_NON_FIXTURE_DATABASE_REFUSED');
    }
  }
  const applied = await new Migrator(
    url,
    fileURLToPath(new URL('../../apps/server/drizzle/', import.meta.url)),
  ).up();
  await database.query(
    "CREATE TABLE IF NOT EXISTS public.codex_migration_fixture(id text PRIMARY KEY,synthetic boolean NOT NULL); INSERT INTO public.codex_migration_fixture VALUES('migration-1109',true) ON CONFLICT DO NOTHING",
  );
  await database.query(
    'CREATE TABLE IF NOT EXISTS public.codex_migration_receipts(unit uuid,digest text,inserted integer,PRIMARY KEY(unit,digest))',
  );
  const key = randomBytes(32);
  const crypto = new EnvelopeCrypto(database, clock, {
    currentVersion: 1,
    keys: new Map([[1, key]]),
  });
  const forbidden = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('SYNTHETIC_LAB_FORBIDS_EXTERNAL_SIDE_EFFECTS');
      },
    },
  );
  const settings = new SettingsService(database, forbidden, clock, forbidden, forbidden, forbidden);
  return {
    database,
    crypto,
    target,
    settings,
    appliedMigrations: applied.length,
    key,
    close: async () => {
      key.fill(0);
      await database.pool.end();
    },
  };
}

export async function addFixtureUser(lab, id = randomUUID()) {
  const password = randomBytes(32).toString('hex');
  const hash = await new PasswordHasher().hash(password);
  await lab.database.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO identity.users(id,username,password_hash,role,status,created_at,updated_at) VALUES($1,$2,$3,'user','active',$4,$4)",
      [id, 'fixture_' + id.replaceAll('-', '').slice(0, 16), hash, cutoff],
    );
    await lab.settings.createDefaults(tx, id, 'Asia/Shanghai');
  });
  return { id, password, hash };
}

export async function addFixtureConversation(
  lab,
  {
    owner,
    type = 'direct',
    oldCount = 4,
    id = randomUUID(),
    seed = 0,
    protectedState = false,
  } = {},
) {
  owner ??= (await addFixtureUser(lab)).id;
  const peer = randomUUID(),
    userParticipant = randomUUID(),
    peerParticipant = randomUUID(),
    system = randomUUID();
  await lab.database.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO chat.conversations(id,owner_user_id,type,character_id,title,system_participant_id,content_scope,last_seq,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'normal',$7,$8,$8)",
      [
        id,
        owner,
        type,
        type === 'direct' ? peer : null,
        type === 'group' ? '合成群' : null,
        system,
        oldCount,
        cutoff,
      ],
    );
    await tx.query(
      "INSERT INTO chat.participants(id,conversation_id,kind,ref_id,joined_at,read_seq) VALUES($1,$2,'user',$3,$4,$5),($6,$2,'character',$7,$4,$5)",
      [userParticipant, id, owner, cutoff, Math.min(2, oldCount), peerParticipant, peer],
    );
    await tx.query(
      'INSERT INTO chat.user_conversation_states(conversation_id,user_id,pinned,muted,hidden,cleared_through_seq,read_seq,marked_unread) VALUES($1,$2,$3,$3,$3,$4,$5,$3)',
      [id, owner, protectedState, protectedState ? 1 : 0, Math.min(2, oldCount)],
    );
    for (let start = 0; start < oldCount; start += 200) {
      const rows = Array.from({ length: Math.min(200, oldCount - start) }, (_, offset) => {
        const seq = start + offset + 1;
        return {
          id: legacyId('synthetic-target', id, seq),
          seq,
          at: new Date(Date.UTC(2026, 10, 8) + seq * 2000),
        };
      });
      const sealed = await lab.crypto.sealMany(
        owner,
        rows.map((row) => ({
          aad: `chat:message:${row.id}`,
          plaintext: JSON.stringify({
            type: 'text',
            text: '合成目标历史，不含真实用户资料。'.repeat(8),
          }),
        })),
        tx,
      );
      const params = [],
        values = [];
      for (const [index, row] of rows.entries()) {
        const data = [
          row.id,
          id,
          row.seq,
          peerParticipant,
          'character',
          randomUUID(),
          sealed[index],
          'normal',
          'normal',
          row.at,
          'text',
        ];
        values.push(
          '(' +
            data
              .map((value) => {
                params.push(value);
                return '$' + params.length;
              })
              .join(',') +
            ')',
        );
      }
      await tx.query(
        `INSERT INTO chat.messages(id,conversation_id,seq,sender_participant_id,sender_kind,client_msg_id,content_ciphertext,status,scope,created_at,content_type) VALUES ${values.join(',')}`,
        params,
      );
    }
  });
  return {
    id,
    owner,
    peer,
    userParticipant,
    peerParticipant,
    system,
    seed: runSeed + seed,
    oldCount,
  };
}

export function fixtureIncoming(fixture, count = 3, { interleave = true } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const sourceId = String(fixture.seed + index + 1);
    return {
      id: legacyId('message', 'chat_history', sourceId, 0),
      client_msg_id: legacyId('client-message', 'chat_history', sourceId, 0),
      conversation_id: fixture.id,
      owner_user_id: fixture.owner,
      sender_participant_id: fixture.peerParticipant,
      sender_kind: 'character',
      created_at: new Date(
        Date.UTC(2026, 10, 8) +
          (interleave ? index * 2000 + 1000 : fixture.oldCount * 2000 + index * 1000 + 1000),
      ).toISOString(),
      scope: 'normal',
      quote_message_id: null,
      source: { table: 'chat_history', id: sourceId, part: 0 },
      content: { type: 'text', text: '合成补迁历史，不含真实用户资料。'.repeat(8) },
    };
  });
}

export async function fixturePlan(lab, fixture, incoming = fixtureIncoming(fixture)) {
  const target = await readConversationBaseline(lab.database, fixture.id);
  return planConversationDelta({
    target,
    incoming,
    initialCutoff,
    cutoff,
    protection: { inventoryComplete: true },
  });
}
