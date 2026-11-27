import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AuthResponse,
  MuseWeiboReceipt,
  type BillingReadPort,
  type HolidayEventPort,
  type ModelGatewayPort,
} from '@weiban/contracts';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import {
  MomentsAiService,
  MuseWeiboService,
  PlannerService,
} from '../src/modules/ai-runtime/testing.js';
import { BILLING_READ_PORT } from '../src/modules/billing/index.js';
import { AdminApiKeyService, IdentityCommands } from '../src/modules/identity/index.js';
import { MomentsService } from '../src/modules/moments/testing.js';
import { MODEL_GATEWAY_PORT } from '../src/modules/model-access/index.js';
import { HOLIDAY_EVENT_PORT } from '../src/modules/proactive/index.js';
import {
  DATABASE,
  SCOPE_MUSE_WEIBO_PUBLISH,
  SCOPE_ROLE_REQUESTS_COMPLETE,
  TestClock,
  type Database,
} from '../src/platform/index.js';
import { NestPinoLogger } from '../src/platform/logging/nest-logger.js';
import { describeDb, resetTestDatabase, roundTripMigration } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const path = '/api/v1/admin/ecology/muse-weibo';
const author = '示例工作室';
const uid = '1234567890';
const mobileId = '4331051486294436';
const code = 'Hd1N2qpta';
const publishedOn = '2026-11-22';
const device = { platform: 'web', name: 'synthetic', appVersion: '1', timeZone: 'Asia/Shanghai' };
const post = (suffix: string) => 'https://weibo.com/' + uid + '/' + suffix;
const sourceKey = (url: string) => 'weibo:' + createHash('sha256').update(url).digest('hex');

describeDb('Muse 公开微博：HTTP、PostgreSQL、朋友圈', () => {
  const role = randomUUID();
  const privateRole = randomUUID();
  const clock = new TestClock('2026-11-27T05:00:00.000Z');
  const { logger } = captureLogger();
  let app: INestApplication;
  let url: string;
  let db: Database;
  let commands: IdentityCommands;
  let muse: MuseWeiboService;
  let key: string;
  let closingKey: string;
  let friend: { id: string; token: string };
  let other: { id: string; token: string };
  let disabled: { id: string; token: string };
  let newcomer: { id: string; token: string };
  let banned: { id: string; token: string };
  let loginCount = 0;

  async function account(role: 'admin' | 'user' = 'user') {
    const username = 'muse_' + randomBytes(5).toString('hex');
    const password = randomBytes(24).toString('base64url');
    const id = await commands.createAdmin(username, password);
    if (role === 'user') await commands.setRole(username, 'user');
    const result = await request(url)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.46.1.' + ++loginCount)
      .send({ username, password, device, kind: role === 'admin' ? 'admin' : 'app' })
      .expect(200);
    return { id, token: AuthResponse.parse(result.body).session.token };
  }

  async function contact(userId: string, characterId = role) {
    const epoch = randomUUID();
    await db.query(
      `INSERT INTO contacts.contacts
        (id,user_id,character_id,status,request_id,acceptance_mode,accept_after,known_since,added_at,relationship_type,conversation_id)
        VALUES ($1,$2,$3,'active',$4,'new',$5,$6,$5,'friend',$7)`,
      [randomUUID(), userId, characterId, epoch, clock.now(), publishedOn, randomUUID()],
    );
    return epoch;
  }

  const submit = (token: string | undefined, body: object) => {
    const req = request(url).post(path);
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req.send(body);
  };
  const feed = async (token: string) =>
    (
      await request(url)
        .get('/api/v1/moments/feed')
        .set('Authorization', 'Bearer ' + token)
        .expect(200)
    ).body.items as Array<{
      text: string;
      postId: string;
      textCiphertext?: string;
      link?: { url: string; source: string };
    }>;

  beforeAll(async () => {
    await resetTestDatabase();
    await roundTripMigration('0177_muse_weibo_inbox');
    const config = testConfig({ HTTP_TRUST_PROXY: 'true' });
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config,
          logger,
          clock,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    app = module.createNestApplication({ logger: new NestPinoLogger(logger) });
    configureHttpApp(app, config);
    await app.init();
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    db = app.get(DATABASE);
    muse = app.get(MuseWeiboService);
    commands = app.get(IdentityCommands);
    const operator = await account('admin');
    const keys = app.get(AdminApiKeyService);
    key = (await keys.create('synthetic-muse', SCOPE_MUSE_WEIBO_PUBLISH, operator.id)).key;
    closingKey = (await keys.create('synthetic-closing', SCOPE_ROLE_REQUESTS_COMPLETE, operator.id))
      .key;
    friend = await account();
    disabled = await account();
    other = await account();
    newcomer = await account();
    banned = await account();

    const card = JSON.stringify({
      display_name: author,
      weibo_profile_json: JSON.stringify({ enabled: true, nickname: author, userId: uid }),
    });
    const checks = JSON.stringify({
      revision: 1,
      requiredFieldsComplete: false,
      personaStabilityPassed: false,
      hardBoundaryCasesPassed: false,
      hasFallbackGreeting: false,
      checked: false,
    });
    await db.query(
      `INSERT INTO characters.characters
        (id,owner_id,kind,status,name,search_text,basis,real_person_kind,age_setting,child_appearance,
        child_features_detected,checks,legacy_card,created_at,updated_at)
        VALUES ($1,NULL,'preset','published',$2,$2,'real_person','celebrity','adult',false,false,$3,$4,$5,$5),
               ($6,NULL,'preset','published',$2,$2,'real_person','private_person','adult',false,false,$3,$4,$5,$5)`,
      [role, author, checks, card, clock.now(), privateRole],
    );
    await contact(friend.id);
    await contact(disabled.id);
    await contact(banned.id);
    await db.query('UPDATE identity.users SET banned_at=$2 WHERE id=$1', [banned.id, clock.now()]);
    await db.query(
      `INSERT INTO ai_runtime.ecology_settings (user_id,enabled,disabled_actions,updated_at)
       VALUES ($1,false,ARRAY['weibo_sync','moment_post']::text[],$2)`,
      [disabled.id, clock.now()],
    );
  }, 120_000);

  afterAll(async () => app?.close());

  it('限制机器凭证、角色和来源，手机和桌面重试使用同一回执', async () => {
    const body = {
      characterId: role,
      authorNickname: author,
      sourceUrl: post(code),
      publishedOn,
      text: '今天发布了一段新的作品片花。',
    };
    await submit(undefined, body).expect(401);
    await submit(friend.token, body).expect(403);
    await submit(closingKey, body).expect(403);
    await request(url)
      .get('/api/v1/admin/role-requests')
      .set('Authorization', 'Bearer ' + key)
      .expect(403);
    await submit(key, { ...body, characterId: privateRole }).expect(422);
    await submit(key, { ...body, sourceUrl: post(code).replace(uid, '9876543210') }).expect(422);
    await submit(key, { ...body, sourceUrl: 'https://m.weibo.cn/detail/' + mobileId }).expect(400);
    await submit(key, { ...body, text: '这是一段病历资料。' }).expect(400);

    const oldUrl = 'https://m.weibo.cn/detail/' + mobileId;
    const oldUpdate = randomUUID();
    await db.query(
      `INSERT INTO characters.public_updates
        (id,character_id,kind,content,start_date,effective_date,source_url,
         source_key,source,status,created_at,updated_at)
        VALUES ($1,$2,'other',$3,$4,$4,$5,$6,'weibo_sync','effective',$7,$7)`,
      [oldUpdate, role, body.text, publishedOn, oldUrl, sourceKey(oldUrl), clock.now()],
    );
    const moments = app.get(MomentsService);
    const prior = await moments.createPost(null, {
      ownerUserId: friend.id,
      characterId: role,
      text: body.text,
      imageMediaIds: [],
      link: null,
      sourceRef: { kind: 'public_update', id: oldUpdate },
      forwardedPublic: true,
      idempotencyKey: 'legacy',
    });
    expect(prior.ok).toBe(true);

    const results = await Promise.all([
      submit(key, body).expect(202),
      submit(key, {
        ...body,
        sourceUrl: 'https://m.weibo.cn/status/' + mobileId + '?from=share',
        authorWeiboId: uid,
      }).expect(202),
    ]);
    const receipts = results.map((result) => MuseWeiboReceipt.parse(result.body));
    expect(receipts[0]?.receiptId).toBe(receipts[1]?.receiptId);
    expect(receipts[0]?.state).toBe('queued');
    expect(Object.keys(receipts[0]!)).toEqual(['receiptId', 'characterId', 'state', 'acceptedAt']);
    await submit(key, { ...body, text: '修改了原稿' }).expect(409);
    await request(url)
      .get(path + '/' + receipts[0]!.receiptId)
      .set('Authorization', 'Bearer ' + key)
      .expect(200);
  });

  it('暂停后自动追上全部不同原帖，生态关闭仍更新且旧微博不重复发布', async () => {
    const body = {
      characterId: role,
      authorNickname: author,
      sourceUrl: post('AbC9'),
      publishedOn,
      text: '今天发布了一段新的作品片花。',
    };
    const accepted = await submit(key, body).expect(202);
    const second = MuseWeiboReceipt.parse(accepted.body);
    const writer = vi
      .spyOn(app.get(MomentsService), 'createPost')
      .mockRejectedValueOnce(new Error('synthetic transient'));
    try {
      await muse.sweep();
    } finally {
      writer.mockRestore();
    }
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM ai_runtime.muse_weibo_inbox WHERE state='publishing'",
        )
      ).rows[0],
    ).toEqual({ count: 1 });
    clock.advance(5 * 60_000);
    await Promise.all([muse.sweep(), muse.sweep()]);
    await muse.sweep();
    expect((await muse.get(second.receiptId)).state).toBe('published');
    const counts = await db.query(
      `SELECT owner_user_id,count(*)::int AS count FROM moments.posts
        WHERE author_character_id=$1 GROUP BY owner_user_id ORDER BY owner_user_id`,
      [role],
    );
    expect(counts.rows).toHaveLength(2);
    expect(counts.rows).toEqual(
      expect.arrayContaining([
        { owner_user_id: friend.id, count: 2 },
        { owner_user_id: disabled.id, count: 2 },
      ]),
    );
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM characters.public_updates WHERE character_id=$1',
          [role],
        )
      ).rows[0],
    ).toEqual({ count: 2 });
    expect(await feed(friend.token)).toHaveLength(2);
    expect(await feed(disabled.token)).toHaveLength(2);
    expect(await feed(other.token)).toHaveLength(0);
    const published = (await feed(disabled.token)).find((item) => item.link?.source === '微博');
    expect(published?.text).toContain(body.text);
    expect(published?.textCiphertext).toBeUndefined();

    const eventsFor = (userId: string) =>
      db.query<{ muse: boolean | null }>(
        `SELECT (event->'payload'->>'museWeibo')::boolean AS muse FROM platform.outbox
        WHERE event_type='moments.post_created' AND event->'payload'->>'ownerUserId'=$1`,
        [userId],
      );
    expect((await eventsFor(disabled.id)).rows).toEqual([{ muse: true }, { muse: true }]);

    const epoch = await contact(newcomer.id);
    const countUpdates = () =>
      db.query('SELECT count(*)::int AS count FROM realtime.user_updates WHERE user_id=$1', [
        newcomer.id,
      ]);
    const updatesBefore = (await countUpdates()).rows;
    await muse.backfillContact({ userId: newcomer.id, characterId: role, epoch, afterId: null });
    expect(await feed(newcomer.token)).toHaveLength(2);
    expect((await eventsFor(newcomer.id)).rows).toEqual([]);
    expect((await countUpdates()).rows).toEqual(updatesBefore);
    await db.query(
      "UPDATE contacts.contacts SET status='deleted', deleted_at=$3,purge_after=$3 WHERE user_id=$1 AND character_id=$2",
      [newcomer.id, role, clock.now()],
    );
    expect(await feed(newcomer.token)).toHaveLength(0);
  });
  it('普通自定义角色只在本人开启生态和私人朋友圈后发布', async () => {
    clock.advance(9 * 3600_000);
    const ordinary = randomUUID();
    const memberUntil = new Date(clock.nowMs() + 86400_000);
    await db.query(
      `INSERT INTO characters.characters
        (id,owner_id,kind,status,name,search_text,basis,age_setting,child_appearance,
        child_features_detected,checks,legacy_card,created_at,updated_at)
        SELECT $1,$2,'custom','active','合成普通角色','合成普通角色','original','adult',false,false,
          checks,$3,$4,$4 FROM characters.characters WHERE id=$5`,
      [
        ordinary,
        disabled.id,
        JSON.stringify({
          display_name: '合成普通角色',
          core_persona: '喜欢日常手作',
          moment_profile_json: { frequency_per_week: [7, 7] },
        }),
        clock.now(),
        role,
      ],
    );
    await contact(disabled.id, ordinary);
    await db.query(
      'INSERT INTO identity.memberships(user_id,pro_plus_until,updated_at) VALUES($1,$2,$3)',
      [disabled.id, memberUntil, clock.now()],
    );
    const patch = (body: object) =>
      request(url)
        .patch('/api/v1/me/ecology')
        .set('Authorization', 'Bearer ' + disabled.token)
        .send(body)
        .expect(200);
    const billing = vi
      .spyOn(app.get<BillingReadPort>(BILLING_READ_PORT), 'getSpendStatus')
      .mockResolvedValue({
        availableMicros: 100_000,
        depleted: false,
        insufficient: false,
        backgroundRemainingTodayMicros: 100_000,
      });
    const holiday = vi
      .spyOn(app.get<HolidayEventPort>(HOLIDAY_EVENT_PORT), 'getUpcomingForUser')
      .mockResolvedValue([
        {
          daysAhead: 0,
          holidayId: 'synthetic_day',
          name: '手作日',
          romantic: false,
          date: '2026-11-27',
        },
      ]);
    const plan = vi.spyOn(app.get(PlannerService), 'decide').mockResolvedValue({
      choice: 'post_at:9',
      confidence: 1,
      reason: 'synthetic',
      implementation: 'rules',
      fallback: null,
      usageRecordId: null,
    });
    const gateway = vi
      .spyOn(app.get<ModelGatewayPort>(MODEL_GATEWAY_PORT), 'generateText')
      .mockResolvedValue({
        ok: true,
        value: {
          text: '给刚做好的一只陶杯留个纪念。',
          modelKey: 'synthetic-model',
          usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 8, estimated: false },
          chargedMicros: 0,
          latencyMs: 1,
          usageRecordId: randomUUID(),
        },
      });
    try {
      const momentsAi = app.get(MomentsAiService);
      await momentsAi.maybePost(disabled.id, ordinary);
      const stillOff = await patch({ enabled: true });
      expect(
        stillOff.body.actions.find((item: { key: string }) => item.key === 'private_moments')
          ?.enabled,
      ).toBe(false);
      await momentsAi.maybePost(disabled.id, ordinary);
      expect(gateway).not.toHaveBeenCalled();
      await patch({ actions: [{ key: 'private_moments', enabled: true }] });
      await Promise.all([
        momentsAi.maybePost(disabled.id, ordinary),
        momentsAi.maybePost(disabled.id, ordinary),
      ]);
      expect(gateway).toHaveBeenCalledTimes(1);
      expect(gateway).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: disabled.id,
          characterId: ordinary,
          purpose: 'moments',
          billingOwner: 'user',
          ecologyTask: true,
        }),
      );
      expect(
        (await feed(disabled.token)).filter((item) => item.text === '给刚做好的一只陶杯留个纪念。'),
      ).toHaveLength(1);
      expect(
        (await feed(friend.token)).some((item) => item.text === '给刚做好的一只陶杯留个纪念。'),
      ).toBe(false);
      expect(
        (
          await db.query(
            'SELECT forwarded_public FROM moments.posts WHERE author_character_id=$1',
            [ordinary],
          )
        ).rows,
      ).toEqual([{ forwarded_public: false }]);
    } finally {
      billing.mockRestore();
      holiday.mockRestore();
      plan.mockRestore();
      gateway.mockRestore();
    }
  });

  it('纯图片微博送出原帖卡片，角色临时下架时留下回执等恢复', async () => {
    const result = await submit(key, {
      characterId: role,
      authorNickname: author,
      sourceUrl: post('AbD9'),
      publishedOn,
    }).expect(202);
    const receiptId = MuseWeiboReceipt.parse(result.body).receiptId;
    await db.query("UPDATE characters.characters SET status='unpublished' WHERE id=$1", [role]);
    await muse.sweep();
    expect((await muse.get(receiptId)).state).toBe('blocked');
    await db.query("UPDATE characters.characters SET status='published' WHERE id=$1", [role]);
    clock.advance(5 * 60_000);
    await muse.sweep();
    expect((await muse.get(receiptId)).state).toBe('published');
    expect((await feed(friend.token)).some((item) => item.link?.url === post('AbD9'))).toBe(true);
  });
});
