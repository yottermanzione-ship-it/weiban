import 'reflect-metadata';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  AuthResponse,
  LegacyFavorite,
  LegacyFavoritesEndpoints as E,
  type LegacyFavoriteImportItem,
  type LegacyFavoriteSnapshot,
  type MediaSystemPort,
  type SyncPort,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import { LegacyFavoritesService } from '../src/modules/library/testing.js';
import { MEDIA_SYSTEM_PORT } from '../src/modules/media/index.js';
import { SYNC_PORT } from '../src/modules/realtime/index.js';
import {
  DATABASE,
  ENVELOPE_CRYPTO,
  USER_DATA_REGISTRY,
  newId,
  type Database,
  type EnvelopeCrypto,
  type UserDataRegistry,
} from '../src/platform/index.js';
import { describeDb, resetTestDatabase, TEST_DATABASE_URL } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const timestamp = 1730000000123;
const favorite = (
  content = '合成旧收藏😀',
  message: LegacyFavoriteSnapshot['message'] = {},
): LegacyFavoriteSnapshot => ({
  chatKey: 'synthetic_chat',
  chatTitle: '合成聊天',
  savedAt: timestamp,
  message: { author: '合成人物', content, type: 'text', isMine: false, timestamp, ...message },
});
function item(accountKey: string, snapshot = favorite()): LegacyFavoriteImportItem {
  const m = snapshot.message;
  return {
    accountKey,
    favorite: snapshot,
    itemKey: sha(
      `${snapshot.chatKey}|${m.timestamp ?? 'null'}|${m.type ?? 'text'}|${m.content ?? ''}`,
    ),
  };
}

describeDb('旧本机收藏：真实HTTP、加密、来源隔离与删除墓碑', () => {
  let app: INestApplication,
    database: Database,
    service: LegacyFavoritesService,
    media: MediaSystemPort,
    dir = '';
  let sequence = 0;
  const http = () => request(app.getHttpServer());
  async function user(mapped = true) {
    const n = ++sequence,
      key = 'old' + randomBytes(6).toString('hex');
    const auth = AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/register')
          .set('X-Forwarded-For', `10.90.0.${n}`)
          .send({
            username: `legacyfav_${n}`,
            password: randomBytes(32).toString('hex'),
            device: {
              platform: 'web',
              name: 'Synthetic favorites',
              appVersion: '7.9',
              timeZone: 'Asia/Shanghai',
            },
          })
          .expect(201)
      ).body,
    );
    if (mapped)
      await database.query(
        `INSERT INTO library.legacy_favorite_sources
      (user_id,account_key,source_user_id,source_batch,verified_at) VALUES($1,$2,$1,'synthetic-fixture',now())`,
        [auth.user.userId, key],
      );
    return { id: auth.user.userId, token: auth.session.token, key };
  }
  type User = Awaited<ReturnType<typeof user>>;
  const auth = (u: User) => ({ Authorization: `Bearer ${u.token}` });
  const importHttp = (u: User, items: LegacyFavoriteImportItem[]) =>
    http().post(E.import.path).set(auth(u)).send({ items });
  const rows = async (u: User) =>
    (
      await database.query<{
        id: string;
        snapshot_ciphertext: Buffer | null;
        deleted_at: Date | null;
      }>(
        'SELECT id,snapshot_ciphertext,deleted_at FROM library.legacy_favorites WHERE user_id=$1 ORDER BY id',
        [u.id],
      )
    ).rows;
  beforeAll(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    // ci.yml owns an ephemeral PostgreSQL service for this job; local weiban_test is never eligible.
    const githubFixture =
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
      (!githubFixture && url.pathname !== '/codex_migration_favorites_1109') ||
      url.search ||
      url.hash
    )
      throw new Error('DEDICATED_LOCAL_FAVORITES_DATABASE_REQUIRED');
    if (!githubFixture) {
      const check = new pg.Client({ connectionString: TEST_DATABASE_URL! });
      await check.connect();
      try {
        const count = await check.query(
          "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type='BASE TABLE'",
        );
        if (count.rows[0].n > 0) {
          const marker = await check.query(
            "SELECT to_regclass('public.codex_favorites_fixture') AS marker",
          );
          if (!marker.rows[0].marker) throw new Error('EXISTING_NON_FIXTURE_DATABASE_REFUSED');
          const marked = await check.query('SELECT synthetic FROM public.codex_favorites_fixture');
          if (marked.rows[0]?.synthetic !== true)
            throw new Error('EXISTING_NON_FIXTURE_DATABASE_REFUSED');
        }
      } finally {
        await check.end();
      }
    }
    await resetTestDatabase();
    dir = await mkdtemp(join(tmpdir(), 'codex-legacy-favorites-'));
    const config = testConfig({ APP_ROLE: 'web', HTTP_TRUST_PROXY: 'true', MEDIA_DISK_ROOT: dir });
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config,
          logger: captureLogger('silent').logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpApp(app, config);
    await app.init();
    await app.listen(0, '127.0.0.1');
    database = app.get(DATABASE);
    service = app.get(LegacyFavoritesService);
    media = app.get(MEDIA_SYSTEM_PORT);
    if (!githubFixture)
      await database.query(
        'CREATE TABLE IF NOT EXISTS public.codex_favorites_fixture(synthetic boolean NOT NULL); INSERT INTO public.codex_favorites_fixture SELECT true WHERE NOT EXISTS(SELECT 1 FROM public.codex_favorites_fixture)',
      );
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    if (dir) {
      if (
        !resolve(dir).startsWith(resolve(tmpdir()) + sep) ||
        !dir.includes('codex-legacy-favorites-')
      )
        throw new Error('UNSAFE_FIXTURE_CLEANUP');
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('仅返回认证账号的已核实来源；自报昵称/账号和跨用户读写删不能改变归属', async () => {
    const a = await user(),
      b = await user(),
      unmapped = await user(false);
    await http().get(E.source.path).expect(401);
    const source = (
      await http()
        .get(E.source.path + '?username=' + b.key)
        .set(auth(a))
        .expect(200)
    ).body;
    expect(source).toEqual({ userId: a.id, legacyAccountKeys: [a.key], available: true });
    expect((await http().get(E.source.path).set(auth(unmapped)).expect(200)).body.available).toBe(
      false,
    );
    await importHttp(a, [item(b.key)]).expect(403);
    await importHttp(unmapped, [item(a.key)]).expect(403);
    await importHttp(a, [item(a.key)]).expect(200);
    expect(
      (
        await http()
          .get(E.list.path + '?userId=' + a.id)
          .set(auth(b))
          .expect(200)
      ).body.items,
    ).toEqual([]);
    await http()
      .delete(E.list.path + '/' + (await rows(a))[0]!.id)
      .set(auth(b))
      .expect(404);
  });

  it('保存完整原快照和扩展字段；原int时间参与摘要，展示时间不改变源身份', async () => {
    const u = await user(),
      snapshot = favorite('合成 UTF8 文本😀', {
        timestamp,
        futureExtension: { list: [1, null, 'kept'] },
        avatar: 'file:///synthetic-private/avatar.png',
      });
    const result = E.import.response.parse(
      (await importHttp(u, [item(u.key, snapshot)]).expect(200)).body,
    );
    expect(result.imported).toBe(1);
    const saved = (await rows(u))[0]!;
    expect(saved.snapshot_ciphertext!.includes(Buffer.from('合成 UTF8'))).toBe(false);
    const plain = await app
      .get<EnvelopeCrypto>(ENVELOPE_CRYPTO)
      .open(u.id, `library:legacy-favorite:${saved.id}`, saved.snapshot_ciphertext!);
    try {
      expect(JSON.parse(plain.toString())).toEqual({
        version: 1,
        favorite: snapshot,
        mediaIssue: null,
      });
    } finally {
      plain.fill(0);
    }
    const dto = LegacyFavorite.parse(
      (await http().get(E.list.path).set(auth(u)).expect(200)).body.items[0],
    );
    expect(dto.message.timestamp).toBe(String(timestamp));
    expect(dto.savedAt).toBe(new Date(timestamp).toISOString());
    expect(JSON.stringify(dto)).not.toContain('file:///');
    const changed = { ...snapshot, chatTitle: '不得覆盖原快照' };
    expect((await importHttp(u, [item(u.key, changed)]).expect(200)).body.existing).toBe(1);
    expect((await http().get(E.list.path).set(auth(u)).expect(200)).body.items[0].chatTitle).toBe(
      snapshot.chatTitle,
    );
  });

  it('timestamp缺失和null均按旧Dart的null字符串生成同一个标识', async () => {
    const u = await user();
    const missing: LegacyFavoriteSnapshot = {
      chatKey: 'minimal',
      chatTitle: '',
      savedAt: timestamp,
      message: {},
    };
    const nullable: LegacyFavoriteSnapshot = {
      ...missing,
      message: { timestamp: null, content: null, type: null },
    };
    expect(item(u.key, missing).itemKey).toBe(sha('minimal|null|text|'));
    expect(item(u.key, missing).itemKey).toBe(item(u.key, nullable).itemKey);
    expect(
      (await importHttp(u, [item(u.key, missing), item(u.key, nullable)]).expect(200)).body,
    ).toMatchObject({ imported: 1, existing: 1 });
    const saved = (await rows(u))[0]!;
    const plain = await app
      .get<EnvelopeCrypto>(ENVELOPE_CRYPTO)
      .open(u.id, `library:legacy-favorite:${saved.id}`, saved.snapshot_ciphertext!);
    try {
      expect(JSON.parse(plain.toString()).favorite.message).toEqual({});
    } finally {
      plain.fill(0);
    }
  });

  it('错误摘要、超25条及512KiB以上请求拒绝；未达512KiB的大批次可通过真实解析器', async () => {
    const u = await user(),
      good = item(u.key);
    await importHttp(u, [{ ...good, itemKey: '0'.repeat(64) }]).expect(400);
    await importHttp(
      u,
      Array.from({ length: 26 }, () => good),
    ).expect(400);
    const large = item(u.key, favorite('字'.repeat(50_000)));
    await importHttp(u, [large]).expect(200); // Above Nest/Express default 100 KiB.
    const tooLarge = item(u.key, favorite('字'.repeat(180_000)));
    await importHttp(u, [tooLarge]).expect(413);
    expect(await rows(u)).toHaveLength(1);
  });

  it('混入其他账号和中途加密失败都使整个批次回滚', async () => {
    const u = await user(),
      other = await user();
    await importHttp(u, [
      item(u.key, favorite('first')),
      item(other.key, favorite('second')),
    ]).expect(403);
    expect(await rows(u)).toHaveLength(0);
    const crypto = app.get<EnvelopeCrypto>(ENVELOPE_CRYPTO),
      seal = crypto.seal.bind(crypto);
    let calls = 0;
    const spy = vi.spyOn(crypto, 'seal').mockImplementation(async (...args) => {
      if (args[1].startsWith('library:legacy-favorite:') && ++calls === 2)
        throw new Error('SYNTHETIC_SECOND_ITEM_FAILURE');
      return seal(...args);
    });
    try {
      await importHttp(u, [item(u.key, favorite('one')), item(u.key, favorite('two'))]).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await rows(u)).toHaveLength(0);
  });

  it('并发只导入一次；删除清密文并保留墓碑，旧手机重传返回removed', async () => {
    const u = await user(),
      input = item(u.key);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => importHttp(u, [input]).expect(200)),
    );
    expect(results.reduce((n, result) => n + result.body.imported, 0)).toBe(1);
    expect(await rows(u)).toHaveLength(1);
    const id = (await rows(u))[0]!.id;
    await http()
      .delete(E.list.path + '/' + id)
      .set(auth(u))
      .expect(204);
    await http()
      .delete(E.list.path + '/' + id)
      .set(auth(u))
      .expect(204);
    expect((await rows(u))[0]).toMatchObject({
      snapshot_ciphertext: null,
      deleted_at: expect.any(Date),
    });
    expect((await importHttp(u, [input]).expect(200)).body).toMatchObject({
      imported: 0,
      removed: 1,
    });
    expect((await http().get(E.list.path).set(auth(u)).expect(200)).body.items).toEqual([]);
  });

  it('分页按原savedAt和id倒序，重复时间不漏不重，错误游标拒绝', async () => {
    const u = await user();
    await importHttp(
      u,
      ['a', 'b', 'c'].map((text) => item(u.key, favorite(text))),
    ).expect(200);
    const expected = (await rows(u)).map((row) => row.id).reverse(),
      received: string[] = [];
    let cursor: string | null = null;
    do {
      const response = E.list.response.parse(
        (
          await http()
            .get(E.list.path)
            .set(auth(u))
            .query({ limit: 1, ...(cursor ? { cursor } : {}) })
            .expect(200)
        ).body,
      );
      received.push(...response.items.map((entry) => entry.favoriteId));
      cursor = response.nextCursor;
    } while (cursor);
    expect(received).toEqual(expected);
    await http().get(E.list.path).set(auth(u)).query({ cursor: 'invalid' }).expect(400);
  });

  it('附件只承接本人已映射且用途正确媒体，原URL不下载也不返回；语音转录保留', async () => {
    const u = await user(),
      other = await user();
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#224466' },
    })
      .png()
      .toBuffer();
    const own = await media.putObject({
      ownerUserId: u.id,
      purpose: 'chat_image',
      bytes,
      mimeType: 'image/png',
    });
    const foreign = await media.putObject({
      ownerUserId: other.id,
      purpose: 'chat_image',
      bytes,
      mimeType: 'image/png',
    });
    const wrongPurpose = await media.putObject({
      ownerUserId: u.id,
      purpose: 'user_avatar',
      bytes,
      mimeType: 'image/png',
    });
    const refs = [
      'https://legacy.invalid/private/own.png',
      'https://legacy.invalid/private/other.png',
      'file:///synthetic/wrong.png',
      'file:///synthetic/missing.png',
    ];
    for (const [index, object] of [own, foreign, wrongPurpose].entries()) {
      await database.query(
        `INSERT INTO library.legacy_favorite_media_links(user_id,reference_hash,kind,media_id,source_batch)
        VALUES($1,$2,'image',$3,'synthetic-fixture')`,
        [u.id, sha(refs[index]!), object.mediaId],
      );
    }
    const inputs = refs.map((ref, index) =>
      item(
        u.key,
        favorite(`图片说明${index}`, {
          type: 'image',
          imageUrl: ref,
          quotedContent: ref,
          mediaId: own.mediaId,
        }),
      ),
    );
    const voice = item(
      u.key,
      favorite('这是真实字段形状的合成转录文字', {
        type: 'voice',
        audioPath: 'file:///synthetic/voice.wav',
        duration: 3,
      }),
    );
    await importHttp(u, [...inputs, voice]).expect(200);
    const list = E.list.response.parse(
      (await http().get(E.list.path).set(auth(u)).expect(200)).body,
    );
    const lookup = new Map(list.items.map((row) => [row.itemKey, row]));
    expect(lookup.get(inputs[0]!.itemKey)?.media).toMatchObject({
      kind: 'image',
      mediaId: own.mediaId,
    });
    for (const entry of inputs.slice(1))
      expect(lookup.get(entry.itemKey)?.mediaStatus).toBe('unavailable');
    expect(lookup.get(voice.itemKey)?.message.content).toBe(voice.favorite.message.content);
    expect(lookup.get(voice.itemKey)?.mediaStatus).toBe('unavailable');
    for (const ref of refs) expect(JSON.stringify(list)).not.toContain(ref);
    expect(JSON.stringify(list)).not.toContain('file:///synthetic/voice.wav');
  });

  it('4000上限包含墓碑且并发/批次不能越界，已有来源仍可重传', async () => {
    const u = await user();
    await database.query(
      `INSERT INTO library.legacy_favorites(id,user_id,account_key,item_key,saved_at,imported_at,deleted_at)
      SELECT gen_random_uuid(),$1,$2,md5(n::text)||md5(n::text),now(),now(),now() FROM generate_series(1,3999) n`,
      [u.id, u.key],
    );
    await importHttp(u, [item(u.key, favorite('new1')), item(u.key, favorite('new2'))]).expect(409);
    expect(await rows(u)).toHaveLength(3999);
    const results = await Promise.all([
      importHttp(u, [item(u.key, favorite('new1'))]),
      importHttp(u, [item(u.key, favorite('new2'))]),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await rows(u)).toHaveLength(4000);
    const active = (
      await database.query<{ item_key: string }>(
        'SELECT item_key FROM library.legacy_favorites WHERE user_id=$1 AND deleted_at IS NULL',
        [u.id],
      )
    ).rows[0]!;
    const existing = [item(u.key, favorite('new1')), item(u.key, favorite('new2'))].find(
      (entry) => entry.itemKey === active.item_key,
    )!;
    expect((await importHttp(u, [existing]).expect(200)).body.existing).toBe(1);
  });

  it('本人上传附件可原子关联；既有映射和快照不覆盖，跨账号媒体/错用途/正文URL均拒绝', async () => {
    const u = await user(),
      other = await user();
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#446688' },
    })
      .png()
      .toBuffer();
    const upload = (ownerUserId: string, purpose: 'chat_image' | 'user_avatar' = 'chat_image') =>
      media.putObject({ ownerUserId, purpose, bytes, mimeType: 'image/png' });
    const first = await upload(u.id),
      second = await upload(u.id),
      foreign = await upload(other.id),
      wrong = await upload(u.id, 'user_avatar');
    const originalRef = 'file:///synthetic/local-original.png';
    const original = item(
      u.key,
      favorite('图片文字说明', { type: 'image', imageUrl: originalRef }),
    );
    const imported = await importHttp(u, [{ ...original, mediaId: first.mediaId }]).expect(200);
    expect(imported.body.items[0].mediaStatus).toBe('ready');
    const saved = (await rows(u))[0]!;
    const list = E.list.response.parse(
      (await http().get(E.list.path).set(auth(u)).expect(200)).body,
    );
    expect(list.items[0]!.media).toMatchObject({ kind: 'image', mediaId: first.mediaId });
    expect(
      (await importHttp(u, [{ ...original, mediaId: second.mediaId }]).expect(200)).body.existing,
    ).toBe(1);
    expect((await rows(u))[0]!.snapshot_ciphertext).toEqual(saved.snapshot_ciphertext);
    const links = () =>
      database.query<{ reference_hash: string; media_id: string }>(
        'SELECT reference_hash,media_id FROM library.legacy_favorite_media_links WHERE user_id=$1',
        [u.id],
      );
    expect((await links()).rows).toEqual([
      { reference_hash: sha(originalRef), media_id: first.mediaId },
    ]);
    const altered = {
      ...original,
      favorite: {
        ...original.favorite,
        message: { ...original.favorite.message, imageUrl: 'file:///synthetic/changed.png' },
      },
    };
    await importHttp(u, [{ ...altered, mediaId: second.mediaId }]).expect(409);
    await importHttp(u, [
      {
        ...item(
          u.key,
          favorite('foreign', { type: 'image', imageUrl: 'file:///synthetic/foreign.png' }),
        ),
        mediaId: foreign.mediaId,
      },
    ]).expect(403);
    await importHttp(u, [
      {
        ...item(
          u.key,
          favorite('wrong', { type: 'image', imageUrl: 'file:///synthetic/wrong-purpose.png' }),
        ),
        mediaId: wrong.mediaId,
      },
    ]).expect(403);
    await importHttp(u, [
      {
        ...item(u.key, favorite('https://private.invalid/content-is-not-a-download')),
        mediaId: second.mediaId,
      },
    ]).expect(400);
    await http()
      .delete(E.list.path + '/' + saved.id)
      .set(auth(u))
      .expect(204);
    expect(
      (await importHttp(u, [{ ...altered, mediaId: second.mediaId }]).expect(200)).body.removed,
    ).toBe(1);
    expect((await links()).rows).toEqual([
      { reference_hash: sha(originalRef), media_id: first.mediaId },
    ]);
  });

  it('附件原因限固定枚举，加密元数据可更新且原favorite不变；成功关联后清除原因', async () => {
    const u = await user();
    const original = item(
      u.key,
      favorite('原样保留的快照', {
        type: 'image',
        imageUrl: 'file:///synthetic/missing-then-restored.png',
      }),
    );
    const initial = await importHttp(u, [{ ...original, mediaIssue: 'file_missing' }]).expect(200);
    expect(initial.body.items[0].mediaStatus).toBe('unavailable');
    expect((await http().get(E.list.path).set(auth(u)).expect(200)).body.items[0].mediaIssue).toBe(
      'file_missing',
    );
    const changed = {
      ...original,
      favorite: { ...original.favorite, chatTitle: '不能替换原标题' },
      mediaIssue: 'path_rejected' as const,
    };
    await importHttp(u, [changed]).expect(200);
    const stored = (await rows(u))[0]!;
    const crypto = app.get<EnvelopeCrypto>(ENVELOPE_CRYPTO);
    let plain = await crypto.open(
      u.id,
      `library:legacy-favorite:${stored.id}`,
      stored.snapshot_ciphertext!,
    );
    try {
      expect(JSON.parse(plain.toString())).toEqual({
        version: 1,
        favorite: original.favorite,
        mediaIssue: 'path_rejected',
      });
    } finally {
      plain.fill(0);
    }
    await http()
      .post(E.import.path)
      .set(auth(u))
      .send({ items: [{ ...original, mediaIssue: 'arbitrary private error text' }] })
      .expect(400);
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#225577' },
    })
      .png()
      .toBuffer();
    const image = await media.putObject({
      ownerUserId: u.id,
      purpose: 'chat_image',
      bytes,
      mimeType: 'image/png',
    });
    const fixed = await importHttp(u, [
      { ...original, mediaId: image.mediaId, mediaIssue: 'upload_limit_exceeded' },
    ]).expect(200);
    expect(fixed.body.items[0].mediaStatus).toBe('ready');
    const dto = (await http().get(E.list.path).set(auth(u)).expect(200)).body.items[0];
    expect(dto.mediaIssue).toBeNull();
    expect(dto.chatTitle).toBe(original.favorite.chatTitle);
    const sealed = (await rows(u))[0]!.snapshot_ciphertext!;
    plain = await crypto.open(u.id, `library:legacy-favorite:${stored.id}`, sealed);
    try {
      expect(JSON.parse(plain.toString())).toEqual({
        version: 1,
        favorite: original.favorite,
        mediaIssue: null,
      });
    } finally {
      plain.fill(0);
    }
    const unknown = await crypto.seal(
      u.id,
      `library:legacy-favorite:${stored.id}`,
      JSON.stringify({ version: 99, favorite: original.favorite, mediaIssue: null }),
    );
    await database.query('UPDATE library.legacy_favorites SET snapshot_ciphertext=$2 WHERE id=$1', [
      stored.id,
      unknown,
    ]);
    await http().get(E.list.path).set(auth(u)).expect(500);
  });

  it('媒体归属与可用性检查发生在收藏事务外，包含import返回和list阶段', async () => {
    const u = await user();
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#557799' },
    })
      .png()
      .toBuffer();
    const image = await media.putObject({
      ownerUserId: u.id,
      purpose: 'chat_image',
      bytes,
      mimeType: 'image/png',
    });
    const originalCanUse = media.canUse.bind(media);
    let calls = 0;
    const spy = vi.spyOn(media, 'canUse').mockImplementation(async (...args) => {
      calls++;
      const { rows: active } = await database.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'",
      );
      expect(active[0]!.n).toBe(0);
      return originalCanUse(...args);
    });
    try {
      const input = {
        ...item(
          u.key,
          favorite('port guard', { type: 'image', imageUrl: 'file:///synthetic/guard.png' }),
        ),
        mediaId: image.mediaId,
      };
      await importHttp(u, [input]).expect(200);
      await http().get(E.list.path).set(auth(u)).expect(200);
      expect(calls).toBeGreaterThanOrEqual(3);
    } finally {
      spy.mockRestore();
    }
  });

  it('附件映射与收藏快照及sync一起提交；sync失败不会留下映射', async () => {
    const u = await user();
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#664488' },
    })
      .png()
      .toBuffer();
    const image = await media.putObject({
      ownerUserId: u.id,
      purpose: 'chat_image',
      bytes,
      mimeType: 'image/png',
    });
    const input = {
      ...item(
        u.key,
        favorite('atomic upload', { type: 'image', imageUrl: 'file:///synthetic/atomic.png' }),
      ),
      mediaId: image.mediaId,
    };
    const sync = app.get<SyncPort>(SYNC_PORT);
    const spy = vi
      .spyOn(sync, 'appendUpdate')
      .mockRejectedValueOnce(new Error('SYNTHETIC_SYNC_FAILURE'));
    try {
      await importHttp(u, [input]).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await rows(u)).toHaveLength(0);
    expect(
      (
        await database.query('SELECT * FROM library.legacy_favorite_media_links WHERE user_id=$1', [
          u.id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect((await importHttp(u, [input]).expect(200)).body.imported).toBe(1);
  });

  it('失效旧附件映射可由新本人上传原子修复，原快照不变且重试幂等', async () => {
    const u = await user();
    const reference = 'file:///synthetic/repair-expired.png';
    const input = item(
      u.key,
      favorite('待恢复附件的原快照', { type: 'image', imageUrl: reference }),
    );
    await importHttp(u, [input]).expect(200);
    const before = (await rows(u))[0]!;
    await database.query(
      `INSERT INTO library.legacy_favorite_media_links(user_id,reference_hash,kind,media_id,source_batch)
      VALUES($1,$2,'image',$3,'synthetic-expired')`,
      [u.id, sha(reference), newId()],
    );
    expect((await http().get(E.list.path).set(auth(u)).expect(200)).body.items[0].mediaStatus).toBe(
      'unavailable',
    );
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#448866' },
    })
      .png()
      .toBuffer();
    const image = await media.putObject({
      ownerUserId: u.id,
      purpose: 'chat_image',
      bytes,
      mimeType: 'image/png',
    });
    for (let retry = 0; retry < 2; retry++) {
      const response = await importHttp(u, [{ ...input, mediaId: image.mediaId }]).expect(200);
      expect(response.body).toMatchObject({ imported: 0, existing: 1 });
      expect(response.body.items[0].mediaStatus).toBe('ready');
    }
    expect((await rows(u))[0]!.snapshot_ciphertext).toEqual(before.snapshot_ciphertext);
    expect(
      (
        await database.query<{ media_id: string }>(
          'SELECT media_id FROM library.legacy_favorite_media_links WHERE user_id=$1 AND reference_hash=$2',
          [u.id, sha(reference)],
        )
      ).rows,
    ).toEqual([{ media_id: image.mediaId }]);
  });

  it('并发失效映射旧计划不能覆盖另一请求刚修好的有效附件', async () => {
    const u = await user(),
      stale = newId(),
      reference = 'file:///synthetic/concurrent-repair.png';
    const input = item(u.key, favorite('同一原收藏', { type: 'image', imageUrl: reference }));
    await importHttp(u, [input]).expect(200);
    await database.query(
      `INSERT INTO library.legacy_favorite_media_links(user_id,reference_hash,kind,media_id,source_batch)
      VALUES($1,$2,'image',$3,'synthetic-expired')`,
      [u.id, sha(reference), stale],
    );
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#668844' },
    })
      .png()
      .toBuffer();
    const first = await media.putObject({
      ownerUserId: u.id,
      purpose: 'chat_image',
      bytes,
      mimeType: 'image/png',
    });
    const second = await media.putObject({
      ownerUserId: u.id,
      purpose: 'chat_image',
      bytes,
      mimeType: 'image/png',
    });
    const originalCanUse = media.canUse.bind(media);
    let arrived = 0;
    let release!: () => void;
    const bothObservedOld = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(media, 'canUse').mockImplementation(async (...args) => {
      if (args[1] === stale) {
        if (++arrived === 2) release();
        await bothObservedOld;
      }
      return originalCanUse(...args);
    });
    let responses;
    try {
      responses = await Promise.all(
        [first, second].map((image) => importHttp(u, [{ ...input, mediaId: image.mediaId }])),
      );
    } finally {
      spy.mockRestore();
    }
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = (
      await database.query<{ media_id: string }>(
        'SELECT media_id FROM library.legacy_favorite_media_links WHERE user_id=$1 AND reference_hash=$2',
        [u.id, sha(reference)],
      )
    ).rows[0]!.media_id;
    expect([first.mediaId, second.mediaId]).toContain(winner);
    const loser = winner === first.mediaId ? second.mediaId : first.mediaId;
    expect(
      (await importHttp(u, [{ ...input, mediaId: loser }]).expect(200)).body.items[0].mediaStatus,
    ).toBe('ready');
    expect(
      (
        await database.query<{ media_id: string }>(
          'SELECT media_id FROM library.legacy_favorite_media_links WHERE user_id=$1 AND reference_hash=$2',
          [u.id, sha(reference)],
        )
      ).rows[0]!.media_id,
    ).toBe(winner);
  });

  it('仅sync收藏变化，无费用/成就事件；注销合并清除来源、密文和墓碑，不得重建', async () => {
    const u = await user();
    const before = (
      await database.query<{ n: number }>('SELECT count(*)::int AS n FROM billing.ledger_entries')
    ).rows[0]!.n;
    await importHttp(u, [item(u.key)]).expect(200);
    await http()
      .delete(E.list.path + '/' + (await rows(u))[0]!.id)
      .set(auth(u))
      .expect(204);
    await database.query(
      `INSERT INTO library.legacy_favorite_media_links(user_id,reference_hash,kind,media_id,source_batch)
      VALUES($1,$2,'image',$3,'synthetic-fixture')`,
      [u.id, sha('synthetic-path'), newId()],
    );
    expect(
      (await database.query<{ n: number }>('SELECT count(*)::int AS n FROM billing.ledger_entries'))
        .rows[0]!.n,
    ).toBe(before);
    expect(
      (
        await database.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM platform.outbox WHERE event_type='library.favorite_added'",
        )
      ).rows[0]!.n,
    ).toBe(0);
    const library = app
      .get<UserDataRegistry>(USER_DATA_REGISTRY)
      .list()
      .find((owner) => owner.module === 'library')!;
    expect(await library.countUserData(u.id)).toBeGreaterThanOrEqual(3);
    await database.query("UPDATE identity.users SET status='deleting' WHERE id=$1", [u.id]);
    await expect(service.import(u.id, { items: [item(u.key)] })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await library.purgeUser(u.id);
    expect(await library.countUserData(u.id)).toBe(0);
    expect(await rows(u)).toHaveLength(0);
    expect(await library.purgeUser(u.id)).toBe(0);
  });
});
