import 'reflect-metadata';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  AdminCharacterWrite,
  CharacterCard,
  type ContactsReadPort,
  type ChatReadPort,
  type ChatUserPort,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { createWorker } from '../src/main.js';
import {
  DATABASE,
  newId,
  type Database,
  JOB_QUEUE,
  SystemClock,
  type JobQueue,
} from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  CharacterService,
  CharacterCheckWorker,
  CHARACTER_EVALUATOR,
} from '../src/modules/characters/testing.js';
import { CHAT_USER_PORT, CHAT_READ_PORT } from '../src/modules/chat/index.js';
import { CONTACTS_READ_PORT } from '../src/modules/contacts/index.js';
import { BillingAdminService, PriceService } from '../src/modules/billing/testing.js';
import { CatalogService, UpstreamService } from '../src/modules/model-access/testing.js';
import { ReplyPlanStore } from '../src/modules/ai-runtime/testing.js';
import { ContactsCommands, ACCEPT_CONTACT_JOB } from '../src/modules/contacts/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';
const sample = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
    'utf8',
  ).match(/```json\s*([\s\S]*?)```/)![1]!,
) as { card: unknown };

describeDb('AI真实HTTP网关/计费与跨应用持久队列', () => {
  let app: INestApplication | undefined;
  let worker: INestApplicationContext | undefined;
  let fake: Server;
  const bodies: Record<string, unknown>[] = [];
  const key = 'sk-AI-HTTP-PRIVATE-CANARY';
  const clock = new SystemClock();
  const logs = captureLogger();
  const ring = testKekRing().ring;
  beforeAll(async () => {
    await resetTestDatabase();
    fake = createServer(async (req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200).end('{"data":[]}');
        return;
      }
      let body = '';
      for await (const part of req) body += part.toString();
      bodies.push(JSON.parse(body) as Record<string, unknown>);
      expect(req.headers.authorization).toBe(`Bearer ${key}`);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          choices: [{ message: { content: '我听着呢\n慢慢说就好。' } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      );
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  });
  afterAll(async () => {
    await worker?.close();
    await app?.close();
    await new Promise<void>((resolve) => fake?.close(() => resolve()));
  });
  it('web关闭后worker接受与真实生成；气泡幂等一次扣费；停worker再发两句合并', async () => {
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ APP_ROLE: 'web' }),
          clock,
          logger: logs.logger,
          kekRing: ring,
          background: false,
        }),
      ],
    })
      .overrideProvider(CHARACTER_EVALUATOR)
      .useValue({
        evaluate: async () => ({
          childFeaturesDetected: false,
          personaStabilityPassed: true,
          hardBoundaryCasesPassed: true,
        }),
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    await app.get<JobQueue>(JOB_QUEUE).start();
    const userId = await app
      .get(IdentityCommands)
      .createAdmin('queue_user', 'correct horse battery');
    const service = app.get(CharacterService);
    const role = await service.create(
      userId,
      AdminCharacterWrite.parse({
        name: 'queued role',
        tagline: '测试',
        intro: '原创成年角色',
        categoryId: 'original',
        avatar: {
          imageMediaId: null,
          display: { supportColors: [], avatarText: null, avatarPattern: 'star', themeColor: null },
        },
        birthday: '2000-01-02',
        fanName: null,
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult',
          childAppearance: false,
        },
        fallbackGreetings: ['你好，欢迎来聊聊天'],
        card: CharacterCard.parse(sample.card),
      }),
    );
    await app
      .get(CharacterCheckWorker)
      .runChecks({ characterId: role.characterId, adminId: userId, revision: 1 });
    await service.publish(userId, role.characterId);
    await app.get(BillingAdminService).adjust(userId, userId, {
      direction: 'grant',
      amountMicros: 1000000,
      reason: 'AI queue test',
      idempotencyKey: newId(),
    });
    const upstream = await app.get(UpstreamService).create(userId, {
      name: 'AI fake HTTP',
      kind: 'openai_compatible',
      baseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`,
      apiKey: key,
    });
    const modelKey = 'ai/queue';
    const price = await app.get(PriceService).createDraft(userId, {
      versionLabel: 'ai queue',
      note: null,
      items: [
        ['input_tokens_per_million', 2000000],
        ['cached_input_tokens_per_million', 1000000],
        ['output_tokens_per_million', 8000000],
      ].map(([unit, p]) => ({
        modelKey,
        unit: unit as 'input_tokens_per_million',
        priceMicros: Number(p),
        costMicros: Number(p) / 2,
        band: null,
      })),
    });
    await app.get(PriceService).activate(userId, price.priceVersionId, null);
    await app.get(CatalogService).upsert(userId, modelKey, {
      modelKey,
      displayName: 'AI Queue',
      vendorName: 'Fake',
      upstreamId: upstream.upstreamId,
      upstreamModelId: 'fake',
      capabilities: [],
      tags: [],
      leaderboardRank: null,
      sortOrder: 0,
      defaultFor: ['chat'],
      enabled: true,
    });
    const start = clock.nowMs();
    const pending = await app
      .get(ContactsCommands)
      .add(userId, { characterId: role.characterId, greeting: 'QUEUE_GREETING_PRIVATE_CANARY' });
    expect(pending.status).toBe('pending');
    const [job] = await app.get<JobQueue>(JOB_QUEUE).boss.findJobs(ACCEPT_CONTACT_JOB);
    expect(job?.state).toBe('created');
    await app.close();
    app = undefined;
    worker = await createWorker({
      config: testConfig({ APP_ROLE: 'worker' }),
      clock,
      logger: logs.logger,
      kekRing: ring,
    });
    const reader = worker.get<ContactsReadPort>(CONTACTS_READ_PORT);
    await vi.waitFor(
      async () => {
        expect((await reader.getActiveContact(userId, role.characterId))?.status).toBe('active');
      },
      { timeout: 35_000, interval: 100 },
    );
    const elapsed = clock.nowMs() - start;
    expect(elapsed).toBeGreaterThanOrEqual(3000);
    expect(elapsed).toBeLessThanOrEqual(30_000);
    const active = (await reader.getActiveContact(userId, role.characterId))!;
    const chat = worker.get<ChatReadPort>(CHAT_READ_PORT);
    const cid = active.conversationId!;
    await vi.waitFor(
      async () => {
        expect(
          (await chat.readMessages({ conversationId: cid, scopes: ['normal'], limit: 50 })).filter(
            (m) => m.senderKind === 'character',
          ),
        ).toHaveLength(2);
      },
      { timeout: 20000, interval: 100 },
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.response_format).toBeUndefined();
    expect(bodies[0]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('QUEUE_GREETING_PRIVATE_CANARY'),
        }),
      ]),
    );
    const rows = await worker
      .get<Database>(DATABASE)
      .query<{ amount_micros: string }>(
        "SELECT amount_micros FROM billing.ledger_entries WHERE type='charge'",
      );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.amount_micros).toBe('-360');
    const ids = await worker
      .get<Database>(DATABASE)
      .query<{ id: string }>("SELECT id FROM ai_runtime.reply_plans WHERE status='done'");
    await worker.get(ReplyPlanStore).reconcile();
    expect(ids.rows).toHaveLength(1);
    await worker.close();
    worker = undefined;
    const next = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ APP_ROLE: 'web' }),
          clock,
          logger: logs.logger,
          kekRing: ring,
          background: false,
        }),
      ],
    }).compile();
    app = next.createNestApplication({ logger: false });
    await app.init();
    await app.get<JobQueue>(JOB_QUEUE).start();
    const deliveredAt = clock.nowMs();
    for (const text of ['第二轮你好', '我又说了一句'])
      await app
        .get<ChatUserPort>(CHAT_USER_PORT)
        .sendMessage(userId, cid, { clientMsgId: newId(), content: { type: 'text', text } });
    await app.close();
    app = undefined;
    worker = await createWorker({
      config: testConfig({ APP_ROLE: 'worker' }),
      clock,
      logger: logs.logger,
      kekRing: ring,
    });
    const resumed = worker.get<ChatReadPort>(CHAT_READ_PORT);
    await vi.waitFor(
      async () => {
        expect(
          (
            await resumed.readMessages({ conversationId: cid, scopes: ['normal'], limit: 50 })
          ).filter((m) => m.senderKind === 'character'),
        ).toHaveLength(4);
      },
      { timeout: 20000, interval: 100 },
    );
    expect(clock.nowMs() - deliveredAt).toBeLessThan(60000);
    expect(bodies).toHaveLength(2);
    const ledger = await worker
      .get<Database>(DATABASE)
      .query("SELECT id FROM billing.ledger_entries WHERE type='charge'");
    expect(ledger.rows).toHaveLength(2);
    expect(logs.capture.text).not.toContain(key);
    expect(logs.capture.text).not.toContain('QUEUE_GREETING_PRIVATE_CANARY');
  }, 80000);
});
