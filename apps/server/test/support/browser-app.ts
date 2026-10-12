/** 浏览器端到端专用真实服务器；只允许独立weiban_test库，启动前重建。 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AdminCharacterWrite,
  CharacterCard,
  type ChatParticipantPort,
  type ChatReadPort,
} from '@weiban/contracts';
import {
  CharacterService,
  CharacterCheckWorker,
  CHARACTER_EVALUATOR,
} from '../../src/modules/characters/testing.js';
import { ContactsCommands, ContactsTestQueries } from '../../src/modules/contacts/testing.js';
import { CHAT_PARTICIPANT_PORT, CHAT_READ_PORT } from '../../src/modules/chat/index.js';
import { JOB_QUEUE, type JobQueue } from '../../src/platform/index.js';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureHttpApp } from '../../src/main.js';
import { SettingsService } from '../../src/modules/identity/testing.js';
import { IdentityCommands } from '../../src/modules/identity/index.js';
import { IMPORTER_ANALYZER } from '../../src/modules/importer/index.js';
import { ImporterService } from '../../src/modules/importer/testing.js';
import { MediaAssetService, MediaService } from '../../src/modules/media/testing.js';
import { BillingAdminService } from '../../src/modules/billing/testing.js';
import { newId, TestClock, loadConfig, createLogger } from '../../src/platform/index.js';
import { AdminAlertService } from '../../src/modules/push/testing.js';
import { DATABASE, type Database } from '../../src/platform/index.js';
import { randomBytes } from 'node:crypto';
import { resetTestDatabase, requireTestDatabaseUrl } from './db-admin.js';
requireTestDatabaseUrl();
await resetTestDatabase();
const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: requireTestDatabaseUrl(),
  MEDIA_PUBLIC_BASE_URL: 'http://127.0.0.1:5173',
});
const clock = new TestClock('2026-10-05T12:00:00.000Z');
const fixture = await Test.createTestingModule({
  imports: [
    AppModule.forRoot({
      config,
      clock,
      kekRing: { currentVersion: 1, keys: new Map([[1, randomBytes(32)]]) },
      logger: createLogger({ level: 'silent' }),
      background: false,
    }),
  ],
})
  // Controlled analysis for browser field persistence; not a model-quality evaluation.
  .overrideProvider(IMPORTER_ANALYZER)
  .useValue({
    estimate: async () => 0,
    analyze: async () => ({
      ok: true,
      value: {
        kind: 'new_character',
        draft: {
          cardSchemaVersion: 1,
          data: {
            persona: {
              summary:
                '这是一个性格开朗、乐于助人的成年角色，喜欢在日落时分散步，总能带给周围的人温暖与微笑，对生活充满热情，尊重他人的边界。',
            },
          },
        },
        suggestedClassification: {
          basis: 'real_person',
          realPersonKind: 'private_person',
          ageSetting: 'adult',
          childAppearance: false,
        },
        detectedRealNames: [],
      },
    }),
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
const app = fixture.createNestApplication({ logger: false });
configureHttpApp(app, config);
await app.init();
await app.get<JobQueue>(JOB_QUEUE).start();
const commands = app.get(IdentityCommands);
let chatUser = '';
let guideUser = '';
let importUser = '';
const admin = await commands.createAdmin('browser_admin', 'correct horse battery');
// Real playable WAV through encrypted media storage; a tone tests playback, not voice quality.
const sampleRate = 8000;
const wav = Buffer.alloc(44 + sampleRate * 10 * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < sampleRate * 10; i++)
  wav.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / sampleRate) * 2000), 44 + i * 2);
const voiceSample = await app
  .get(MediaService)
  .upload(admin, 'voice_sample', { buffer: wav, mimetype: 'audio/wav' }, { admin: true });
await app.get(MediaAssetService).createVoice(admin, {
  name: '浏览器测试音色',
  tags: [],
  sampleMediaId: voiceSample.mediaId,
  enabled: true,
  providerVoiceKey: 'controlled-test',
  modelKey: 'controlled-speech-test',
  careFallbackMediaId: null,
});
for (const [name, balance] of [
  ['browser_user', 50_000_000],
  ['browser_other', 1_000_000],
  ['browser_first', 1_000_000],
  ['browser_guide', 1_000_000],
] as const) {
  const user = await commands.createAdmin(name, 'correct horse battery');
  if (name === 'browser_user') chatUser = user;
  if (name === 'browser_guide') guideUser = user;
  if (name === 'browser_other') importUser = user;
  await commands.setRole(name, 'user');
  if (name === 'browser_other' || name === 'browser_guide')
    await app.get(SettingsService).updateProfile(user, { nickname: '其他用户' });
  await app.get(BillingAdminService).adjust(admin, user, {
    direction: 'grant',
    amountMicros: balance,
    reason: '浏览器测试赠送',
    idempotencyKey: newId(),
  });
}
const importer = app.get(ImporterService);
const importJob = await importer.createJob(importUser, {
  clientRequestId: newId(),
  kind: 'new_character',
  sourceKind: 'text',
  text: '导入测试：你好\n另一个人：今天过得怎样',
});
await importer.detect(importJob.jobId);
await importer.selectSpeaker(importUser, importJob.jobId, '导入测试');
await importer.start(importUser, importJob.jobId, { keepRaw: false });
await importer.analyze(importJob.jobId);
await app.get<Database>(DATABASE).transaction(async (tx) => {
  for (let index = 0; index < 53; index++)
    await app.get(AdminAlertService).raise(tx, {
      kind: 'upstream_unavailable',
      severity: index === 0 ? 'critical' : 'warning',
      dedupeKey: `browser-alert-${index}`,
      summary: `浏览器运行提醒 ${index}`,
    });
});
const sample = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../../docs/ai/samples/S-01-cheng-che.md'),
    'utf8',
  ).match(/```json\s*([\s\S]*?)```/)![1]!,
) as { card: unknown };
const role = await app.get(CharacterService).create(
  admin,
  AdminCharacterWrite.parse({
    name: '测试陪伴角色',
    tagline: '浏览器可靠聊天',
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
  .runChecks({ characterId: role.characterId, adminId: admin, revision: 1 });
await app.get(CharacterService).publish(admin, role.characterId);
async function seedConversation(userId: string, count: number) {
  await app.get(ContactsCommands).add(userId, { characterId: role.characterId, greeting: '你好' });
  const contactRow = await new ContactsTestQueries(app.get(DATABASE)).row(userId, role.characterId);
  if (!contactRow) throw new Error('missing browser contact');
  clock.advance(Math.max(0, contactRow.accept_after.getTime() - clock.nowMs()));
  await app
    .get(ContactsCommands)
    .accept({ userId: userId, characterId: role.characterId, requestId: contactRow.request_id });
  const activeRow = await app
    .get<Database>(DATABASE)
    .query<{ conversation_id: string }>(
      'SELECT conversation_id FROM contacts.contacts WHERE user_id=$1 AND character_id=$2',
      [userId, role.characterId],
    );
  const conversationId = activeRow.rows[0]!.conversation_id;
  const conversation = await app.get<ChatReadPort>(CHAT_READ_PORT).getConversation(conversationId);
  const participant = conversation!.participants.find((item) => item.kind === 'character')!;
  for (let index = 0; index < count; index++) {
    const posted = await app.get<ChatParticipantPort>(CHAT_PARTICIPANT_PORT).postMessage({
      conversationId,
      senderParticipantId: participant.participantId,
      content: { type: 'text', text: `浏览器历史消息 ${index}` },
      idempotencyKey: `browser-history:${userId}:${index}`,
    });
    if (!posted.ok) throw new Error('browser message seed failed');
  }
}
await seedConversation(chatUser, 70);
await seedConversation(guideUser, 1);
await app.listen(3000, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => void app.close().then(() => process.exit(0)));
