/**
 * T-20261103c：角色广场「微伴角色」详情的取数口径（CharacterPlazaPort.getOfficialProfile）。
 *
 * 生产上已上架的官方角色全是旧卡（legacy_card 不为空），之前详情借用 presetForCopy（旧卡不能复制 → null），
 * 所以详情、点赞、评论全部「角色不存在或已下架」（点赞、评论都先经 getOfficialProfile 校验，plaza 侧用例见
 * plaza/application/plaza-official.service.test.ts）。这里只假 DB 的一行角色，走真实的 CharacterService /
 * CharacterPlazaService 代码路径：
 * - 旧卡已上架预设：能取到详情，公开人设只摘简介、性格、说话方式并截断，口头禅为空，不带世界书 / 示例对话 / 避免词 / 开场白；
 * - 未上架、非预设、不存在：返回 null（plaza 转成 not_found）；
 * - 「复制」口径不变：旧卡 presetForCopy 仍是 null。
 */
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { CharacterProfile, PlazaOfficialPersona } from '@weiban/contracts';
import { CharacterService } from './characters.js';
import { CharacterPlazaService } from './plaza-port.js';

const ROLE_ID = '0190f3a1-0000-7000-8000-00000000a001';
const VIEWER = '0190f3a1-0000-7000-8000-00000000b001';

const LONG = '很'.repeat(400);
const legacyCard = {
  id: 'legacy-1',
  display_name: '程澈',
  signature: '今天也在写歌',
  core_persona: `原创成年人物，乐队主唱。${LONG}`,
  soul_personality: `外冷内热，嘴硬心软。${LONG}`,
  speaking_style: '',
  style_chat_style: `说话短，爱用省略号。${LONG}`,
  style_avoid_json: JSON.stringify(['不许说的词A']),
  opening_messages_json: JSON.stringify(['开场白原文不该出现']),
  knowledge_json: JSON.stringify({ secret: '世界书原文不该出现' }),
};

function roleRow(over: Record<string, unknown> = {}) {
  return {
    id: ROLE_ID,
    kind: 'preset',
    status: 'published',
    ownerId: null,
    categoryId: null,
    basis: 'original',
    realPersonKind: null,
    ageSetting: 'adult',
    childAppearance: false,
    childFeaturesDetected: false,
    publishedChildFeaturesDetected: false,
    eligibilityOverride: null,
    everPrivatePerson: false,
    publishedCiphertext: null,
    draftCiphertext: null,
    avatarMediaId: null,
    personaVersion: 3,
    revision: 1,
    legacyCard,
    ...over,
  };
}

/** this.database.db：select().from().where() 返回给定行。 */
function fakeDatabase(rows: unknown[]) {
  return {
    db: { select: () => ({ from: () => ({ where: async () => rows }) }) },
  };
}

function characterService(rows: unknown[]) {
  const service = Object.create(CharacterService.prototype) as CharacterService;
  Object.assign(service, {
    database: fakeDatabase(rows),
    contacts: null,
    supplements: null,
    media: { getMedia: vi.fn() },
    crypto: {
      open: vi.fn(async () => {
        throw Error('旧卡不应读取新格式密文');
      }),
    },
  });
  return service;
}

function plazaPort(rows: unknown[]) {
  const port = Object.create(CharacterPlazaService.prototype) as CharacterPlazaService;
  Object.assign(port, { characters: characterService(rows) });
  return port;
}

describe('getOfficialProfile（广场「微伴角色」详情）', () => {
  it('旧卡已上架预设角色能取到详情，公开人设只摘几项并截断', async () => {
    const found = await plazaPort([roleRow()]).getOfficialProfile(VIEWER, ROLE_ID);
    expect(found).not.toBeNull();
    const { profile, persona } = found!;
    expect(CharacterProfile.parse(profile).name).toBe('程澈');
    expect(PlazaOfficialPersona.parse(persona)).toEqual(persona);
    expect(persona.summary.startsWith('原创成年人物，乐队主唱。')).toBe(true);
    expect(persona.summary).toHaveLength(300);
    expect(persona.personality.startsWith('外冷内热，嘴硬心软。')).toBe(true);
    expect(persona.personality).toHaveLength(300);
    // speaking_style 为空时取 style_chat_style，截 200 字。
    expect(persona.speechStyle.startsWith('说话短，爱用省略号。')).toBe(true);
    expect(persona.speechStyle).toHaveLength(200);
    expect(persona.catchphrases).toEqual([]);
    const text = JSON.stringify(persona);
    for (const hidden of ['不许说的词A', '开场白原文不该出现', '世界书原文不该出现'])
      expect(text).not.toContain(hidden);
  });

  it('旧卡有 speaking_style 时优先取它', async () => {
    const row = roleRow({ legacyCard: { ...legacyCard, speaking_style: '慢条斯理' } });
    const found = await plazaPort([row]).getOfficialProfile(VIEWER, ROLE_ID);
    expect(found?.persona.speechStyle).toBe('慢条斯理');
  });

  it('未上架、非预设、不存在都返回 null（not_found）', async () => {
    for (const rows of [
      [roleRow({ status: 'unpublished' })],
      [roleRow({ status: 'draft' })],
      [roleRow({ kind: 'custom', ownerId: VIEWER })],
      [],
    ])
      expect(await plazaPort(rows).getOfficialProfile(VIEWER, ROLE_ID)).toBeNull();
  });

  it('「复制」口径不变：旧卡角色 presetForCopy 仍是 null', async () => {
    expect(await characterService([roleRow()]).presetForCopy(ROLE_ID)).toBeNull();
  });
});
