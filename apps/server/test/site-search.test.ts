/**
 * T-20261104b 站内角色搜索（契约 5.5 SearchEndpoints.suggest / results）真实 PG 集成测试。
 *
 * 覆盖任务卡「验收」：「易烊千」前缀、单处错字、两位李晨、同人不同作者、改名、英文别名、只有一个字、私人朋友同名、
 * 已添加 / 撤稿 / 下架 / 停权、热门同名不压过精确匹配、分页稳定游标、超长与空白输入；
 * 最后用自造的几千条数据量出固定语料 Top-5 命中率、同名误合并率和站内查询耗时（结果打印在测试输出里）。
 * 测试数据全部在本测试里自造，不读任何用户数据。
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AdminCharacterWrite,
  AuthResponse,
  CharacterCard,
  SearchEndpoints,
  UserCustomCharacter,
} from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import {
  DATABASE,
  JOB_QUEUE,
  TestClock,
  newId,
  type Database,
  type JobQueue,
} from '../src/platform/index.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { CharacterSearchIndex } from '../src/modules/characters/index.js';
import {
  CharacterCheckWorker,
  CharacterService,
  CHARACTER_EVALUATOR,
} from '../src/modules/characters/testing.js';
import { PlazaSearchIndex, SiteSearchService } from '../src/modules/plaza/index.js';
import { ContactsCommands, ContactsTestQueries } from '../src/modules/contacts/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

const sample = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
    'utf8',
  ).match(/```json\s*([\s\S]*?)```/)![1]!,
) as { card: unknown };
const baseCard = CharacterCard.parse(sample.card);

type SuggestBody = ReturnType<typeof SearchEndpoints.suggest.response.parse>;
type ResultsBody = ReturnType<typeof SearchEndpoints.results.response.parse>;

const PASSWORD = 'correct horse battery';
const device = {
  platform: 'web',
  name: 'search test',
  appVersion: '0.1.0',
  timeZone: 'Asia/Shanghai',
};

describeDb('站内角色搜索 T-20261104b 真实PG', () => {
  let app: INestApplication;
  let db: Database;
  let adminId: string;
  let meId: string;
  let meToken: string;
  let otherToken: string;
  const authorIds: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const clock = new TestClock('2026-11-04T08:00:00.000Z');
  const logs = captureLogger();
  const http = () => request(app.getHttpServer());

  async function login(username: string): Promise<string> {
    return AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/login')
          .send({ username, password: PASSWORD, device, kind: 'app' })
          .expect(200)
      ).body,
    ).session.token;
  }

  async function user(username: string): Promise<string> {
    const commands = app.get(IdentityCommands);
    const id = await commands.createAdmin(username, PASSWORD);
    await commands.setRole(username, 'user');
    return id;
  }

  async function preset(input: {
    name: string;
    aliases?: string[];
    works?: string[];
    tagline?: string;
    occupation?: string;
    publish?: boolean;
  }): Promise<string> {
    const card = structuredClone(baseCard);
    const extra = card.data.profileExtra as { occupation?: string } | undefined;
    if (extra && input.occupation) extra.occupation = input.occupation;
    const service = app.get(CharacterService);
    const row = await service.create(
      adminId,
      AdminCharacterWrite.parse({
        name: input.name,
        aliases: input.aliases ?? [],
        works: input.works ?? [],
        tagline: input.tagline ?? '测试',
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
        card,
      }),
    );
    if (input.publish === false) return row.characterId;
    await app
      .get(CharacterCheckWorker)
      .runChecks({ characterId: row.characterId, adminId, revision: 1 });
    return (await service.publish(adminId, row.characterId)).characterId;
  }

  async function custom(token: string, name: string): Promise<string> {
    const body = await http()
      .post('/api/v1/characters/custom')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name,
        description:
          '一位原创的成年虚构角色，喜欢阅读和观察日常生活，说话自然简洁，尊重他人边界，愿意认真倾听，不编造真实经历，也不声称自己是真人。',
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult',
          childAppearance: false,
        },
      })
      .expect(200);
    return UserCustomCharacter.parse(body.body).characterId;
  }

  async function befriend(userId: string, token: string, characterId: string): Promise<void> {
    await http()
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ characterId })
      .expect((res) => {
        if (res.status !== 200) throw new Error(`${res.status} ${logs.capture.text.slice(-3000)}`);
      });
    const row = await new ContactsTestQueries(db).row(userId, characterId);
    if (!row) throw new Error('missing contact');
    clock.advance(Math.max(0, row.accept_after.getTime() - clock.nowMs()));
    await app.get(ContactsCommands).accept({ userId, characterId, requestId: row.request_id });
  }

  async function author(username: string, nickname: string): Promise<string> {
    const id = await user(username);
    await db.query(
      `INSERT INTO plaza.author_profiles (user_id, author_id, nickname, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)`,
      [id, newId(), nickname, clock.now()],
    );
    return id;
  }

  async function work(input: {
    authorId: string;
    name: string;
    kind?: 'custom_character' | 'preset_variant';
    basedOn?: { id: string; name: string };
    status?: 'listed' | 'unlisted_by_author' | 'removed_by_admin';
    adoptCount?: number;
  }): Promise<string> {
    const id = newId();
    await db.query(
      `INSERT INTO plaza.works (id, author_user_id, kind, source_character_id, based_on_preset_id,
         based_on_preset_name, name, basis, tagline, status, adopt_count, published_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'original', '测试作品', $8, $9, $10, $10)`,
      [
        id,
        input.authorId,
        input.kind ?? 'custom_character',
        newId(),
        input.basedOn?.id ?? null,
        input.basedOn?.name ?? null,
        input.name,
        input.status ?? 'listed',
        input.adoptCount ?? 0,
        clock.now(),
      ],
    );
    return id;
  }

  async function suggest(q: string, token = meToken): Promise<SuggestBody> {
    const res = await http()
      .get('/api/v1/search/suggest')
      .query({ q })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return SearchEndpoints.suggest.response.parse(res.body);
  }

  async function results(
    q: string,
    extra: { prefer?: 'official' | 'plaza'; cursor?: string; limit?: number } = {},
    token = meToken,
  ): Promise<ResultsBody> {
    const res = await http()
      .get('/api/v1/search/characters')
      .query({ q, ...extra })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return SearchEndpoints.results.response.parse(res.body);
  }

  const idsOf = (body: ResultsBody) => body.items.map((item) => item.candidateId);

  beforeAll(async () => {
    await resetTestDatabase();
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig(),
          clock,
          logger: logs.logger,
          kekRing: testKekRing().ring,
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
    db = app.get(DATABASE);
    adminId = await app.get(IdentityCommands).createAdmin('search_admin', PASSWORD);
    meId = await user('search_me');
    await user('search_other');
    meToken = await login('search_me');
    otherToken = await login('search_other');

    // 官方角色（已上架预设）。
    ids.yyqx = await preset({
      name: '易烊千玺',
      aliases: ['千玺', 'Jackson Yee'],
      works: ['少年的你'],
      occupation: '演员、歌手',
    });
    ids.lichenA = await preset({ name: '李晨', works: ['奔跑吧'], occupation: '演员' });
    ids.lichenB = await preset({ name: '李晨', occupation: '服装领域创作者' });
    ids.wyb = await preset({ name: '王一博', aliases: ['Wang Yibo'], occupation: '演员' });
    ids.unpublished = await preset({ name: '下架测试角色' });
    await app.get(CharacterService).unpublish(adminId, ids.unpublished);
    ids.draft = await preset({ name: '草稿测试角色', publish: false });

    // 本人角色与别人的私人角色。
    ids.myLichen = await custom(meToken, '李晨');
    ids.myRename = await custom(meToken, '旧名字小雨');
    ids.otherSecret = await custom(otherToken, '秘密朋友阿杰');

    // 广场作品（直接写表；本测试只验证搜索，不走发布检测）。
    authorIds.a = await author('search_author_a', '作者甲');
    authorIds.b = await author('search_author_b', '作者乙');
    authorIds.banned = await author('search_author_c', '作者丙');
    ids.foxA = await work({ authorId: authorIds.a, name: '小狐狸' });
    ids.foxB = await work({ authorId: authorIds.b, name: '小狐狸' });
    ids.variant = await work({
      authorId: authorIds.a,
      name: '晨哥',
      kind: 'preset_variant',
      basedOn: { id: ids.lichenA, name: '李晨' },
    });
    ids.withdrawn = await work({
      authorId: authorIds.a,
      name: '撤稿作品阿竹',
      status: 'unlisted_by_author',
    });
    ids.removed = await work({
      authorId: authorIds.b,
      name: '下架作品阿兰',
      status: 'removed_by_admin',
    });
    ids.bannedWork = await work({ authorId: authorIds.banned, name: '停权作者作品阿梅' });
    await db.query(
      `INSERT INTO plaza.bans (user_id, permanent, reason, created_by, created_at)
       VALUES ($1, true, '测试停权', $2, $3)`,
      [authorIds.banned, adminId, clock.now()],
    );
    ids.hotPrefix = await work({ authorId: authorIds.b, name: '易烊千玺的猫', adoptCount: 99999 });
    ids.hotSame = await work({ authorId: authorIds.b, name: '王一博', adoptCount: 99999 });

    // 我从作者乙的「小狐狸」复制了一份并加为好友；王一博也已加好友。
    ids.myFoxCopy = await custom(meToken, '小狐狸');
    await db.query(
      `INSERT INTO plaza.adoptions (id, user_id, work_id, version, kind, character_id, created_at, updated_at)
       VALUES ($1, $2, $3, 1, 'copy', $4, $5, $5)`,
      [newId(), meId, ids.foxB, ids.myFoxCopy, clock.now()],
    );
    await befriend(meId, meToken, ids.myFoxCopy);
    await befriend(meId, meToken, ids.wyb);

    await app.get(CharacterSearchIndex).refresh(10_000);
    await app.get(PlazaSearchIndex).refresh(10_000);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('未登录 401；参数越界 400；空白与只有标点返回空结果，不报错', async () => {
    await http().get('/api/v1/search/suggest').query({ q: '李晨' }).expect(401);
    await http().get('/api/v1/search/characters').query({ q: '李晨' }).expect(401);
    await http()
      .get('/api/v1/search/characters')
      .query({ q: '李晨', limit: 21 })
      .set('Authorization', `Bearer ${meToken}`)
      .expect(400);
    await http()
      .get('/api/v1/search/suggest')
      .query({ q: '长'.repeat(201) })
      .set('Authorization', `Bearer ${meToken}`)
      .expect(400);
    expect(await suggest('   ')).toEqual({ query: '', items: [], didYouMean: [] });
    expect(await results('，。！')).toEqual({
      query: '',
      items: [],
      nextCursor: null,
      didYouMean: [],
    });
    // 超过 64 字只取前 64 字参与匹配。
    expect(Array.from((await suggest('易'.repeat(100))).query)).toHaveLength(64);
  });

  it('「易烊千」前缀联想出易烊千玺；完整拼音、首字母、英文别名、中文别名都能找到', async () => {
    const prefix = await suggest('易烊千');
    expect(prefix.items[0]).toMatchObject({ text: '易烊千玺', match: 'prefix' });
    expect(prefix.items[0]!.sources).toContain('official');
    expect(prefix.didYouMean).toEqual([]);

    expect((await suggest('yiyangqianxi')).items[0]).toMatchObject({
      text: '易烊千玺',
      match: 'pinyin',
    });
    expect((await suggest('yyqx')).items[0]).toMatchObject({ text: '易烊千玺', match: 'initials' });
    expect((await suggest('jackson')).items[0]).toMatchObject({
      text: '易烊千玺',
      match: 'prefix',
      matchedTerm: { text: 'Jackson Yee', kind: 'alias' },
    });
    expect((await suggest('Jackson Yee')).items[0]).toMatchObject({
      text: '易烊千玺',
      match: 'exact',
      matchedTerm: { text: 'Jackson Yee', kind: 'alias' },
    });
    const alias = await results('千玺');
    expect(alias.items[0]).toMatchObject({
      candidateId: `official:${ids.yyqx}`,
      source: 'official',
      action: 'add',
      match: 'exact',
      matchedTerm: { text: '千玺', kind: 'alias' },
      added: false,
      identity: '演员、歌手，代表作品《少年的你》',
      unverified: false,
    });
    expect(alias.items[0]!.character?.characterId).toBe(ids.yyqx);
  });

  it('错字只给「你是否想找」，不改写搜索词；两字名字不按任意替换提示', async () => {
    const homophone = await suggest('易洋千玺');
    expect(homophone.query).toBe('易洋千玺');
    expect(homophone.items).toEqual([]);
    // 同音（拼音完全相同）排第一；同音前缀的「易烊千玺的猫」排在后面。
    expect(homophone.didYouMean.map((d) => d.text)).toEqual(['易烊千玺', '易烊千玺的猫']);
    expect((await suggest('易洋千')).didYouMean[0]).toEqual({ text: '易烊千玺' });
    expect((await suggest('王一傅')).didYouMean.map((d) => d.text)).toContain('王一博');
    expect((await suggest('yiyangqianxu')).didYouMean).toEqual([{ text: '易烊千玺' }]);
    // 「厉晨」与「李晨」同音；「李明」既不同音也只有两个字，不提示「李晨」。
    expect((await suggest('厉晨')).didYouMean).toEqual([{ text: '李晨' }]);
    expect((await suggest('李明')).didYouMean).toEqual([]);
    // 有精确命中就不打扰。
    expect((await suggest('李晨')).didYouMean).toEqual([]);
    const typoResults = await results('易洋千玺');
    expect(typoResults.items).toEqual([]);
    expect(typoResults.didYouMean[0]).toEqual({ text: '易烊千玺' });
  });

  it('两位李晨、本人的私人朋友「李晨」和基于李晨的改编作品分开列出，各带身份说明，不合并', async () => {
    const body = await results('李晨');
    const lichen = body.items.filter((item) => item.name === '李晨');
    expect(lichen.map((item) => item.candidateId).sort()).toEqual(
      [`official:${ids.lichenA}`, `official:${ids.lichenB}`, `own:${ids.myLichen}`].sort(),
    );
    for (const item of lichen) expect(item.ambiguous).toBe(true);
    const byId = new Map(body.items.map((item) => [item.candidateId, item]));
    expect(byId.get(`official:${ids.lichenA}`)).toMatchObject({
      identity: '演员，代表作品《奔跑吧》',
      action: 'add',
      unverified: false,
    });
    expect(byId.get(`official:${ids.lichenB}`)?.identity).toBe('服装领域创作者');
    expect(byId.get(`own:${ids.myLichen}`)).toMatchObject({
      source: 'own',
      action: 'open_own',
      identity: '我创建的角色',
      characterId: ids.myLichen,
    });
    expect(byId.get(`plaza:${ids.variant}`)).toMatchObject({
      source: 'plaza',
      action: 'view_work',
      name: '晨哥',
      matchedTerm: { text: '李晨', kind: 'based_on' },
      identity: '基于官方角色「李晨」改编 · 作者 作者甲',
      workId: ids.variant,
      characterId: null,
      ambiguous: false,
    });
    // 精确同名在前，改编作品（基于的角色命中）在后；同分时官方在本人前。
    expect(idsOf(body).slice(0, 3)).toEqual([
      ...[`official:${ids.lichenA}`, `official:${ids.lichenB}`].sort(),
      `own:${ids.myLichen}`,
    ]);
    expect(idsOf(body).indexOf(`plaza:${ids.variant}`)).toBe(3);
    // 联想里同名只有一行，但记下出现在哪些来源。
    const s = await suggest('李晨');
    expect(s.items.filter((item) => item.text === '李晨')).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ text: '李晨', match: 'exact' });
    expect(s.items[0]!.sources).toEqual(['official', 'own']);
  });

  it('私人角色只有本人搜得到；别人的同名私人朋友不进我的结果', async () => {
    expect((await results('秘密朋友')).items).toEqual([]);
    expect((await suggest('秘密朋友')).items).toEqual([]);
    const theirs = await results('秘密朋友', {}, otherToken);
    expect(idsOf(theirs)).toEqual([`own:${ids.otherSecret}`]);
    const otherLichen = await results('李晨', {}, otherToken);
    expect(idsOf(otherLichen)).not.toContain(`own:${ids.myLichen}`);
    expect(otherLichen.items.filter((item) => item.source === 'own')).toEqual([]);
  });

  it('同人不同作者：两份「小狐狸」分开显示作者；我已添加的那份显示去聊天，复制出的角色不重复列出', async () => {
    const body = await results('小狐狸');
    const byId = new Map(body.items.map((item) => [item.candidateId, item]));
    expect(byId.get(`plaza:${ids.foxA}`)).toMatchObject({
      action: 'view_work',
      added: false,
      identity: '广场原创 · 作者 作者甲',
      ambiguous: true,
    });
    const mine = byId.get(`plaza:${ids.foxB}`);
    expect(mine).toMatchObject({
      action: 'chat',
      added: true,
      characterId: ids.myFoxCopy,
      identity: '广场原创 · 作者 作者乙',
      ambiguous: true,
    });
    expect(mine?.conversationId).toBeTruthy();
    expect(mine?.work?.author.nickname).toBe('作者乙');
    expect(byId.has(`own:${ids.myFoxCopy}`)).toBe(false);
    // 已添加的排在同分的前面。
    expect(idsOf(body)[0]).toBe(`plaza:${ids.foxB}`);
  });

  it('只有一个字：只认精确与前缀，不做包含、拼音和错字', async () => {
    const one = await results('李');
    expect(idsOf(one)).toEqual(
      expect.arrayContaining([`official:${ids.lichenA}`, `official:${ids.lichenB}`]),
    );
    for (const item of one.items) expect(item.match).toBe('prefix');
    expect(one.didYouMean).toEqual([]);
    // 「玺」只出现在名字中间：一个字不做包含匹配。
    expect((await results('玺')).items).toEqual([]);
    expect((await suggest('y')).items.every((item) => item.match === 'prefix')).toBe(true);
  });

  it('已添加的官方角色显示去聊天；热门同名作品不压过精确匹配的官方角色', async () => {
    const body = await results('王一博');
    expect(body.items[0]).toMatchObject({
      candidateId: `official:${ids.wyb}`,
      action: 'chat',
      added: true,
    });
    expect(body.items[0]!.conversationId).toBeTruthy();
    expect(body.items[0]!.character?.added).toBe(true);
    expect(body.items[1]).toMatchObject({ candidateId: `plaza:${ids.hotSame}`, ambiguous: true });
    expect((await results('Wang Yibo')).items[0]?.candidateId).toBe(`official:${ids.wyb}`);
    // 热门的「易烊千玺的猫」只是前缀，排在精确的易烊千玺后面。
    const yy = await results('易烊千玺');
    expect(idsOf(yy).slice(0, 2)).toEqual([`official:${ids.yyqx}`, `plaza:${ids.hotPrefix}`]);
    // 明确选了广场页签：同分时广场作品在前。
    const preferPlaza = await results('王一博', { prefer: 'plaza' });
    expect(preferPlaza.items[0]?.candidateId).toBe(`plaza:${ids.hotSame}`);
  });

  it('撤稿、下架、作者停权、官方下架和草稿都搜不到；改名后旧名找不到、新名找得到', async () => {
    for (const q of [
      '撤稿作品阿竹',
      '下架作品阿兰',
      '停权作者作品阿梅',
      '下架测试角色',
      '草稿测试角色',
    ])
      expect((await results(q)).items, q).toEqual([]);

    await http()
      .patch(`/api/v1/characters/custom/${ids.myRename}`)
      .set('Authorization', `Bearer ${meToken}`)
      .send({ name: '新名字小雪' })
      .expect(200);
    expect((await results('旧名字')).items).toEqual([]);
    expect(idsOf(await results('新名字'))).toEqual([`own:${ids.myRename}`]);

    await db.query(`UPDATE plaza.works SET name = '小狐狸改名' WHERE id = $1`, [ids.foxA]);
    expect(idsOf(await results('小狐狸改'))).toEqual([`plaza:${ids.foxA}`]);
  });

  it('上架中的作品撤稿、官方角色下架后立刻搜不到（刷新投影之前也查源表）；停权到期后恢复', async () => {
    await db.query(`UPDATE plaza.works SET status = 'unlisted_by_author' WHERE id = $1`, [
      ids.foxA,
    ]);
    await app.get(CharacterService).unpublish(adminId, ids.lichenB!);
    // 刷新前：投影还在，但查询按源表核对资格。
    const stale = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM plaza.search_terms WHERE work_id = $1',
      [ids.foxA],
    );
    expect(stale.rows[0]!.n).toBeGreaterThan(0);
    const after = await results('李晨');
    expect(idsOf(after)).not.toContain(`official:${ids.lichenB}`);
    expect(idsOf(await results('小狐狸'))).not.toContain(`plaza:${ids.foxA}`);
    // 刷新后投影也删掉了。
    await app.get(PlazaSearchIndex).refresh(100);
    await app.get(CharacterSearchIndex).refresh(100);
    const gone = await db.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM plaza.search_terms WHERE work_id = $1)
            + (SELECT count(*) FROM characters.search_terms WHERE character_id = $2) AS n`,
      [ids.foxA, ids.lichenB],
    );
    expect(Number(gone.rows[0]!.n)).toBe(0);

    // 停权改成已到期：作品重新可见（停权不写进投影，查询时现查）。
    await db.query(`UPDATE plaza.bans SET permanent = false, until = $2 WHERE user_id = $1`, [
      authorIds.banned,
      new Date(clock.nowMs() - 1000),
    ]);
    expect(idsOf(await results('停权作者作品阿梅'))).toEqual([`plaza:${ids.bannedWork}`]);
  });

  it('每页 20 条、稳定游标：翻页不重复不遗漏；换了搜索词的游标从第一页开始', async () => {
    for (let i = 1; i <= 25; i++)
      await work({ authorId: authorIds.a!, name: `分页测试角色${String(i).padStart(2, '0')}` });
    const first = await results('分页测试');
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBeTruthy();
    const second = await results('分页测试', { cursor: first.nextCursor! });
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(second.didYouMean).toEqual([]);
    const all = [...idsOf(first), ...idsOf(second)];
    expect(new Set(all).size).toBe(25);
    const again = await results('分页', { cursor: first.nextCursor! });
    expect(idsOf(again)).toEqual(idsOf(await results('分页')));
    const small = await results('分页测试', { limit: 7 });
    const next = await results('分页测试', { limit: 7, cursor: small.nextCursor! });
    expect(idsOf(next)).toEqual(idsOf(first).slice(7, 14));
  });

  describe('固定语料与耗时（自造几千条数据）', () => {
    const SURNAMES = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴'];
    const GIVEN1 = ['子', '雨', '思', '浩', '欣', '嘉', '梓', '俊', '宇', '佳'];
    const GIVEN2 = ['涵', '轩', '怡', '豪', '琪', '杰', '萱', '然', '睿', '彤'];
    const names3: string[] = [];
    for (const s of SURNAMES)
      for (const a of GIVEN1) for (const b of GIVEN2) names3.push(`${s}${a}${b}`);
    const names4 = names3.flatMap((n) => [`${n}儿`, `${n}君`]);
    const official = new Map<string, string>();
    const plaza = new Map<string, string>();

    beforeAll(async () => {
      // 官方噪声：3000 个旧卡格式的已上架预设（复制一个模板角色，只换 ID、名字和旧卡名）。
      const template = await preset({ name: '噪声模板' });
      const all = [...names3, ...names4];
      const inserted = await db.query<{ id: string; name: string }>(
        `INSERT INTO characters.characters
         SELECT (jsonb_populate_record(c, jsonb_build_object(
           'id', gen_random_uuid(), 'name', n.name, 'search_text', n.name,
           'legacy_card', jsonb_build_object('display_name', n.name)))).*
         FROM characters.characters c, unnest($2::text[]) AS n(name)
         WHERE c.id = $1
         RETURNING id, name`,
        [template, all],
      );
      for (const row of inserted.rows) official.set(row.name, row.id);
      // 广场噪声：与 1000 个三字名同名的作品（同名不同人物的反例）。
      const works = await db.query<{ id: string; name: string }>(
        `INSERT INTO plaza.works (id, author_user_id, kind, source_character_id, name, basis, tagline,
           status, published_at, updated_at)
         SELECT gen_random_uuid(), $1, 'custom_character', gen_random_uuid(), n.name, 'original',
           '噪声作品', 'listed', $3, $3
         FROM unnest($2::text[]) AS n(name)
         RETURNING id, name`,
        [authorIds.b, names3, clock.now()],
      );
      for (const row of works.rows) plaza.set(row.name, row.id);
      const started = performance.now();
      const refreshed =
        (await app.get(CharacterSearchIndex).refresh(10_000)) +
        (await app.get(PlazaSearchIndex).refresh(10_000));
      console.info(
        `[site-search] 刷新投影 ${refreshed} 条，用时 ${Math.round(performance.now() - started)} ms`,
      );
    }, 300_000);

    it('主要前缀用例 Top-5 命中率 ≥ 95%，同名反例零误合并，站内查询耗时', async () => {
      const termCount = await db.query<{ n: number }>(
        `SELECT (SELECT count(*) FROM characters.search_terms)
              + (SELECT count(*) FROM plaza.search_terms) AS n`,
      );
      // 固定语料：查询 → 应命中的候选。
      const corpus: Array<{ q: string; expect: string }> = [
        { q: '易烊千', expect: `official:${ids.yyqx}` },
        { q: '易烊', expect: `official:${ids.yyqx}` },
        { q: 'yiyangqianxi', expect: `official:${ids.yyqx}` },
        { q: 'yyqx', expect: `official:${ids.yyqx}` },
        { q: 'jackson', expect: `official:${ids.yyqx}` },
        { q: '千玺', expect: `official:${ids.yyqx}` },
        { q: '王一', expect: `official:${ids.wyb}` },
        { q: 'wangyibo', expect: `official:${ids.wyb}` },
        { q: 'wang yi', expect: `official:${ids.wyb}` },
        { q: '李晨', expect: `official:${ids.lichenA}` },
        { q: '新名字', expect: `own:${ids.myRename}` },
      ];
      const pick = <T>(list: T[], step: number) => list.filter((_, i) => i % step === 0);
      for (const name of pick(names3, 10))
        corpus.push({ q: name, expect: `official:${official.get(name)}` });
      for (const name of pick(names4, 20))
        corpus.push({
          q: Array.from(name).slice(0, 3).join(''),
          expect: `official:${official.get(name)}`,
        });
      for (const name of pick(names4, 20))
        corpus.push({ q: name, expect: `official:${official.get(name)}` });

      const service = app.get(SiteSearchService);
      let hits = 0;
      const misses: string[] = [];
      for (const { q, expect: want } of corpus) {
        const body = await service.results(meId, { q, limit: 20 });
        if (body.items.slice(0, 5).some((item) => item.candidateId === want)) hits++;
        else misses.push(q);
      }
      const top5 = hits / corpus.length;

      // 同名反例：每组都必须分成独立的项，并标 ambiguous。
      const groups: Array<{ q: string; members: string[] }> = [
        { q: '李晨', members: [`official:${ids.lichenA}`, `own:${ids.myLichen}`] },
        { q: '王一博', members: [`official:${ids.wyb}`, `plaza:${ids.hotSame}`] },
        ...pick(names3, 5).map((name) => ({
          q: name,
          members: [`official:${official.get(name)}`, `plaza:${plaza.get(name)}`],
        })),
      ];
      let merged = 0;
      for (const group of groups) {
        const body = await service.results(meId, { q: group.q, limit: 20 });
        const found = body.items.filter((item) => group.members.includes(item.candidateId));
        if (found.length !== group.members.length || found.some((item) => !item.ambiguous))
          merged++;
      }
      const falseMerge = merged / groups.length;

      // 耗时：联想与结果各跑一遍预热，再各测 100 次。
      const queries = [
        '易烊千',
        'yyqx',
        '张子',
        '王一博',
        '李',
        'jackson',
        '易洋千玺',
        '陈佳睿',
        'zhang',
        '小狐',
      ];
      const measure = async (fn: (q: string) => Promise<unknown>) => {
        for (const q of queries) await fn(q);
        const samples: number[] = [];
        for (let i = 0; i < 100; i++) {
          const started = performance.now();
          await fn(queries[i % queries.length]!);
          samples.push(performance.now() - started);
        }
        samples.sort((a, b) => a - b);
        return { p50: samples[49]!, p95: samples[94]!, max: samples[99]! };
      };
      const suggestMs = await measure((q) => service.suggest(meId, q));
      const resultsMs = await measure((q) => service.results(meId, { q, limit: 20 }));
      const fmt = (m: { p50: number; p95: number; max: number }) =>
        `p50 ${m.p50.toFixed(1)} ms / p95 ${m.p95.toFixed(1)} ms / max ${m.max.toFixed(1)} ms`;
      console.info(
        [
          `[site-search] 投影词条 ${termCount.rows[0]!.n} 条（官方 ${official.size + 5}、广场 ${plaza.size + 35}）`,
          `[site-search] 固定语料 ${corpus.length} 条，Top-5 命中 ${hits}（${(top5 * 100).toFixed(1)}%）${misses.length ? `，未命中：${misses.join('、')}` : ''}`,
          `[site-search] 同名反例 ${groups.length} 组，误合并 ${merged}（${(falseMerge * 100).toFixed(1)}%）`,
          `[site-search] 联想 ${fmt(suggestMs)}`,
          `[site-search] 结果 ${fmt(resultsMs)}`,
        ].join('\n'),
      );
      expect(top5).toBeGreaterThanOrEqual(0.95);
      expect(falseMerge).toBe(0);
      // CI 机器慢、波动大：这里只设宽松上限防止明显退化；本机实测值见输出与交接。
      expect(suggestMs.p95).toBeLessThan(500);
    }, 300_000);
  });
});
