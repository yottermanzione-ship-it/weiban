import { describe, expect, it } from 'vitest';
import { readLegacyAdminFields } from './legacy-admin.js';
import {
  buildLegacySnapshot,
  foreignEntryIds,
  planLegacyRestore,
  type LegacyCurrentState,
  type LegacySnapshotData,
} from './legacy-revisions.js';

/** 64 位十六进制：审计脱敏会把连续 32 位以上字母数字打码，快照必须原样保留。 */
const LONG_TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
const SIGNED_URL = `http://103.231.58.124/api/v1/media/01a16dd0-04d5-770f-acbb-3c94e4960a61/content?token=${LONG_TOKEN}`;
const CHARACTER_ID = '11111111-1111-7111-8111-111111111111';

const LEGACY_CARD = {
  id: CHARACTER_ID,
  display_name: '吴云飞',
  nickname: '小云',
  aliases_json: '["云飞"]',
  signature: `签名 ${LONG_TOKEN}`,
  core_persona: `核心人设 ${LONG_TOKEN}`,
  speaking_style: '说话风格',
  relationship_mode: '',
  moment_profile_json: '{"tone":"自然"}',
  group_chat_json: '{"talkativeness":40}',
  opening_messages_json: '["开场白一"]',
  raw_json: `{"weird":{"token":"${LONG_TOKEN}","url":"${SIGNED_URL}"}}`,
  voice_json: '{"provider":"qwen"}',
  avatar_url: '/generated/avatars/x.jpg',
  weibo_nickname: '云飞',
};

const DISPLAY = { supportColors: [], avatarText: null, avatarPattern: 'none', themeColor: null };

function snapshotOf(overrides: Partial<Parameters<typeof buildLegacySnapshot>[0]> = {}) {
  return buildLegacySnapshot({
    characterId: CHARACTER_ID,
    revision: 2,
    source: 'save',
    operatorUserId: '22222222-2222-7222-8222-222222222222',
    note: '保存前留档',
    name: '吴云飞',
    searchText: '吴云飞\n小云\n云飞',
    legacyCard: LEGACY_CARD,
    avatarMediaId: '01a16dd0-04d5-770f-acbb-3c94e4960a61',
    avatarDisplay: DISPLAY,
    lorebook: [
      {
        id: 'lb-1',
        payload: {
          id: 'lb-1',
          title: '世界书名',
          content: `世界书内容 ${LONG_TOKEN}`,
          trigger_keys_json: '["关键词"]',
          source_url: SIGNED_URL,
          unknown_field: { token: LONG_TOKEN },
        },
      },
    ],
    examples: [
      {
        id: 'ex-1',
        sortOrder: 0,
        payload: {
          id: 'ex-1',
          scene: '日常',
          user_text: `你好 ${LONG_TOKEN}`,
          assistant_text: '嗨',
          sort_order: 0,
        },
      },
    ],
    now: new Date('2026-10-25T03:00:00.000Z'),
    ...overrides,
  });
}

const CURRENT: LegacyCurrentState = {
  characterId: CHARACTER_ID,
  revision: 5,
  name: '当前名字',
  searchText: '当前名字',
  legacyCard: { ...LEGACY_CARD, display_name: '当前名字', core_persona: '当前人设' },
  avatarMediaId: null,
  avatarDisplay: DISPLAY,
  lorebook: [{ id: 'lb-9', payload: { id: 'lb-9', content: '当前世界书' } }],
  examples: [{ id: 'ex-9', sortOrder: 0, payload: { id: 'ex-9', user_text: '当前示例' } }],
};

function restoreOf(overrides: Partial<Parameters<typeof planLegacyRestore>[0]> = {}) {
  return planLegacyRestore({
    current: CURRENT,
    expectedRevision: 5,
    target: snapshotOf(),
    operatorUserId: '22222222-2222-7222-8222-222222222222',
    note: '恢复说明',
    now: new Date('2026-10-25T04:00:00.000Z'),
    ...overrides,
  });
}

describe('旧卡完整版本快照（不走审计脱敏）', () => {
  it('长字母数字、签名 URL、未识别旧字段都按原样保存', () => {
    const snapshot = snapshotOf();
    expect(snapshot.legacyCard).toEqual(LEGACY_CARD);
    expect(snapshot.legacyCard.raw_json).toContain(LONG_TOKEN);
    expect(snapshot.legacyCard.raw_json).toContain(SIGNED_URL);
    expect(snapshot.legacyCard.signature).toContain(LONG_TOKEN);
    expect(JSON.stringify(snapshot)).not.toContain('[REDACTED]');
    const lorebook = snapshot.lorebook[0];
    expect(lorebook?.payload.content).toContain(LONG_TOKEN);
    expect(lorebook?.payload.source_url).toBe(SIGNED_URL);
    expect(lorebook?.payload.unknown_field).toEqual({ token: LONG_TOKEN });
    expect(snapshot.examples[0]?.payload.user_text).toContain(LONG_TOKEN);
  });

  it('快照覆盖显示字段、头像、条目原 id，且不含上架状态 / 资格 / 短效图片地址', () => {
    const snapshot = snapshotOf();
    expect(snapshot.name).toBe('吴云飞');
    expect(snapshot.aliases).toEqual(['云飞']);
    expect(snapshot.signature).toContain(LONG_TOKEN);
    expect(snapshot.avatarMediaId).toBe('01a16dd0-04d5-770f-acbb-3c94e4960a61');
    expect(snapshot.avatarDisplay).toEqual(DISPLAY);
    expect(snapshot.lorebook.map((entry) => entry.id)).toEqual(['lb-1']);
    expect(snapshot.examples.map((entry) => entry.id)).toEqual(['ex-1']);
    const keys = Object.keys(snapshot);
    for (const forbidden of ['status', 'basis', 'eligibility', 'classification'])
      expect(keys).not.toContain(forbidden);
    // 头像只存 media id + 展示参数，不存签名 URL。
    expect(JSON.stringify(snapshot.avatarDisplay)).not.toContain('http');
  });

  it('快照是深拷贝，之后改动原对象不影响已存快照', () => {
    const card = structuredClone(LEGACY_CARD);
    const snapshot = snapshotOf({ legacyCard: card });
    card.core_persona = '被改掉的人设';
    expect(snapshot.legacyCard.core_persona).toContain(LONG_TOKEN);
  });
});

describe('旧卡恢复计划', () => {
  it('恢复到旧版本：写新 revision，内容与快照一致（恢复后读回）', () => {
    const plan = restoreOf();
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.revision).toBe(6);
    expect(plan.value.state.legacyCard).toEqual(LEGACY_CARD);
    expect(readLegacyAdminFields(plan.value.state.legacyCard)).toEqual(
      readLegacyAdminFields(LEGACY_CARD),
    );
    expect(plan.value.state.name).toBe('吴云飞');
    expect(plan.value.state.lorebook.map((entry) => entry.id)).toEqual(['lb-1']);
    expect(plan.value.state.examples.map((entry) => entry.id)).toEqual(['ex-1']);
    // 恢复前的那一版另存快照，source = restore。
    expect(plan.value.before.revision).toBe(5);
    expect(plan.value.before.source).toBe('restore');
    expect(plan.value.before.legacyCard).toEqual(CURRENT.legacyCard);
  });

  it('恢复不带上架状态与资格：写回内容只有资料字段', () => {
    const plan = restoreOf();
    if (!plan.ok) throw new Error('应当可以恢复');
    expect(Object.keys(plan.value.state).sort()).toEqual([
      'avatarDisplay',
      'avatarMediaId',
      'examples',
      'legacyCard',
      'lorebook',
      'name',
      'searchText',
    ]);
  });

  it('expectedRevision 不一致返回冲突，带当前版本号', () => {
    const plan = restoreOf({ expectedRevision: 4 });
    expect(plan.ok).toBe(false);
    if (!plan.ok && plan.kind === 'conflict') expect(plan.currentRevision).toBe(5);
    else throw new Error('应当返回 conflict');
  });

  it('属于其他角色的快照版本被拒绝', () => {
    const foreign = snapshotOf({ characterId: '33333333-3333-7333-8333-333333333333' });
    const plan = restoreOf({ target: foreign });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain('不属于当前角色');
  });

  it('只能恢复到更早的版本', () => {
    const same = snapshotOf({ revision: 5 });
    expect(restoreOf({ target: same }).ok).toBe(false);
    const newer = snapshotOf({ revision: 6 });
    expect(restoreOf({ target: newer }).ok).toBe(false);
  });

  it('快照条目 id 重复时拒绝恢复', () => {
    const duplicated: LegacySnapshotData = snapshotOf();
    duplicated.lorebook = [
      { id: 'lb-1', payload: { id: 'lb-1', content: 'a' } },
      { id: 'lb-1', payload: { id: 'lb-1', content: 'b' } },
    ];
    const plan = restoreOf({ target: duplicated });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain('重复');
  });

  it('目标快照不是旧卡内容时拒绝', () => {
    const broken: LegacySnapshotData = snapshotOf();
    broken.legacyCard = {};
    const plan = restoreOf({ target: broken });
    expect(plan.ok).toBe(false);
  });
});

describe('恢复前的跨角色条目保险', () => {
  it('找出当前属于别的角色的世界书 / 示例 id', () => {
    expect(
      foreignEntryIds(
        [
          { id: 'lb-1', characterId: CHARACTER_ID },
          { id: 'lb-2', characterId: '33333333-3333-7333-8333-333333333333' },
        ],
        CHARACTER_ID,
      ),
    ).toEqual(['lb-2']);
    expect(foreignEntryIds([], CHARACTER_ID)).toEqual([]);
  });
});
