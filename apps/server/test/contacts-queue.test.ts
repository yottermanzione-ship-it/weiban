import 'reflect-metadata';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  AdminCharacterWrite,
  CharacterCard,
  type ContactsReadPort,
  type ChatReadPort,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { createWorker } from '../src/main.js';
import { JOB_QUEUE, SystemClock, type JobQueue } from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  CharacterService,
  CharacterCheckWorker,
  CHARACTER_EVALUATOR,
} from '../src/modules/characters/testing.js';
import { CHAT_READ_PORT } from '../src/modules/chat/index.js';
import { CONTACTS_READ_PORT } from '../src/modules/contacts/index.js';
import { ContactsCommands, ACCEPT_CONTACT_JOB } from '../src/modules/contacts/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';
const sample = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
    'utf8',
  ).match(/```json\s*([\s\S]*?)```/)![1]!,
) as { card: unknown };

describeDb('contacts 真实持久任务跨应用重启', () => {
  let app: INestApplication | undefined;
  let worker: INestApplicationContext | undefined;
  const clock = new SystemClock();
  const logs = captureLogger();
  const ring = testKekRing().ring;
  beforeAll(async () => {
    await resetTestDatabase();
  });
  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });
  it('web提交pending后关闭，独立worker在P30内接受同一申请并提交系统消息', async () => {
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
    expect((await chat.getConversation(active.conversationId!))?.lastSeq).toBe(1);
    expect(await reader.getPendingGreeting(userId, role.characterId)).toBe(
      'QUEUE_GREETING_PRIVATE_CANARY',
    );
    expect(logs.capture.text).not.toContain('QUEUE_GREETING_PRIVATE_CANARY');
  }, 45_000);
});
