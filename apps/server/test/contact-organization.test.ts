import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import request from 'supertest';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { AuthResponse, ContactOrganizationSnapshot, type ChatAdminPort } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import {
  DATABASE,
  ENVELOPE_CRYPTO,
  JOB_QUEUE,
  TestClock,
  newId,
  legacyMigrationOwnerDigest,
  type Database,
  type EnvelopeCrypto,
  type JobQueue,
} from '../src/platform/index.js';
import { CHAT_ADMIN_PORT } from '../src/modules/chat/index.js';
import {
  ContactOrganizationService,
  ContactsLifecycle,
  organizationDigest,
  organizationNameAad,
} from '../src/modules/contacts/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import {
  describeDb,
  resetTestDatabase,
  TEST_DATABASE_URL,
  roundTripMigration,
} from './support/db.js';

describeDb('contact organization: isolated HTTP/PG/encryption and migration', () => {
  let app: INestApplication,
    db: Database,
    service: ContactOrganizationService,
    crypto: EnvelopeCrypto;
  const clock = new TestClock('2026-11-09T06:00:00.000Z'),
    logs = captureLogger('silent');
  let serial = 0;
  const http = () => request(app.getHttpServer());
  async function user() {
    const n = ++serial;
    return AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/register')
          .set('X-Forwarded-For', `10.98.0.${n}`)
          .send({
            username: `organization_${n}`,
            password: randomBytes(24).toString('hex'),
            device: {
              platform: 'web',
              name: 'Synthetic organization',
              appVersion: '7.12',
              timeZone: 'Asia/Shanghai',
            },
          })
          .expect(201)
      ).body,
    );
  }
  type User = Awaited<ReturnType<typeof user>>;
  const auth = (u: User) => ({ Authorization: `Bearer ${u.session.token}` });
  const get = async (u: User) =>
    ContactOrganizationSnapshot.parse(
      (await http().get('/api/v1/contacts/organization').set(auth(u)).expect(200)).body,
    );
  const body = (
    revision = 0,
    stars: string[] = [],
    tags: ContactOrganizationSnapshot['tags'] = [],
  ) => ({ clientCommandId: newId(), expectedRevision: revision, starredCharacterIds: stars, tags });
  const put = (u: User, input: object) =>
    http().put('/api/v1/contacts/organization').set(auth(u)).send(input);
  async function contact(u: User) {
    const characterId = newId(),
      id = newId(),
      epoch = newId();
    await db.query(
      "INSERT INTO characters.characters(id,kind,status,name,search_text,basis,age_setting,child_appearance,child_features_detected,legacy_card,checks,created_at,updated_at) VALUES($1,'preset','published','Synthetic organization role','synthetic','original','adult',false,false,$2::jsonb,'{}',$3,$3)",
      [
        characterId,
        JSON.stringify({ id: characterId, name: 'Synthetic organization role' }),
        clock.now(),
      ],
    );
    const conversation = await db.transaction((tx) =>
      app
        .get<ChatAdminPort>(CHAT_ADMIN_PORT)
        .ensureDirectConversation(tx, { userId: u.user.userId, characterId, restoreHistory: true }),
    );
    await db.query(
      "INSERT INTO contacts.contacts(id,user_id,character_id,status,request_id,acceptance_mode,accept_after,known_since,added_at,conversation_id,relationship_type) VALUES($1,$2,$3,'active',$4,'new',$5,'2026-11-09',$5,$6,'朋友')",
      [id, u.user.userId, characterId, epoch, clock.now(), conversation.conversationId],
    );
    return { characterId, id, epoch, conversationId: conversation.conversationId };
  }
  beforeAll(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    const ci =
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.CI === 'true' &&
      /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') &&
      url.username === 'weiban' &&
      url.port === '5432' &&
      url.pathname === '/weiban_test';
    if (
      url.hostname !== '127.0.0.1' ||
      url.protocol !== 'postgres:' ||
      url.search ||
      url.hash ||
      (!ci && (url.port !== '56389' || url.pathname !== '/codex_migration_organization_1109'))
    )
      throw new Error('DEDICATED_ORGANIZATION_FIXTURE_REQUIRED');
    if (!ci) {
      const check = new pg.Client({ connectionString: TEST_DATABASE_URL! });
      await check.connect();
      try {
        const mark = await check.query('SELECT synthetic FROM public.codex_organization_fixture');
        if (mark.rows.length !== 1 || mark.rows[0]?.synthetic !== true)
          throw new Error('SYNTHETIC_ORGANIZATION_MARKER_REQUIRED');
      } finally {
        await check.end();
      }
    }
    await resetTestDatabase();
    await roundTripMigration('0167_contact_organization');
    const config = testConfig({ APP_ROLE: 'web', HTTP_TRUST_PROXY: 'true' });
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config,
          clock,
          logger: logs.logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpApp(app, config);
    await app.init();
    db = app.get(DATABASE);
    crypto = app.get(ENVELOPE_CRYPTO);
    service = app.get(ContactOrganizationService);
    await app.get<JobQueue>(JOB_QUEUE).start();
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  it('empty account is revision0; HTTP stores encrypted ordered tags and owner-isolated stars including empty tags', async () => {
    const a = await user(),
      b = await user(),
      one = await contact(a),
      two = await contact(a);
    expect(await get(a)).toEqual({
      revision: 0,
      starredCharacterIds: [],
      tags: [],
      updatedAt: null,
    });
    const name = '合成私密标签_CANARY',
      tagId = newId();
    const response = await put(
      a,
      body(
        0,
        [one.characterId, one.characterId],
        [
          { tagId, name: ` ${name} `, characterIds: [two.characterId, two.characterId] },
          { tagId: newId(), name: '空标签', characterIds: [] },
        ],
      ),
    ).expect(200);
    expect(response.body.snapshot).toMatchObject({
      revision: 1,
      starredCharacterIds: [one.characterId],
      tags: [
        { tagId, name, characterIds: [two.characterId] },
        { name: '空标签', characterIds: [] },
      ],
    });
    expect((await get(b)).tags).toHaveLength(0);
    const row = (
      await db.query<{ name_ciphertext: Buffer }>(
        'SELECT name_ciphertext FROM contacts.organization_tags WHERE user_id=$1 AND tag_id=$2',
        [a.user.userId, tagId],
      )
    ).rows[0]!;
    expect(row.name_ciphertext.includes(Buffer.from(name))).toBe(false);
    const clear = await crypto.open(a.user.userId, organizationNameAad(tagId), row.name_ciphertext);
    try {
      expect(clear.toString()).toBe(name);
    } finally {
      clear.fill(0);
    }
    await expect(
      crypto.open(b.user.userId, organizationNameAad(tagId), row.name_ciphertext),
    ).rejects.toThrow();
    expect(logs.capture.text).not.toContain(name);
  });
  it('CAS and command receipts: concurrent saves have one winner, exact retry returns current snapshot and cannot restore deleted tags', async () => {
    const u = await user(),
      c = await contact(u),
      tagId = newId();
    const first = body(
      0,
      [c.characterId],
      [{ tagId, name: '合成幂等标签', characterIds: [c.characterId] }],
    );
    const other = body(0, [], []);
    const results = await Promise.all([put(u, first), put(u, other)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results[0]!.status === 200 ? first : other;
    const removed = await put(u, body(1, [], [])).expect(200);
    const replay = await put(u, winner).expect(200);
    expect(replay.body).toEqual({ replayed: true, snapshot: removed.body.snapshot });
    const changed = await put(u, {
      ...winner,
      tags: [{ tagId: newId(), name: '变更后的命令', characterIds: [] }],
    }).expect(409);
    expect(changed.body.error?.code ?? changed.body.code).toBe('conflict');
    expect(
      (
        await db.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='contacts' AND table_name='organization_commands' ORDER BY column_name",
        )
      ).rows.map((row) => row.column_name),
    ).toEqual(['applied_revision', 'command_id', 'request_digest', 'user_id']);
    expect((await get(u)).tags).toHaveLength(0);
  });
  it('foreign/unknown/deleted characters, duplicate tags/names and oversized names reject atomically', async () => {
    const u = await user(),
      other = await user(),
      foreign = await contact(other),
      own = await contact(u),
      id = newId();
    for (const requestBody of [
      body(0, [foreign.characterId]),
      body(0, [newId()]),
      body(
        0,
        [],
        [
          { tagId: id, name: '同名', characterIds: [] },
          { tagId: newId(), name: ' 同名 ', characterIds: [] },
        ],
      ),
      body(
        0,
        [],
        [
          { tagId: id, name: '甲', characterIds: [] },
          { tagId: id, name: '乙', characterIds: [] },
        ],
      ),
      body(0, [], [{ tagId: id, name: '长'.repeat(101), characterIds: [] }]),
    ])
      await put(u, requestBody).expect(400);
    await http().delete(`/api/v1/contacts/${own.characterId}?mode=soft`).set(auth(u)).expect(204);
    await put(u, body(0, [own.characterId])).expect(400);
    expect((await get(u)).revision).toBe(0);
    await http().put('/api/v1/contacts/organization').send(body()).expect(401);
  });
  it('soft deletion removes only that contact and advances CAS; a new contact epoch never revives old membership', async () => {
    const u = await user(),
      a = await contact(u),
      b = await contact(u),
      tagId = newId();
    await put(
      u,
      body(
        0,
        [a.characterId, b.characterId],
        [{ tagId, name: '合成成员', characterIds: [a.characterId, b.characterId] }],
      ),
    ).expect(200);
    await http().delete(`/api/v1/contacts/${a.characterId}?mode=soft`).set(auth(u)).expect(204);
    const removed = await get(u);
    expect(removed.revision).toBe(2);
    expect(removed.starredCharacterIds).toEqual([b.characterId]);
    expect(removed.tags[0]!.characterIds).toEqual([b.characterId]);
    await db.query(
      "UPDATE contacts.contacts SET status='active',request_id=$2,deleted_at=NULL,purge_after=NULL WHERE id=$1",
      [a.id, newId()],
    );
    expect((await get(u)).starredCharacterIds).toEqual([b.characterId]);
    await put(u, body(1, [a.characterId])).expect(409);
    await db.query('UPDATE contacts.contacts SET request_id=$2 WHERE id=$1', [b.id, newId()]);
    expect((await get(u)).starredCharacterIds).toHaveLength(0);
    expect((await get(u)).tags[0]!.characterIds).toHaveLength(0);
  });
  it('permanent contact/character/account purge clears associations and all new owner tables', async () => {
    const u = await user(),
      a = await contact(u),
      b = await contact(u),
      tagId = newId();
    await put(
      u,
      body(
        0,
        [a.characterId, b.characterId],
        [{ tagId, name: '待清理合成标签', characterIds: [a.characterId, b.characterId] }],
      ),
    ).expect(200);
    await http().delete(`/api/v1/contacts/${a.characterId}?mode=purge`).set(auth(u)).expect(204);
    await db.transaction(async (tx) => {
      await app.get(ContactsLifecycle).purgeCharacter(tx, b.characterId);
      await tx.query('DELETE FROM characters.characters WHERE id=$1', [b.characterId]);
    });
    const snapshot = await get(u);
    expect(snapshot.starredCharacterIds).toHaveLength(0);
    expect(snapshot.tags[0]!.characterIds).toHaveLength(0);
    await db.query("UPDATE identity.users SET status='deleting' WHERE id=$1", [u.user.userId]);
    expect(await app.get(ContactsLifecycle).purgeUser(u.user.userId)).toBeGreaterThan(0);
    expect(await service.countUserData(u.user.userId)).toBe(0);
    await expect(service.get(u.user.userId)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await app.get(ContactsLifecycle).purgeUser(u.user.userId)).toBe(0);
  });
  it('fresh reset removes only this friend from organization and blocks destructive migration rollback', async () => {
    const u = await user(),
      a = await contact(u),
      b = await contact(u),
      tagId = newId();
    await put(
      u,
      body(
        0,
        [a.characterId, b.characterId],
        [{ tagId, name: '重置合成标签', characterIds: [a.characterId, b.characterId] }],
      ),
    ).expect(200);
    const before = await get(u);
    const down = readFileSync(
      new URL('../drizzle/0167_contact_organization.down.sql', import.meta.url),
      'utf8',
    );
    await expect(db.transaction((tx) => tx.query(down))).rejects.toThrow(
      'CONTACT_ORGANIZATION_ROLLBACK_BLOCKED',
    );
    expect(await get(u)).toEqual(before);
    await http().delete(`/api/v1/contacts/${a.characterId}?mode=reset`).set(auth(u)).expect(204);
    const current = await get(u);
    expect(current.revision).toBe(before.revision + 1);
    expect(current.starredCharacterIds).toEqual([b.characterId]);
    expect(current.tags[0]!.characterIds).toEqual([b.characterId]);
    await put(u, body(before.revision, [a.characterId])).expect(409);
  });
  it('save shares all account/encryption/sync work on one available DB connection, without chat or billing events', async () => {
    const u = await user(),
      c = await contact(u);
    const counts = async () =>
      Promise.all(
        [
          'platform.outbox',
          'billing.ledger_entries',
          'model_access.usage_records',
          'chat.messages',
        ].map(
          async (table) => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n,
        ),
      );
    const before = await counts(),
      permanent = db.pool.totalCount - db.pool.idleCount,
      reserve = (db.pool.options.max ?? 10) - permanent - 1;
    const held = await Promise.all(Array.from({ length: reserve }, () => db.pool.connect()));
    try {
      await put(
        u,
        body(
          0,
          [c.characterId],
          [{ tagId: newId(), name: '单连接合成', characterIds: [c.characterId] }],
        ),
      ).expect(200);
    } finally {
      held.forEach((client) => client.release());
    }
    expect(await counts()).toEqual(before);
    const updates = (await http().get('/api/v1/sync/updates?since=0').set(auth(u)).expect(200))
      .body;
    expect(updates.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'data.changed',
          data: { section: 'contact_organization', characterId: null, itemId: null },
        }),
      ]),
    );
  });
  it('isolated legacy import preserves cancellation/tombstones, repeats without resurrection and never publishes a user update', async () => {
    const u = await user(),
      c = await contact(u),
      empty = await get(u);
    const input = {
      sourceAccountId: u.user.userId,
      sourceDigest: 'a'.repeat(64),
      expectedTargetDigest: organizationDigest(empty),
      expectedRevision: 0,
      starredCharacterIds: [c.characterId],
      tags: [{ tagId: newId(), name: '合成旧标签', characterIds: [c.characterId] }],
      contactEpochs: [{ characterId: c.characterId, requestId: c.epoch }],
      review: {
        synthetic: true,
        decisionId: 'synthetic-organization-reviewed',
        ownershipVerified: true,
        deletionInventoryComplete: true,
        targetNeverEditedVerified: true,
        targetNoEditProofDigest: 'b'.repeat(64),
        localNewSiteStateVerified: true,
        localNewSiteStateProofDigest: 'c'.repeat(64),
      },
    };
    const before = (
      await db.query('SELECT count(*)::int AS n FROM realtime.user_updates WHERE user_id=$1', [
        u.user.userId,
      ])
    ).rows[0]!.n;
    expect((await service.importLegacy(u.user.userId, input)).status).toBe('imported');
    expect(
      (
        await db.query('SELECT count(*)::int AS n FROM realtime.user_updates WHERE user_id=$1', [
          u.user.userId,
        ])
      ).rows[0]!.n,
    ).toBe(before);
    await put(u, body(1, [], [])).expect(200);
    const replay = await service.importLegacy(u.user.userId, input);
    expect(replay.status).toBe('already_imported');
    expect(replay.snapshot.starredCharacterIds).toHaveLength(0);
    expect(replay.snapshot.tags).toHaveLength(0);
    expect(
      (await service.importLegacy(u.user.userId, { ...input, sourceDigest: 'd'.repeat(64) }))
        .status,
    ).toBe('target_preserved');
    await expect(service.importLegacy(u.user.userId, { ...input, tags: [] })).rejects.toMatchObject(
      { code: 'conflict' },
    );
  });
  it('migration exclusion is enforced internally while the same synthetic account can use ordinary HTTP save', async () => {
    const u = await user();
    await expect(
      service.importLegacy(
        u.user.userId,
        {},
        { additionalPreservedOwnerDigests: [legacyMigrationOwnerDigest(u.user.userId)] },
      ),
    ).rejects.toThrow('LEGACY_MIGRATION_OWNER_PRESERVED');
    await put(u, body(0, [], [{ tagId: newId(), name: '新版正常使用', characterIds: [] }])).expect(
      200,
    );
    expect((await get(u)).tags[0]!.name).toBe('新版正常使用');
  });
  it('actual isolated ops plan/import checks owner/epoch/proofs and unknown mappings before writes', async () => {
    const { planLegacyContactOrganization, applyLegacyContactOrganizationFixture } = (await import(
      new URL('../../../scripts/ops/legacy-contact-organization.mjs', import.meta.url).href
    )) as {
      planLegacyContactOrganization(input: unknown): { status: string };
      applyLegacyContactOrganizationFixture(input: unknown): Promise<{
        status: string;
        snapshot: ContactOrganizationSnapshot;
      }>;
    };
    const u = await user(),
      c = await contact(u),
      targetSnapshot = await get(u);
    await db.query(
      "CREATE TABLE IF NOT EXISTS public.codex_migration_fixture(id text PRIMARY KEY,synthetic boolean NOT NULL);INSERT INTO public.codex_migration_fixture VALUES('migration-1109',true) ON CONFLICT DO NOTHING",
    );
    const input = {
      sourceAccountId: u.user.userId,
      userId: u.user.userId,
      document: {
        starred: { v: 2, names: [], revisedAt: 10 },
        tags: { 已删除投影: ['unknown'] },
        _sync: {
          v: 1,
          entries: {
            tags: {
              已删除投影: { value: ['unknown'], deleted: true, revisedAt: 10 },
              合成旧空标签: { value: [], deleted: false, revisedAt: 10 },
            },
          },
        },
      },
      mappings: [
        {
          ownerUserId: u.user.userId,
          legacyName: '合成好友',
          characterId: c.characterId,
          requestId: c.epoch,
          state: 'active',
          evidenceDigest: 'a'.repeat(64),
        },
      ],
      targetSnapshot,
      review: {
        synthetic: true,
        decisionId: 'synthetic-ops-organization',
        ownershipVerified: true,
        deletionInventoryComplete: true,
        targetNeverEditedVerified: true,
        targetNoEditProofDigest: 'b'.repeat(64),
        localNewSiteStateVerified: true,
        localNewSiteStateProofDigest: 'c'.repeat(64),
      },
    };
    const plan = planLegacyContactOrganization(input);
    expect(plan.status).toBe('planned');
    const changed = structuredClone(plan) as unknown as {
      input: { tags: Array<{ name: string }> };
    };
    changed.input.tags[0]!.name = '不得静默替换的合成标签';
    await expect(
      applyLegacyContactOrganizationFixture({
        database: db,
        target: { kind: 'isolated-fixture', synthetic: true, url: TEST_DATABASE_URL },
        service,
        plan: changed,
        maintenance: { writersStopped: true, notificationsCaptured: true },
      }),
    ).rejects.toThrow('CONTACT_ORGANIZATION_PLAN_CHANGED');
    expect(await get(u)).toEqual(targetSnapshot);
    const fixtureInput = {
      database: db,
      target: { kind: 'isolated-fixture', synthetic: true, url: TEST_DATABASE_URL },
      service,
      plan,
      maintenance: { writersStopped: true, notificationsCaptured: true },
    };
    // The general CI test database is never an operational migration target.
    // Locally this same suite uses its explicit synthetic codex_migration_* DB.
    const result =
      new URL(TEST_DATABASE_URL!).pathname === '/weiban_test'
        ? await (async () => {
            await expect(applyLegacyContactOrganizationFixture(fixtureInput)).rejects.toThrow(
              'DEDICATED_DATABASE_REQUIRED',
            );
            return service.importLegacy(
              u.user.userId,
              (plan as unknown as { input: unknown }).input,
            );
          })()
        : await applyLegacyContactOrganizationFixture(fixtureInput);
    expect(result.status).toBe('imported');
    expect(result.snapshot.starredCharacterIds).toEqual([]);
    expect(result.snapshot.tags.map((tag: { name: string }) => tag.name)).toEqual(['合成旧空标签']);
    const unknown = planLegacyContactOrganization({
      ...input,
      document: { starred: ['unknown'], tags: {} },
    });
    expect(unknown.status).toBe('blocked');
    const unproved = planLegacyContactOrganization({
      ...input,
      review: { ...input.review, localNewSiteStateVerified: false },
    });
    expect(unproved.status).toBe('blocked');
  });
});
