import { describe, expect, it } from 'vitest';
import { AdminLegacyCharacterPatch } from '@weiban/contracts';
import {
  legacyPreservedFields,
  planLegacyAdminUpdate,
  prepareExamples,
  prepareLorebook,
  readLegacyAdminFields,
} from './legacy-admin.js';

const RAW = {
  id: '11111111-1111-7111-8111-111111111111',
  display_name: '吴云飞',
  nickname: '小云',
  aliases_json: '["云飞"]',
  signature: '签名原文',
  core_persona: '核心人设原文',
  speaking_style: '说话风格原文',
  relationship_mode: '关系设定原文',
  moment_profile_json: '{"tone":"自然","topics":["日常"]}',
  group_chat_json: '{"talkativeness":40}',
  opening_messages_json: '["开场白一"]',
  raw_json: '{"legacy":true}',
  voice_json: '{"provider":"qwen"}',
  weibo_nickname: '云飞',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function patchOf(value: Record<string, unknown>) {
  return AdminLegacyCharacterPatch.parse({ expectedRevision: 3, ...value });
}

function plan(value: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return planLegacyAdminUpdate({
    raw: RAW,
    currentRevision: 3,
    expectedRevision: 3,
    patch: patchOf(value),
    lorebook: [],
    examples: [],
    avatarMediaId: 'media-old',
    idFactory: () => 'generated-id',
    ...overrides,
  });
}

describe('旧卡详情字段', () => {
  it('按旧字段读取，并把 JSON 文本解析成结构', () => {
    const fields = readLegacyAdminFields(RAW);
    expect(fields.displayName).toBe('吴云飞');
    expect(fields.aliases).toEqual(['云飞']);
    expect(fields.openingMessages).toEqual(['开场白一']);
    expect(fields.momentProfile).toEqual({ tone: '自然', topics: ['日常'] });
    expect(fields.groupChat).toEqual({ talkativeness: 40 });
  });

  it('未识别字段原样保留，且不包含已编辑字段与结构列', () => {
    const preserved = legacyPreservedFields(RAW);
    expect(preserved.raw_json).toBe('{"legacy":true}');
    expect(preserved.voice_json).toBe('{"provider":"qwen"}');
    expect(preserved.weibo_nickname).toBe('云飞');
    expect(preserved.core_persona).toBeUndefined();
    expect(preserved.id).toBeUndefined();
    expect(preserved.created_at).toBeUndefined();
  });
});

describe('微博资料兼容', () => {
  it('已有微博昵称直接标记，不从名字或平台头像猜账号', () => {
    expect(readLegacyAdminFields(RAW).weibo).toEqual({ enabled: true, nickname: '云飞' });
    expect(readLegacyAdminFields({ ...RAW, weibo_nickname: '' }).weibo).toEqual({
      enabled: false,
      nickname: '',
    });
  });
  it('显式关闭优先于原昵称，保存只写新资料块且保留原文', () => {
    const result = plan({ fields: { weibo: { enabled: false, nickname: '云飞' } } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readLegacyAdminFields(result.value.next).weibo?.enabled).toBe(false);
    expect(result.value.next.weibo_nickname).toBe('云飞');
    expect(result.value.next.raw_json).toBe(RAW.raw_json);
    expect(result.value.changedFields).toEqual(['weibo']);
  });
  it('启用需要昵称，来源头像需HTTPS，账号需数字；不要求伪造头像', () => {
    expect(() => patchOf({ fields: { weibo: { enabled: true, nickname: '' } } })).toThrow();
    expect(() =>
      patchOf({
        fields: {
          weibo: { enabled: true, nickname: '云飞', avatarUrl: 'http://example.test/a.png' },
        },
      }),
    ).toThrow();
    expect(() =>
      patchOf({ fields: { weibo: { enabled: true, nickname: '云飞', userId: 'not-id' } } }),
    ).toThrow();
    const result = plan({
      fields: { weibo: { enabled: true, nickname: '云飞', userId: '1234567890' } },
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(readLegacyAdminFields(result.value.next).weibo).toEqual({
        enabled: true,
        nickname: '云飞',
        userId: '1234567890',
      });
  });
});

describe('旧卡局部保存', () => {
  it('只合并提交的字段，未提交字段与未识别字段原样保留', () => {
    const result = plan({ fields: { speakingStyle: '新说话风格' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next.speaking_style).toBe('新说话风格');
    expect(result.value.next.core_persona).toBe('核心人设原文');
    expect(result.value.next.display_name).toBe('吴云飞');
    expect(result.value.next.raw_json).toBe('{"legacy":true}');
    expect(result.value.next.voice_json).toBe('{"provider":"qwen"}');
    expect(result.value.changedFields).toEqual(['speakingStyle']);
    expect(result.value.before).toEqual({ speakingStyle: '说话风格原文' });
    expect(result.value.revision).toBe(4);
    expect(result.value.name).toBe('吴云飞');
  });

  it('区分未提交与明确清空：clear 删除旧键并记下保存前内容', () => {
    const result = plan({ clear: ['nickname'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('nickname' in result.value.next).toBe(false);
    expect(result.value.next.core_persona).toBe('核心人设原文');
    expect(result.value.before).toEqual({ nickname: '小云' });
  });

  it('空串等同清空；核心人设不能清空', () => {
    const cleared = plan({ fields: { signature: '' } });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect('signature' in cleared.value.next).toBe(false);
    const rejected = plan({ fields: { corePersona: '   ' } });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.message).toContain('核心人设');
  });

  it('名字变化时同步更新角色名与搜索文本', () => {
    const result = plan({ fields: { displayName: '云飞' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('云飞');
    expect(result.value.searchText.split('\n')).toContain('云飞');
    expect(result.value.next.display_name).toBe('云飞');
  });

  it('没有任何实际改动时不升版本、不写审计', () => {
    const result = plan({ fields: { displayName: '吴云飞' } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.noop).toBe(true);
      expect(result.value.changedFields).toEqual([]);
    }
  });

  it('expectedRevision 不一致返回冲突，带着当前版本号', () => {
    const result = plan({ fields: { speakingStyle: 'x' } }, { expectedRevision: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'conflict') expect(result.currentRevision).toBe(3);
    else throw new Error('应当返回 conflict');
  });

  it('头像：省略不动，null 恢复默认', () => {
    const kept = plan({ fields: { speakingStyle: '新说话风格' } });
    if (kept.ok) {
      expect(kept.value.avatarMediaId).toBeUndefined();
      expect(kept.value.changedFields).not.toContain('avatar');
    }
    const cleared = plan({ avatarMediaId: null });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.value.avatarMediaId).toBeNull();
      expect(cleared.value.before.avatar).toBe('media-old');
      expect(cleared.value.changedFields).toEqual(['avatar']);
    }
  });
});

describe('世界书条目', () => {
  const existing = [
    {
      id: 'lb-1',
      payload: {
        id: 'lb-1',
        title: '旧标题',
        content: '旧内容',
        priority: 5,
        enabled: true,
        custom_key: 'keep-me',
        trigger_keys_json: '["关键词"]',
      },
    },
  ];

  it('更新是浅合并：未提交的键与未知键保留', () => {
    const result = prepareLorebook(
      existing,
      { upsert: [{ id: 'lb-1', payload: { content: '新内容' } }] },
      () => 'generated-id',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.update).toHaveLength(1);
    expect(result.value.update[0]?.payload).toMatchObject({
      id: 'lb-1',
      title: '旧标题',
      content: '新内容',
      custom_key: 'keep-me',
    });
  });

  it('新增条目生成 id 并写进 payload', () => {
    const result = prepareLorebook(
      existing,
      { upsert: [{ payload: { content: '新增内容' } }] },
      () => 'new-entry',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.create[0]).toEqual({
      id: 'new-entry',
      payload: { content: '新增内容', id: 'new-entry' },
    });
  });

  it('不属于本角色的条目 id 一律拒绝', () => {
    const update = prepareLorebook(
      existing,
      { upsert: [{ id: 'other-char', payload: { content: 'x' } }] },
      () => 'generated-id',
    );
    expect(update.ok).toBe(false);
    if (!update.ok) expect(update.message).toContain('other-char');
    const remove = prepareLorebook(existing, { delete: ['other-char'] }, () => 'id');
    expect(remove.ok).toBe(false);
  });

  it('合并后缺少内容视为非法', () => {
    const result = prepareLorebook(
      [],
      { upsert: [{ payload: { title: '只有标题' } }] },
      () => 'new-entry',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('内容');
  });
});

describe('示例对话条目', () => {
  const existing = [
    {
      id: 'ex-1',
      sortOrder: 0,
      payload: {
        id: 'ex-1',
        scene: '日常',
        user_text: '你好',
        assistant_text: '嗨',
        sort_order: 0,
      },
    },
  ];

  it('更新保留未提交字段；新增排序号接在最后并同步进 payload', () => {
    const result = prepareExamples(
      existing,
      {
        upsert: [
          { id: 'ex-1', payload: { assistant_text: '嗨呀' } },
          { payload: { user_text: '新问题', assistant_text: '新回答' } },
        ],
      },
      () => 'ex-new',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.update[0]?.payload).toMatchObject({
      scene: '日常',
      user_text: '你好',
      assistant_text: '嗨呀',
      sort_order: 0,
    });
    expect(result.value.create[0]).toMatchObject({
      id: 'ex-new',
      sortOrder: 1,
      payload: { id: 'ex-new', user_text: '新问题', sort_order: 1 },
    });
  });

  it('没有一句对话的示例视为非法', () => {
    const result = prepareExamples(
      [],
      { upsert: [{ payload: { scene: '日常' } }] },
      () => 'ex-new',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('至少');
  });

  it('其他角色的示例不能改也不能删', () => {
    expect(prepareExamples(existing, { delete: ['other-char'] }, () => 'id').ok).toBe(false);
  });
});

describe('旧卡保存契约', () => {
  it('同一字段不能既提交新值又清空', () => {
    const result = AdminLegacyCharacterPatch.safeParse({
      expectedRevision: 1,
      fields: { nickname: '新昵称' },
      clear: ['nickname'],
    });
    expect(result.success).toBe(false);
  });

  it('同一条目不能既保存又删除', () => {
    const result = AdminLegacyCharacterPatch.safeParse({
      expectedRevision: 1,
      lorebook: {
        upsert: [{ id: 'lb-1', payload: { content: 'x' } }],
        delete: ['lb-1'],
      },
    });
    expect(result.success).toBe(false);
  });
});
