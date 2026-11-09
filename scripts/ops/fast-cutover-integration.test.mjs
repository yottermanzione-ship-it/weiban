/** One focused, retained synthetic PG integration. No shared reset, production configuration or network media. */
import '../../apps/server/node_modules/reflect-metadata/Reflect.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import { EnvelopeCrypto } from '../../apps/server/src/platform/crypto/envelope.ts';
import { SettingsService } from '../../apps/server/src/modules/identity/application/settings.ts';
import { PasswordHasher } from '../../apps/server/src/modules/identity/infra/password-hasher.ts';
import { legacyId } from './legacy-content-rules.mjs';
import { fingerprint } from './fast-cutover-core.mjs';
import { readFastSnapshot, runFastCutover } from './fast-cutover-runner.mjs';

const TEST_DATABASE_URL = 'postgres://postgres@127.0.0.1:56389/weiban_test_codex_fast_data_1109';
const INITIAL = '2026-10-24T12:02:47.053609Z',
  CUTOFF = '2026-11-09T13:00:00.000Z',
  BENEFIT = '2026-11-09T12:00:00.000Z';
const require = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const { hash: bcryptHash } = require('@node-rs/bcrypt');
function wire(tables, capturedAt, reverse = false) {
  const snapshot = {
    version: 1,
    format: 'fast-cutover-20261109',
    initialCutoff: INITIAL,
    cutoff: CUTOFF,
    capturedAt,
    sourceFrozen: true,
    freezeId: 'synthetic-fast-1109',
    freezeCheck: 'operator-confirmed-process-stop',
    excludedOwners: 0,
  };
  const entries = [{ table: '_snapshot', row: snapshot }],
    counts = {};
  for (const [table, rows] of tables) {
    if (table !== '_media') counts[table] = rows.length;
    for (const row of reverse ? [...rows].reverse() : rows) entries.push({ table, row });
  }
  entries.push({
    table: '_complete',
    row: { counts, sourceFrozen: true, freezeId: snapshot.freezeId },
  });
  return Readable.from([gzipSync(entries.map((row) => JSON.stringify(row)).join('\n') + '\n')]);
}

test(
  'fast data pipeline on original 0162: frozen source, passwords, UUID group, history, hide, repeat',
  { timeout: 120000 },
  async () => {
    assert.equal(
      process.env.WEIBAN_FAST_MIGRATION_TEST,
      '20261109',
      'Explicit dedicated test marker required',
    );
    const database = new Database({ url: TEST_DATABASE_URL, poolMax: 1, onError: () => {} });
    database.pool.options.application_name = 'fast-cutover-20261109';
    const clock = { now: () => new Date(CUTOFF), nowMs: () => Date.parse(CUTOFF) },
      key = randomBytes(32);
    const crypto = new EnvelopeCrypto(database, clock, {
      currentVersion: 1,
      keys: new Map([[1, key]]),
    });
    const forbidden = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('TEST_EXTERNAL_SIDE_EFFECT');
        },
      },
    );
    const settings = new SettingsService(
      database,
      forbidden,
      clock,
      forbidden,
      forbidden,
      forbidden,
    );
    const createDefaults = (tx, id, zone) => settings.createDefaults(tx, id, zone);
    const hasher = new PasswordHasher();
    try {
      const identity = (
        await database.query(
          'SELECT current_database() name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid',
        )
      ).rows[0];
      assert.equal(identity.name, 'weiban_test_codex_fast_data_1109');
      assert.equal(
        (
          await database.query(
            "SELECT count(*)::int n FROM public.schema_migrations WHERE tag>='0163' ",
          )
        ).rows[0].n,
        0,
        'Test must exercise original schema without 0163/0164',
      );
      assert.match(
        (await database.query('SELECT max(tag) tag FROM public.schema_migrations')).rows[0].tag,
        /^0162_/,
      );
      const existing = randomUUID(),
        fresh = randomUUID(),
        newOnly = randomUUID(),
        contactOnly = randomUUID(),
        admin = randomUUID(),
        roleA = randomUUID(),
        roleB = randomUUID(),
        groupId = randomUUID();
      const suffix = randomBytes(6).toString('hex'),
        nameA = `Synthetic A ${suffix}`,
        nameB = `Synthetic B ${suffix}`;
      const currentPassword = randomBytes(24).toString('base64url'),
        oldPassword = String(randomInt(100000, 999999)),
        newPassword = String(randomInt(100000, 999999));
      const currentHash = await hasher.hash(currentPassword),
        oldHash = await bcryptHash(oldPassword, { cost: 4, version: '2a' }),
        newHash = await bcryptHash(newPassword, { cost: 4, version: '2a' });
      for (const [id, role] of [
        [existing, 'user'],
        [newOnly, 'user'],
        [contactOnly, 'user'],
        [admin, 'admin'],
      ])
        await database.transaction(async (tx) => {
          await tx.query(
            "INSERT INTO identity.users(id,username,password_hash,role,status,created_at,updated_at) VALUES($1,$2,$3,$4,'active',$5,$5)",
            [
              id,
              `fast_${id.replaceAll('-', '').slice(0, 16)}`,
              currentHash,
              role,
              '2026-10-01T00:00:00Z',
            ],
          );
          await createDefaults(tx, id, 'Asia/Shanghai');
        });
      await database.query(
        "UPDATE identity.profiles SET nickname='New-site synthetic profile' WHERE user_id=$1",
        [existing],
      );
      for (const [id, name] of [
        [roleA, nameA],
        [roleB, nameB],
      ])
        await database.query(
          `INSERT INTO characters.characters
      (id,kind,status,name,search_text,basis,age_setting,child_appearance,child_features_detected,published_child_features_detected,legacy_card,checks,created_at,updated_at)
      VALUES($1,'preset','published',$2,$2,'original','adult',false,false,false,$3::jsonb,'{}',$4,$4)`,
          [id, name, JSON.stringify({ display_name: name, aliases_json: [] }), CUTOFF],
        );
      const conversation = legacyId('direct-conversation', existing, roleA),
        system = legacyId('system-participant', conversation),
        userPart = legacyId('participant', conversation, 'user', existing),
        peerPart = legacyId('participant', conversation, 'character', roleA);
      await database.query(
        "INSERT INTO chat.conversations(id,owner_user_id,type,character_id,system_participant_id,content_scope,last_seq,created_at,updated_at) VALUES($1,$2,'direct',$3,$4,'normal',2,$5,$5)",
        [conversation, existing, roleA, system, '2026-10-01T00:00:00Z'],
      );
      for (const [id, kind, ref] of [
        [userPart, 'user', existing],
        [peerPart, 'character', roleA],
      ])
        await database.query(
          'INSERT INTO chat.participants(id,conversation_id,kind,ref_id,joined_at,read_seq) VALUES($1,$2,$3,$4,$5,2)',
          [id, conversation, kind, ref, CUTOFF],
        );
      await database.query(
        'INSERT INTO chat.user_conversation_states(conversation_id,user_id,hidden,read_seq,cleared_through_seq) VALUES($1,$2,true,2,0)',
        [conversation, existing],
      );
      await database.query(
        "INSERT INTO contacts.contacts(id,user_id,character_id,status,request_id,acceptance_mode,accept_after,known_since,added_at,conversation_id,relationship_type) VALUES($1,$2,$3,'active',$4,'restored',$5,'2026-10-01',$5,$6,'朋友')",
        [
          legacyId('contact', existing, roleA),
          existing,
          roleA,
          randomUUID(),
          '2026-10-01T00:00:00Z',
          conversation,
        ],
      );
      const deleteSource = String(BigInt('0x' + randomBytes(6).toString('hex'))),
        textSource = String(BigInt(deleteSource) + 1n),
        voiceSource = String(BigInt(deleteSource) + 2n),
        newSource = String(BigInt(deleteSource) + 3n);
      const deletedId = legacyId('message', 'chat_history', deleteSource, 0),
        nativeId = randomUUID();
      const oldCipher = await crypto.seal(
        existing,
        `chat:message:${deletedId}`,
        JSON.stringify({ type: 'text', text: 'Synthetic old user-deleted text' }),
      );
      const nativeCipher = await crypto.seal(
        existing,
        `chat:message:${nativeId}`,
        JSON.stringify({ type: 'text', text: 'Existing new-site synthetic message' }),
      );
      for (const row of [
        {
          id: deletedId,
          client: legacyId('client-message', 'chat_history', deleteSource, 0),
          seq: 1,
          at: '2026-10-20T00:00:00Z',
          cipher: oldCipher,
        },
        {
          id: nativeId,
          client: randomUUID(),
          seq: 2,
          at: '2026-11-08T00:00:04Z',
          cipher: nativeCipher,
        },
      ])
        await database.query(
          "INSERT INTO chat.messages(id,conversation_id,seq,sender_participant_id,sender_kind,client_msg_id,content_ciphertext,status,scope,content_type,created_at) VALUES($1,$2,$3,$4,'character',$5,$6,'normal','normal','text',$7)",
          [row.id, conversation, row.seq, peerPart, row.client, row.cipher, row.at],
        );
      await database.query(
        'INSERT INTO realtime.user_update_cursors(user_id,last_update_seq,trimmed_through) VALUES($1,7,2),($2,9,1)',
        [contactOnly, newOnly],
      );
      const legacyUser = (id, hash, createdAt) => ({
        id,
        username: `fast_${id.replaceAll('-', '').slice(0, 16)}`,
        password_hash: hash,
        status: 'active',
        created_at: createdAt,
        membership_level: 'free',
        membership_expire_at: null,
      });
      const sourceExisting = legacyUser(existing, oldHash, '2026-10-01T00:00:00Z');
      sourceExisting.membership_level = 'pro';
      sourceExisting.membership_expire_at = '2026-11-10T12:00:00Z';
      const sourceFresh = legacyUser(fresh, newHash, '2026-11-01T00:00:00Z');
      const row = (id, user, name, at, content) => ({
        id,
        user_id: user,
        persona_name: name,
        role: 'assistant',
        content,
        created_at: at,
        message_type: 'text',
        deleted_at: '',
        deletion_scope: '',
      });
      const deleted = row(
        deleteSource,
        existing,
        nameA,
        '2026-10-20T00:00:00Z',
        'Synthetic old user-deleted text',
      );
      deleted.deleted_at = '2026-11-08T01:00:00Z';
      deleted.deletion_scope = 'message';
      const voice = row(
        voiceSource,
        existing,
        nameA,
        '2026-11-08T00:00:03Z',
        'Synthetic missing voice transcript',
      );
      voice.message_type = 'voice';
      voice.audio_url = '/generated/voice/synthetic-missing.ogg';
      const tables = new Map([
        [
          'app_users',
          [sourceExisting, sourceFresh, legacyUser(contactOnly, oldHash, '2026-10-01T00:00:00Z')],
        ],
        [
          'user_friends',
          [
            { user_id: contactOnly, persona_name: nameA, added_at: '2026-11-01T00:00:00Z' },
            { user_id: existing, persona_name: nameA, added_at: '2026-10-01T00:00:00Z' },
            { user_id: fresh, persona_name: nameA, added_at: '2026-11-01T00:00:00Z' },
            { user_id: fresh, persona_name: nameB, added_at: '2026-11-01T00:00:00Z' },
          ],
        ],
        [
          'chat_groups',
          [
            {
              id: groupId,
              user_id: fresh,
              name: 'Synthetic UUID group',
              archived: 0,
              created_at: '2026-11-02T00:00:00Z',
            },
          ],
        ],
        [
          'chat_group_members',
          [
            {
              id: randomUUID(),
              group_id: groupId,
              character_name: nameA,
              created_at: '2026-11-02T00:00:00Z',
            },
            {
              id: randomUUID(),
              group_id: groupId,
              character_name: nameB,
              created_at: '2026-11-02T00:00:00Z',
            },
          ],
        ],
        [
          'chat_history',
          [
            deleted,
            row(textSource, existing, nameA, '2026-11-08T00:00:02Z', 'Synthetic interleaved text'),
            voice,
            row(newSource, fresh, nameA, '2026-11-08T00:01:00Z', 'Synthetic new private history'),
          ],
        ],
        [
          'group_messages',
          [
            {
              id: randomUUID(),
              group_id: groupId,
              user_id: '',
              sender_type: 'character',
              sender_name: nameA,
              content: 'Synthetic group text',
              message_type: 'text',
              created_at: '2026-11-08T00:02:00Z',
              deleted_at: '',
              deletion_scope: '',
            },
          ],
        ],
        [
          'chat_read_cursors',
          [{ user_id: fresh, persona_name: nameA, last_read_id: Number(newSource) }],
        ],
        [
          '_media',
          [
            {
              source: voice.audio_url,
              status: 'missing_file',
              path: '/opt/weiban-server/public/generated/voice/synthetic-missing.ogg',
            },
          ],
        ],
      ]);
      const first = await readFastSnapshot(wire(tables, '2026-11-09T13:18:00.000Z'));
      const retry = await readFastSnapshot(wire(tables, '2026-11-09T13:22:00.000Z', true));
      assert.equal(
        first.sourceDigest,
        retry.sourceDigest,
        'Capture time and row ordering cannot pollute frozen source identity',
      );
      const changed = structuredClone(tables);
      changed.get('chat_history')[1].content += ' changed';
      assert.notEqual(
        first.sourceDigest,
        (await readFastSnapshot(wire(changed, '2026-11-09T13:22:00Z'))).sourceDigest,
      );
      const args = {
        database,
        crypto,
        createDefaults,
        expectedDatabase: identity.name,
        expectedOid: identity.oid,
        confirmMaintenance: 'synthetic-fast-1109',
        operatorId: admin,
        rounding: 'ceil',
        benefitCutoverAt: BENEFIT,
      };
      const beforeCount = (await database.query('SELECT count(*)::int n FROM chat.messages'))
        .rows[0].n;
      const preview = await runFastCutover({ ...first, ...args, execute: false });
      assert.equal(preview.counts.accountsNew, 1);
      assert.equal(preview.counts.existingPasswordDifferent, 2);
      assert.equal(preview.counts.existingPasswordDifferentAlgorithm, 2);
      assert.equal(
        (await database.query('SELECT count(*)::int n FROM chat.messages')).rows[0].n,
        beforeCount,
      );
      await assert.rejects(
        runFastCutover({
          ...first,
          ...args,
          execute: true,
          snapshot: { ...first.snapshot, sourceFrozen: false },
        }),
        /FAST_FROZEN_SOURCE_REQUIRED/,
      );
      await assert.rejects(
        runFastCutover({ ...first, ...args, execute: true, rounding: 'proportional' }),
        /FAST_BENEFIT_POLICY_REQUIRED/,
      );
      const result = await runFastCutover({ ...first, ...args, execute: true });
      assert.equal(result.ok, true);
      assert.equal(result.counts.accountsNew, 1);
      assert.equal(result.counts.chatInserted, 4);
      assert.equal(result.counts.hidden, 1);
      const passwords = (
        await database.query(
          'SELECT id,password_hash FROM identity.users WHERE id=ANY($1::uuid[])',
          [[existing, fresh]],
        )
      ).rows;
      const existingHash = passwords.find((row) => row.id === existing).password_hash;
      assert.equal(existingHash, currentHash);
      assert(await hasher.verify(existingHash, currentPassword));
      assert.equal(await hasher.verify(existingHash, oldPassword), false);
      assert(
        await hasher.verify(passwords.find((row) => row.id === fresh).password_hash, newPassword),
      );
      assert.equal(
        (
          await database.query('SELECT nickname FROM identity.profiles WHERE user_id=$1', [
            existing,
          ])
        ).rows[0].nickname,
        'New-site synthetic profile',
      );
      const actual = (
        await database.query('SELECT * FROM chat.messages WHERE conversation_id=$1 ORDER BY seq', [
          conversation,
        ])
      ).rows;
      assert.deepEqual(
        actual.map((row) => row.id),
        [
          deletedId,
          legacyId('message', 'chat_history', textSource, 0),
          legacyId('message', 'chat_history', voiceSource, 0),
          nativeId,
        ],
      );
      assert.deepEqual(actual[0].content_ciphertext, oldCipher);
      assert.deepEqual(actual[3].content_ciphertext, nativeCipher);
      const plain = await crypto.open(
        existing,
        `chat:message:${actual[2].id}`,
        actual[2].content_ciphertext,
      );
      try {
        assert.match(JSON.parse(plain.toString()).text, /旧语音附件不可用/);
        assert.match(JSON.parse(plain.toString()).text, /Synthetic missing voice transcript/);
      } finally {
        plain.fill(0);
      }
      const state = (
        await database.query(
          'SELECT hidden,read_seq FROM chat.user_conversation_states WHERE conversation_id=$1 AND user_id=$2',
          [conversation, existing],
        )
      ).rows[0];
      assert.deepEqual(state, { hidden: true, read_seq: '4' });
      assert.equal(
        (
          await database.query(
            'SELECT count(*)::int n FROM chat.hidden_messages WHERE message_id=$1 AND user_id=$2',
            [deletedId, existing],
          )
        ).rows[0].n,
        1,
      );
      const targetGroup = legacyId('group-conversation', groupId);
      assert.equal(
        (await database.query('SELECT last_seq FROM chat.conversations WHERE id=$1', [targetGroup]))
          .rows[0].last_seq,
        '1',
      );
      assert.equal(
        (
          await database.query(
            'SELECT read_seq FROM chat.user_conversation_states WHERE conversation_id=$1',
            [targetGroup],
          )
        ).rows[0].read_seq,
        '0',
      );
      assert.equal(
        (
          await database.query(
            "SELECT count(*)::int n FROM platform.outbox WHERE event_type='chat.message_created'",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await database.query(
            "SELECT count(*)::int n FROM billing.ledger_entries e JOIN billing.accounts a ON a.id=e.account_id WHERE a.user_id=$1 AND e.purpose='migration_welcome_bonus'",
            [admin],
          )
        ).rows[0].n,
        0,
      );
      const snapshot = async () =>
        fingerprint(
          (
            await database.query(
              'SELECT c.id,c.last_seq,m.id AS message_id,m.seq,m.content_ciphertext FROM chat.conversations c LEFT JOIN chat.messages m ON m.conversation_id=c.id WHERE c.owner_user_id=ANY($1::uuid[]) ORDER BY c.id,m.seq',
              [[existing, fresh]],
            )
          ).rows,
        );
      const contactCursor = async () =>
        (
          await database.query(
            'SELECT last_update_seq,trimmed_through FROM realtime.user_update_cursors WHERE user_id=$1',
            [contactOnly],
          )
        ).rows[0];
      assert.deepEqual(await contactCursor(), { last_update_seq: '8', trimmed_through: '8' });
      assert.deepEqual(
        (
          await database.query(
            'SELECT last_update_seq,trimmed_through FROM realtime.user_update_cursors WHERE user_id=$1',
            [newOnly],
          )
        ).rows[0],
        { last_update_seq: '9', trimmed_through: '1' },
      );
      const after = await snapshot(),
        grantCount = (
          await database.query(
            'SELECT count(*)::int n FROM billing.ledger_entries e JOIN billing.accounts a ON a.id=e.account_id WHERE a.user_id=ANY($1::uuid[])',
            [[existing, fresh, newOnly]],
          )
        ).rows[0].n;
      const again = await runFastCutover({ ...retry, ...args, execute: true });
      assert.equal(again.counts.accountsNew, 0);
      assert.equal(again.counts.chatInserted, 0);
      assert.equal(again.counts.hidden, 0);
      assert.equal(again.counts.welcomeGrantedMicros, 0);
      assert.equal(again.counts.compensationGrantedMicros, 0);
      assert.deepEqual(await contactCursor(), { last_update_seq: '8', trimmed_through: '8' });
      assert.equal(await snapshot(), after);
      assert.equal(
        (
          await database.query(
            'SELECT count(*)::int n FROM billing.ledger_entries e JOIN billing.accounts a ON a.id=e.account_id WHERE a.user_id=ANY($1::uuid[])',
            [[existing, fresh, newOnly]],
          )
        ).rows[0].n,
        grantCount,
      );
    } finally {
      key.fill(0);
      await database.close();
    }
  },
);
