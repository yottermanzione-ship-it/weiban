import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AuditLog } from '../src/platform/audit/audit-log.js';
import { SystemClock } from '../src/platform/clock/clock.js';
import { EnvelopeCrypto } from '../src/platform/crypto/envelope.js';
import { Database } from '../src/platform/db/database.js';
import {
  applyAvatarImports,
  bindDefaultVoice,
  planAvatarSources,
  planLegacyVoices,
  readAvatarCharacters,
  readVoiceExisting,
} from '../src/modules/characters/index.js';
import {
  createImportMediaService,
  createMediaVoiceImportService,
} from '../src/modules/media/index.js';
import { listVoiceMessageModelKeys } from '../src/modules/model-access/index.js';
import { describeDb, requireTestDatabaseUrl, resetTestDatabase } from './support/db.js';
import { testConfig, testKekRing } from './support/fixtures.js';

const AVATAR_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const VOICE_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const QWEN_KEY = 'qwen-audio-3.0-tts-plus-wb-0123456789abcdef0123456789abcdef';

describeDb('旧卡头像/音色导入：真实 PostgreSQL 写入与幂等', () => {
  let db: Database;
  let dir: string;
  let clock: SystemClock;

  beforeAll(async () => {
    await resetTestDatabase();
    db = new Database({ url: requireTestDatabaseUrl(), poolMax: 1 });
    clock = new SystemClock();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-legacy-media-'));
  }, 180_000);
  afterAll(async () => {
    await db?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function seedCharacter(id: string, name: string): Promise<void> {
    await db.query(
      `INSERT INTO characters.characters
        (id, kind, status, name, search_text, basis, age_setting, child_appearance,
         child_features_detected, checks, legacy_card, created_at, updated_at)
       VALUES ($1,'preset','published',$2,$2,'fictional','adult',false,false,
         '{"revision":1,"requiredFieldsComplete":false,"personaStabilityPassed":false,"hardBoundaryCasesPassed":false,"hasFallbackGreeting":false,"checked":false}'::jsonb,
         '{"display_name":"测试角色"}'::jsonb, $3, $3)`,
      [id, name, clock.now()],
    );
  }

  it('头像：plan → apply 写 media.objects + avatar_media_id，重跑跳过已有头像', async () => {
    await seedCharacter(AVATAR_ID, '头像测试角色');
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 10, b: 10 } },
    })
      .png()
      .toBuffer();
    const file = path.join(dir, 'avatar.png');
    fs.writeFileSync(file, png);

    const before = await readAvatarCharacters(db, [AVATAR_ID]);
    expect(before.get(AVATAR_ID)?.avatarMediaId).toBeNull();
    const plan = await planAvatarSources(
      { [AVATAR_ID]: file },
      { allowHosts: new Set(), lookup: (id) => before.get(id) ?? null },
    );
    expect(plan.counts).toMatchObject({ importable: 1, missingFile: 0 });
    expect(plan.issues).toEqual([]);

    const { ring } = testKekRing();
    const config = testConfig({ MEDIA_DISK_ROOT: path.join(dir, 'media') });
    const media = createImportMediaService({
      database: db,
      config,
      clock,
      crypto: new EnvelopeCrypto(db, clock, ring),
      audit: new AuditLog(db, clock),
      apply: true,
    });
    const applied = await applyAvatarImports(db, media, plan.items, {
      now: clock.now(),
      counts: plan.counts,
      issues: plan.issues,
    });
    expect(applied).toEqual({ imported: 1, failed: 0 });
    expect(plan.counts.imported).toBe(1);

    const [character] = (
      await db.query<{ avatar_media_id: string | null }>(
        'SELECT avatar_media_id FROM characters.characters WHERE id=$1',
        [AVATAR_ID],
      )
    ).rows;
    expect(character?.avatar_media_id).toBeTruthy();
    const [object] = (
      await db.query<{
        purpose: string;
        owner_id: string | null;
        state: string;
        mime_type: string;
      }>('SELECT purpose, owner_id, state, mime_type FROM media.objects WHERE id=$1', [
        character!.avatar_media_id,
      ])
    ).rows;
    expect(object).toMatchObject({
      purpose: 'character_avatar',
      owner_id: null,
      state: 'ready',
      mime_type: 'image/webp',
    });

    const after = await readAvatarCharacters(db, [AVATAR_ID]);
    const again = await planAvatarSources(
      { [AVATAR_ID]: file },
      { allowHosts: new Set(), lookup: (id) => after.get(id) ?? null },
    );
    expect(again.counts).toMatchObject({ alreadyHasAvatar: 1, importable: 0 });
    expect(again.items).toEqual([]);
  }, 120_000);

  it('音色：plan → apply 写 media.voices + default_voices；同库重跑是 already_bound', async () => {
    await seedCharacter(VOICE_ID, '音色测试角色');
    const input = {
      version: 1 as const,
      characters: [
        {
          id: VOICE_ID,
          display_name: '音色测试角色',
          voice_json: JSON.stringify({ provider: 'qwen' }),
          qwen_voice_id: QWEN_KEY,
          mimo_voice_sample_path: '/old/voice-samples/test.mp3',
          mimo_voice_sample_url: '/generated/voice-samples/test.mp3',
        },
      ],
      bindings: [],
    };
    const voiceMedia = createMediaVoiceImportService(db, clock);
    const registeredModels = await listVoiceMessageModelKeys(db);
    const existing = await readVoiceExisting(
      db,
      [VOICE_ID],
      await voiceMedia.listVoices(),
      registeredModels,
    );
    const plan = planLegacyVoices(input, existing, { sampleExists: () => true });
    expect(plan.counts).toMatchObject({ mapped: 1, wouldCreateVoices: 1, wouldBind: 1 });
    expect(plan.items[0]?.candidate).toMatchObject({
      key: QWEN_KEY,
      modelKey: 'qwen-audio-3.0-tts-plus',
      clone: true,
      source: 'qwen_voice_id',
    });

    const registered = await voiceMedia.ensureVoice({
      modelKey: 'qwen-audio-3.0-tts-plus',
      providerVoiceKey: QWEN_KEY,
      name: '旧卡音色 test',
      tags: ['legacy', 'clone'],
      enabled: true,
    });
    expect(registered).toMatchObject({ created: true, enabled: true });
    const bound = await bindDefaultVoice(db, VOICE_ID, registered.id, clock.now());
    expect(bound.bound).toBe(true);

    const [voice] = (
      await db.query<{
        id: string;
        provider_voice_key: string;
        model_key: string;
        enabled: boolean;
      }>(
        'SELECT id, provider_voice_key, model_key, enabled FROM media.voices WHERE provider_voice_key=$1',
        [QWEN_KEY],
      )
    ).rows;
    expect(voice).toMatchObject({
      provider_voice_key: QWEN_KEY,
      model_key: 'qwen-audio-3.0-tts-plus',
      enabled: true,
    });
    const [binding] = (
      await db.query<{ voice_id: string }>(
        'SELECT voice_id FROM characters.default_voices WHERE character_id=$1',
        [VOICE_ID],
      )
    ).rows;
    expect(binding?.voice_id).toBe(voice?.id);

    const againExisting = await readVoiceExisting(
      db,
      [VOICE_ID],
      await voiceMedia.listVoices(),
      registeredModels,
    );
    const again = planLegacyVoices(input, againExisting, { sampleExists: () => true });
    expect(again.counts).toMatchObject({ mapped: 0, alreadyBound: 1 });
    const againBound = await bindDefaultVoice(db, VOICE_ID, registered.id, clock.now());
    expect(againBound.bound).toBe(false);
  }, 120_000);
});
