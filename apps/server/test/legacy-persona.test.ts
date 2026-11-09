import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  AuthResponse,
  LegacyPersonaEndpoints as E,
  LegacyPersonaDetail,
  parseLegacyCard,
  type CharacterReadPort,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import {
  CharacterService,
  LegacyPersonaService,
  LegacyPersonaImport,
  bytesDigest,
  targetPersonaPackage,
} from '../src/modules/characters/testing.js';
import {
  AI_CHARACTER_READ,
  BrainContextService,
  ReplyContext,
} from '../src/modules/ai-runtime/testing.js';
import {
  DATABASE,
  ENVELOPE_CRYPTO,
  TestClock,
  newId,
  legacyMigrationOwnerDigest,
  type Database,
  type EnvelopeCrypto,
} from '../src/platform/index.js';
import { describeDb, resetTestDatabase, TEST_DATABASE_URL } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const now = '2026-11-09T09:00:00.000Z',
  before = '2026-10-01T00:00:00.000Z';
const up = readFileSync(
  fileURLToPath(new URL('../drizzle/0166_legacy_persona_overrides.sql', import.meta.url)),
  'utf8',
);
const down = readFileSync(
  fileURLToPath(new URL('../drizzle/0166_legacy_persona_overrides.down.sql', import.meta.url)),
  'utf8',
);
describeDb('旧专属人设：真实HTTP/PG、个人结构、公共版本与reset', () => {
  let app: INestApplication, db: Database, service: LegacyPersonaService, crypto: EnvelopeCrypto;
  const logs = captureLogger('silent'),
    clock = new TestClock(now);
  let sequence = 0;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    const ci =
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.CI === 'true' &&
      /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') &&
      url.protocol === 'postgres:' &&
      url.hostname === '127.0.0.1' &&
      url.port === '5432' &&
      url.pathname === '/weiban_test' &&
      url.username === 'weiban';
    if (
      url.hostname !== '127.0.0.1' ||
      url.search ||
      url.hash ||
      (!ci &&
        (url.pathname !== '/codex_migration_persona_1109' ||
          url.port !== '56389' ||
          url.username !== 'postgres'))
    )
      throw new Error('DEDICATED_PERSONA_DATABASE_REQUIRED');
    if (!ci) {
      const client = new pg.Client({ connectionString: TEST_DATABASE_URL! });
      await client.connect();
      try {
        const count = await client.query(
          "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type='BASE TABLE'",
        );
        if (count.rows[0].n) {
          const marker = await client.query(
            "SELECT to_regclass('public.codex_migration_fixture') marker",
          );
          if (
            !marker.rows[0].marker ||
            (
              await client.query(
                "SELECT synthetic FROM public.codex_migration_fixture WHERE id='migration-1109'",
              )
            ).rows[0]?.synthetic !== true
          )
            throw new Error('EXISTING_NON_FIXTURE_DATABASE_REFUSED');
        }
      } finally {
        await client.end();
      }
    }
    await resetTestDatabase();
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
    await app.listen(0, '127.0.0.1');
    db = app.get(DATABASE);
    service = app.get(LegacyPersonaService);
    crypto = app.get(ENVELOPE_CRYPTO);
    if (!ci)
      await db.query(
        "CREATE TABLE IF NOT EXISTS public.codex_migration_fixture(id text PRIMARY KEY,synthetic boolean NOT NULL); INSERT INTO public.codex_migration_fixture VALUES('migration-1109',true) ON CONFLICT DO NOTHING",
      );
    await db.transaction(async (tx) => {
      await tx.query(down);
      await tx.query(up);
    });
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });
  async function user() {
    const n = ++sequence;
    const auth = AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/register')
          .set('X-Forwarded-For', `10.93.0.${n}`)
          .send({
            username: `personal_${n}`,
            password: randomBytes(32).toString('hex'),
            device: {
              platform: 'web',
              name: 'Synthetic persona',
              appVersion: '7.11',
              timeZone: 'Asia/Shanghai',
            },
          })
          .expect(201)
      ).body,
    );
    return { id: auth.user.userId, token: auth.session.token };
  }
  type User = Awaited<ReturnType<typeof user>>;
  const headers = (u: User) => ({ Authorization: `Bearer ${u.token}` });
  const path = (id: string) => E.get.path.replace(':characterId', id);
  async function fixture(
    patch: Record<string, unknown> = {
      raw_persona: {
        soulspec: { personality_core: 'PRIVATE_SYNTHETIC_PERSONALITY' },
        lorebook: [{ key: 'synthetic-key', content: 'PRIVATE_SYNTHETIC_LORE' }],
        examples: [{ user: 'hi', assistant: 'PRIVATE_SYNTHETIC_EXAMPLE' }],
      },
    },
  ) {
    const owner = await user(),
      other = await user(),
      characterId = newId(),
      oldId = newId();
    const name = `Synthetic persona ${sequence}`;
    const legacy = {
      id: oldId,
      display_name: name,
      core_persona: 'PUBLIC_NEW_CORE',
      speaking_style: 'PUBLIC_NEW_SPEECH',
      relationship_mode: 'friend',
      opening_messages_json: ['public greeting'],
      raw_json: {
        schema_name: 'pangu_weiban_persona',
        soulspec: { personality_core: 'PUBLIC_STRUCTURED', values: 'PUBLIC_CURRENT_VALUES' },
      },
    };
    const lore = {
      id: `public-${characterId}`,
      trigger_keys_json: ['public-key'],
      content: 'PUBLIC_LORE',
      priority: 50,
      enabled: 1,
    };
    const example = {
      id: `public-ex-${characterId}`,
      user_text: 'public hello',
      assistant_text: 'PUBLIC_EXAMPLE',
      sort_order: 0,
    };
    await db.query(
      `INSERT INTO characters.characters(id,kind,status,name,search_text,basis,real_person_kind,age_setting,child_appearance,child_features_detected,legacy_card,checks,created_at,updated_at)
      VALUES($1,'preset','published',$2,$2,'fictional',NULL,'adult',false,false,$3::jsonb,'{}',$4,$4)`,
      [characterId, name, JSON.stringify(legacy), before],
    );
    await db.query(
      'INSERT INTO characters.legacy_lorebook_entries(id,character_id,payload,imported_at) VALUES($1,$2,$3::jsonb,$4)',
      [lore.id, characterId, JSON.stringify(lore), before],
    );
    await db.query(
      'INSERT INTO characters.legacy_example_dialogues(id,character_id,payload,sort_order,imported_at) VALUES($1,$2,$3::jsonb,0,$4)',
      [example.id, characterId, JSON.stringify(example), before],
    );
    const base = targetPersonaPackage(
      { ...legacy, core_persona: 'PUBLIC_OLD_CORE' },
      [lore],
      [example],
    );
    const packageJson = JSON.stringify(base),
      signature = randomBytes(32).toString('hex');
    const input: LegacyPersonaImport = {
      format: 'weiban-legacy-persona-v1',
      sourceAccountId: owner.id,
      characterId,
      expectedTargetDigest: (await service.targetSnapshot(owner.id, characterId)).digest,
      cutoff: now,
      source: {
        personaName: name,
        version: 7,
        state: 'customized',
        baseSignature: signature,
        baseRevision: before,
        patchJson: JSON.stringify(patch),
        updatedAt: before,
      },
      base: {
        personaName: name,
        signature,
        revision: before,
        packageJson,
        packageSha256: bytesDigest(packageJson),
      },
      evidence: {
        sourceVerified: true,
        baseVersionVerified: true,
        identityMappingVerified: true,
        targetLifecycleReviewed: true,
        classificationReviewed: true,
      },
      reviewedClassification: {
        basis: 'fictional',
        realPersonKind: null,
        ageSetting: 'adult',
        childAppearance: false,
      },
    };
    const runtime = (u = owner) =>
      app.get<CharacterReadPort>(AI_CHARACTER_READ).getForRuntime(u.id, characterId);
    return { owner, other, characterId, legacy, lore, example, input, runtime };
  }
  async function connect(owner: User, characterId: string) {
    const conversationId = newId(),
      userParticipant = newId();
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO chat.conversations(id,owner_user_id,type,character_id,system_participant_id,content_scope,last_seq,created_at,updated_at)
        VALUES($1,$2,'direct',$3,$4,'normal',0,$5,$5)`,
        [conversationId, owner.id, characterId, newId(), before],
      );
      await tx.query(
        `INSERT INTO chat.participants(id,conversation_id,kind,ref_id,joined_at,read_seq) VALUES($1,$2,'user',$3,$4,0),($5,$2,'character',$6,$4,0)`,
        [userParticipant, conversationId, owner.id, before, newId(), characterId],
      );
      await tx.query(
        'INSERT INTO chat.user_conversation_states(conversation_id,user_id) VALUES($1,$2)',
        [conversationId, owner.id],
      );
      await tx.query(
        `INSERT INTO contacts.contacts(id,user_id,character_id,status,request_id,acceptance_mode,accept_after,known_since,added_at,conversation_id,relationship_type)
        VALUES($1,$2,$3,'active',$4,'restored',$5,'2026-10-01',$5,$6,'friend')`,
        [newId(), owner.id, characterId, newId(), before, conversationId],
      );
    });
    return conversationId;
  }
  it('结构在本人运行时生效，公共卡/词条/示例及其他账号完全不变，完整原件加密往返', async () => {
    const f = await fixture();
    expect(await service.importBatch(f.owner.id, [f.input])).toEqual({
      inserted: 1,
      existing: 0,
      active: 1,
      blocked: 0,
      reset: 0,
    });
    const mine = (await f.runtime())!,
      other = (await f.runtime(f.other))!;
    expect(parseLegacyCard(mine.legacyCard)?.soulPersonality).toContain(
      'PRIVATE_SYNTHETIC_PERSONALITY',
    );
    expect(parseLegacyCard(mine.legacyCard)?.corePersona).toBe('PUBLIC_NEW_CORE');
    expect(mine.legacyContext?.lorebook[0]?.content).toBe('PRIVATE_SYNTHETIC_LORE');
    expect(mine.legacyContext?.examples[0]?.assistantText).toBe('PRIVATE_SYNTHETIC_EXAMPLE');
    expect(JSON.stringify(other)).not.toContain('PRIVATE_SYNTHETIC');
    expect(
      (await db.query('SELECT legacy_card FROM characters.characters WHERE id=$1', [f.characterId]))
        .rows[0]!.legacy_card,
    ).toEqual(f.legacy);
    expect(
      (await app.get(CharacterService).getLegacyContext(f.characterId)).lorebook[0]!.content,
    ).toBe('PUBLIC_LORE');
    const row = (
      await db.query<{ ciphertext: Buffer; version: number }>(
        'SELECT ciphertext,version FROM characters.legacy_persona_overrides WHERE user_id=$1',
        [f.owner.id],
      )
    ).rows[0]!;
    expect(row.ciphertext.includes(Buffer.from('PRIVATE_SYNTHETIC'))).toBe(false);
    const plain = await crypto.open(
      f.owner.id,
      `characters:legacy-persona:${f.owner.id}:${f.characterId}:${row.version}`,
      row.ciphertext,
    );
    try {
      const payload = JSON.parse(plain.toString());
      expect(payload.input).toEqual(f.input);
      expect(payload.targetBaseline.legacyCard).toEqual(f.legacy);
    } finally {
      plain.fill(0);
    }
    const dto = LegacyPersonaDetail.parse(
      (await http().get(path(f.characterId)).set(headers(f.owner)).expect(200)).body.item,
    );
    expect(dto.state).toBe('active');
    expect(dto.sections.map((section) => section.key)).toContain('lorebook');
    expect(dto.originalRetained).toBe(true);
    expect(
      (await http().get(path(f.characterId)).set(headers(f.other)).expect(200)).body.item,
    ).toBeNull();
    expect(logs.capture.text).not.toContain('PRIVATE_SYNTHETIC');
  });
  it('公共更新继续可见，用户明确覆盖字段继续优先，不把公共升级误判成个人冲突', async () => {
    const f = await fixture({
      legacy_fields: { speaking_style: 'PRIVATE_STYLE' },
      raw_persona: { soulspec: { personality_core: 'PRIVATE_CORE' } },
    });
    await db.query(
      "UPDATE characters.characters SET legacy_card=jsonb_set(legacy_card,'{core_persona}','\"PUBLIC_V2\"'),revision=revision+1,persona_version=persona_version+1 WHERE id=$1",
      [f.characterId],
    );
    expect((await service.importBatch(f.owner.id, [f.input])).active).toBe(1);
    let role = (await f.runtime())!;
    expect(parseLegacyCard(role.legacyCard)?.corePersona).toBe('PUBLIC_V2');
    expect(parseLegacyCard(role.legacyCard)?.speakingStyle).toBe('PRIVATE_STYLE');
    await db.query(
      "UPDATE characters.characters SET legacy_card=jsonb_set(legacy_card,'{core_persona}','\"PUBLIC_V3\"'),revision=revision+1 WHERE id=$1",
      [f.characterId],
    );
    role = (await f.runtime())!;
    expect(parseLegacyCard(role.legacyCard)?.corePersona).toBe('PUBLIC_V3');
    expect(parseLegacyCard(role.legacyCard)?.speakingStyle).toBe('PRIVATE_STYLE');
    expect(role.legacyContext?.lorebook[0]?.content).toBe('PUBLIC_LORE');
    await db.query(
      "UPDATE characters.legacy_lorebook_entries SET payload=jsonb_set(payload,'{content}','\"PUBLIC_LORE_V2\"') WHERE character_id=$1",
      [f.characterId],
    );
    expect((await f.runtime())!.legacyContext?.lorebook[0]?.content).toBe('PUBLIC_LORE_V2');
  });
  it('空数组/null/空串按原意生效，不恢复公共词条或示例', async () => {
    const f = await fixture({
      raw_persona: { lorebook: [], examples: null },
      legacy_fields: { speaking_style: '', opening_messages: [] },
    });
    await service.importBatch(f.owner.id, [f.input]);
    const role = (await f.runtime())!;
    expect(role.legacyContext).toEqual({ lorebook: [], examples: [] });
    expect(role.fallbackGreetings).toEqual([]);
    expect(parseLegacyCard(role.legacyCard)?.speakingStyle).toBe('');
  });
  it('来源版本/签名/所有者明确；并发与重跑幂等，变更同版来源拒绝', async () => {
    const f = await fixture();
    await expect(service.importBatch(f.other.id, [f.input])).rejects.toMatchObject({
      code: 'forbidden',
    });
    const results = await Promise.all([
      service.importBatch(f.owner.id, [f.input]),
      service.importBatch(f.owner.id, [f.input]),
    ]);
    expect(results.reduce((n, result) => n + result.inserted, 0)).toBe(1);
    await expect(
      service.importBatch(f.owner.id, [
        { ...f.input, source: { ...f.input.source, patchJson: '{}' } },
      ]),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('原版本reset不读旧镜像、不激活补丁；未知来源/基线/分类安全留档为blocked', async () => {
    for (const mode of [
      'reset',
      'source',
      'base',
      'signature',
      'classification',
      'unknown',
      'identity',
    ] as const) {
      const f = await fixture();
      if (mode === 'reset') f.input.source.state = 'reset';
      if (mode === 'source') f.input.evidence.sourceVerified = false;
      if (mode === 'base') f.input.base = null;
      if (mode === 'signature') f.input.source.baseSignature = 'different';
      if (mode === 'classification') f.input.evidence.classificationReviewed = false;
      if (mode === 'unknown')
        f.input.source.patchJson = JSON.stringify({
          raw_persona: { unknown_field: 'PRIVATE_UNKNOWN' },
        });
      if (mode === 'identity')
        f.input.source.patchJson = JSON.stringify({
          raw_persona: { character: { name: 'different person' } },
        });
      const result = await service.importBatch(f.owner.id, [f.input]);
      expect(result.active).toBe(0);
      const dto = (await service.get(f.owner.id, f.characterId)).item!;
      expect(dto.state).toBe(mode === 'reset' ? 'reset' : 'blocked');
      expect(JSON.stringify(await f.runtime())).not.toContain('PRIVATE_SYNTHETIC');
      if (mode === 'reset') {
        expect(dto.originalRetained).toBe(false);
        expect(dto.sections).toEqual([]);
      }
    }
  });
  it('新站本人已有补充设定保持不动；预检后再改则整批拒绝', async () => {
    const f = await fixture();
    const cipher = await crypto.seal(
      f.owner.id,
      `characters:supplement:${f.owner.id}:${f.characterId}`,
      'NEW_OWNER_SETTING',
    );
    await db.query(
      "INSERT INTO characters.user_supplements(user_id,character_id,text_ciphertext,conflicts,updated_at) VALUES($1,$2,$3,'[]',$4)",
      [f.owner.id, f.characterId, cipher, now],
    );
    await expect(service.importBatch(f.owner.id, [f.input])).rejects.toMatchObject({
      code: 'conflict',
    });
    f.input.expectedTargetDigest = (await service.targetSnapshot(f.owner.id, f.characterId)).digest;
    expect((await service.importBatch(f.owner.id, [f.input])).blocked).toBe(1);
    expect(
      (
        await db.query<{ text_ciphertext: Buffer }>(
          'SELECT text_ciphertext FROM characters.user_supplements WHERE user_id=$1',
          [f.owner.id],
        )
      ).rows[0]!.text_ciphertext,
    ).toEqual(cipher);
  });
  it('统一保留账号在服务入口就拒绝，额外合成排除不能导致任何新增或覆盖', async () => {
    const f = await fixture(),
      digest = legacyMigrationOwnerDigest(f.owner.id),
      spy = vi.spyOn(db, 'query');
    try {
      await expect(
        service.importBatch(f.owner.id, [f.input], { additionalPreservedOwnerDigests: [digest] }),
      ).rejects.toThrow('LEGACY_MIGRATION_OWNER_PRESERVED');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(
      (
        await db.query('SELECT * FROM characters.legacy_persona_overrides WHERE user_id=$1', [
          f.owner.id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (await db.query('SELECT legacy_card FROM characters.characters WHERE id=$1', [f.characterId]))
        .rows[0]!.legacy_card,
    ).toEqual(f.legacy);
  });
  it('批次第二项基线冲突时第一项也回滚，跨拥有者自定义角色不可读取或重置', async () => {
    const f = await fixture(),
      g = await fixture();
    await expect(
      service.importBatch(f.owner.id, [
        f.input,
        { ...g.input, sourceAccountId: f.owner.id, expectedTargetDigest: '0'.repeat(64) },
      ]),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(
      (
        await db.query('SELECT * FROM characters.legacy_persona_overrides WHERE user_id=$1', [
          f.owner.id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query('SELECT * FROM characters.legacy_persona_sources WHERE user_id=$1', [
          f.owner.id,
        ])
      ).rows,
    ).toHaveLength(0);
    const privateId = newId();
    await db.query(
      `INSERT INTO characters.characters(id,owner_id,kind,status,name,search_text,basis,real_person_kind,age_setting,child_appearance,child_features_detected,legacy_card,checks,created_at,updated_at)
      VALUES($1,$2,'custom','published','Synthetic private','Synthetic private','fictional',NULL,'adult',false,false,$3::jsonb,'{}',$4,$4)`,
      [privateId, f.owner.id, JSON.stringify(f.legacy), before],
    );
    await http().get(path(privateId)).set(headers(f.other)).expect(404);
    await http()
      .post(`${path(privateId)}/reset`)
      .set(headers(f.other))
      .send({ clientCommandId: newId(), expectedVersion: 0 })
      .expect(404);
  });
  it('用户私设儿童特征只取更严格；人工公共标记也不能放宽本人的限制', async () => {
    const f = await fixture({
      raw_persona: { character: { short_intro: '合成角色是一名13岁少年' } },
    });
    await db.query('UPDATE characters.characters SET eligibility_override=$2::jsonb WHERE id=$1', [
      f.characterId,
      JSON.stringify({ ...f.input.reviewedClassification, childFeaturesDetected: false }),
    ]);
    await service.importBatch(f.owner.id, [f.input]);
    expect((await f.runtime())!.classification.derived.isMinor).toBe(true);
    expect((await f.runtime(f.other))!.classification.derived.isMinor).toBe(false);
    await service.reset(f.owner.id, f.characterId, {
      clientCommandId: newId(),
      expectedVersion: 1,
    });
    expect((await f.runtime())!.classification.derived.isMinor).toBe(true);
  });
  it('真实HTTP查看/恢复默认版本化且幂等，删原文留墓碑；旧导入不能复活', async () => {
    const f = await fixture();
    await service.importBatch(f.owner.id, [f.input]);
    await http().get(path(f.characterId)).expect(401);
    await http()
      .post(`${path(f.characterId)}/reset`)
      .set(headers(f.owner))
      .send({ clientCommandId: newId(), expectedVersion: 0 })
      .expect(409);
    const body = { clientCommandId: newId(), expectedVersion: 1 };
    await http()
      .post(`${path(f.characterId)}/reset`)
      .set(headers(f.other))
      .send({ ...body, userId: f.owner.id })
      .expect(400);
    const response = (
      await http()
        .post(`${path(f.characterId)}/reset`)
        .set(headers(f.owner))
        .send(body)
        .expect(200)
    ).body;
    expect(response.item.state).toBe('reset');
    expect(response.item.sections).toEqual([]);
    expect(response.item.originalRetained).toBe(false);
    expect(
      (
        await http()
          .post(`${path(f.characterId)}/reset`)
          .set(headers(f.owner))
          .send(body)
          .expect(200)
      ).body.replayed,
    ).toBe(true);
    expect(
      (
        await db.query(
          'SELECT ciphertext FROM characters.legacy_persona_overrides WHERE user_id=$1',
          [f.owner.id],
        )
      ).rows[0]!.ciphertext,
    ).toBeNull();
    expect((await service.importBatch(f.owner.id, [f.input])).existing).toBe(1);
    await expect(
      service.importBatch(f.owner.id, [{ ...f.input, source: { ...f.input.source, version: 8 } }]),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(JSON.stringify(await f.runtime())).not.toContain('PRIVATE_SYNTHETIC');
    const listed = (await http().get(E.list.path).set(headers(f.owner)).expect(200)).body.items;
    expect(listed[0].state).toBe('reset');
  });
  it('文字/群与主动共用brain、电话上下文均读同一owner个人角色及词条/示例', async () => {
    const f = await fixture(),
      conversationId = await connect(f.owner, f.characterId);
    await service.importBatch(f.owner.id, [f.input]);
    const brain = await app
      .get(BrainContextService)
      .build(f.owner.id, f.characterId, 'normal', 'synthetic-key');
    expect(brain?.prefix).toContain('PRIVATE_SYNTHETIC_PERSONALITY');
    expect(brain?.prefix).toContain('PRIVATE_SYNTHETIC_EXAMPLE');
    expect(`${brain?.prefix}${brain?.recall}`).toContain('PRIVATE_SYNTHETIC_LORE');
    const call = await app.get(ReplyContext).buildCall({
      userId: f.owner.id,
      characterId: f.characterId,
      conversationId,
      callId: newId(),
      startedAt: clock.now(),
      turns: [{ role: 'user', content: 'synthetic-key' }],
    });
    expect(JSON.stringify(call)).toContain('PRIVATE_SYNTHETIC_PERSONALITY');
    expect(JSON.stringify(call)).toContain('PRIVATE_SYNTHETIC_LORE');
    expect((await f.runtime())!.legacyPersonaVersion).toBe(1);
  });
  it('导入不发模型任务/收费/成就；注销与公共角色删除清所有新表', async () => {
    const f = await fixture();
    const baseline = (await db.query('SELECT count(*) AS n FROM platform.outbox')).rows[0]!.n;
    await service.importBatch(f.owner.id, [f.input]);
    expect((await db.query('SELECT count(*) AS n FROM platform.outbox')).rows[0]!.n).toBe(baseline);
    expect(
      Number((await db.query('SELECT count(*) AS n FROM billing.ledger_entries')).rows[0]!.n),
    ).toBe(0);
    await db.query("UPDATE identity.users SET status='deleting' WHERE id=$1", [f.owner.id]);
    await app.get(CharacterService).purgeUser(f.owner.id);
    expect(await service.countUserData(f.owner.id)).toBe(0);
    await expect(service.importBatch(f.owner.id, [f.input])).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const g = await fixture();
    await service.importBatch(g.owner.id, [g.input]);
    await db.query('DELETE FROM characters.characters WHERE id=$1', [g.characterId]);
    expect(await service.countUserData(g.owner.id)).toBe(0);
  });
  it('0166有数据时拒绝down，失败不影响现存密文', async () => {
    const f = await fixture();
    await service.importBatch(f.owner.id, [f.input]);
    await expect(db.transaction((tx) => tx.query(down))).rejects.toThrow(
      'legacy_persona_data_requires_forward_fix',
    );
    expect((await service.get(f.owner.id, f.characterId)).item!.state).toBe('active');
  });
  it('目标来源身份后来不一致时运行时和查看接口都诚实阻断，不对错误角色套用旧源', async () => {
    const f = await fixture();
    await service.importBatch(f.owner.id, [f.input]);
    await db.query(
      "UPDATE characters.characters SET legacy_card=jsonb_set(legacy_card,'{id}',to_jsonb($2::text)) WHERE id=$1",
      [f.characterId, newId()],
    );
    expect(JSON.stringify(await f.runtime())).not.toContain('PRIVATE_SYNTHETIC');
    expect((await service.get(f.owner.id, f.characterId)).item).toMatchObject({
      state: 'blocked',
      blockedReason: 'identity_mapping_unverified',
      originalRetained: true,
    });
  });
  it('同一owner可分批承接超过40份旧定制，每批上限不变且无累计丢失', async () => {
    const f = await fixture(),
      items = [f.input];
    for (let index = 1; index < 41; index++) {
      const characterId = newId(),
        name = `Synthetic bulk persona ${index}`,
        legacy = { ...f.legacy, id: newId(), display_name: name };
      await db.query(
        `INSERT INTO characters.characters(id,kind,status,name,search_text,basis,real_person_kind,age_setting,child_appearance,child_features_detected,legacy_card,checks,created_at,updated_at)
        VALUES($1,'preset','published',$2,$2,'fictional',NULL,'adult',false,false,$3::jsonb,'{}',$4,$4)`,
        [characterId, name, JSON.stringify(legacy), before],
      );
      const packageJson = JSON.stringify(targetPersonaPackage(legacy, [], []));
      items.push({
        ...f.input,
        characterId,
        expectedTargetDigest: (await service.targetSnapshot(f.owner.id, characterId)).digest,
        source: { ...f.input.source, personaName: name },
        base: {
          ...f.input.base!,
          personaName: name,
          packageJson,
          packageSha256: bytesDigest(packageJson),
        },
      });
    }
    await expect(service.importBatch(f.owner.id, items)).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect((await service.importBatch(f.owner.id, items.slice(0, 40))).active).toBe(40);
    expect((await service.importBatch(f.owner.id, items.slice(40))).active).toBe(1);
    const counts = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM characters.legacy_persona_overrides WHERE user_id=$1 AND state='active'",
        [f.owner.id],
      )
    ).rows[0]!;
    expect(counts.n).toBe(41);
    expect((await service.list(f.owner.id)).items).toHaveLength(41);
    expect((await service.importBatch(f.owner.id, items.slice(40))).existing).toBe(1);
  }, 60_000);
});
