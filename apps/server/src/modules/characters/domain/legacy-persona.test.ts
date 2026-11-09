import { describe, expect, it } from 'vitest';
import {
  applyPersonaMergePatch,
  assertSafePersonaJson,
  editablePersonaDocument,
  materializePersonaCard,
  personaPatchReason,
  personaChildFeatures,
  projectPersonalPersona,
  targetPersonaPackage,
} from './legacy-persona.js';

describe('旧专属人设结构兼容', () => {
  it('旧基础卡的声音授权布尔标记保留，不能借同名字段夹带凭据或修改声音权限', () => {
    expect(() =>
      assertSafePersonaJson({
        soulspec: { voice: { requires_authorization: true } },
        voice_requires_authorization: 1,
      }),
    ).not.toThrow();
    for (const value of [
      { requires_authorization: 'synthetic-token' },
      { voice_requires_authorization: '1' },
      { authorization: 'synthetic-token' },
      { access_token: 'synthetic-token' },
    ])
      expect(() => assertSafePersonaJson(value)).toThrow('LEGACY_PERSONA_UNSAFE_FIELD');
    expect(
      personaPatchReason({
        raw_persona: { soulspec: { voice: { requires_authorization: false } } },
      }),
    ).toBe('restricted_identity_change');
  });
  it('结构数值及中英文儿童线索只收紧，空年龄不冒充0岁', () => {
    expect(personaChildFeatures({ age: null, other: { age: '' } })).toBe(false);
    expect(personaChildFeatures({ age: false })).toBe(false);
    expect(personaChildFeatures({ family: { name: 'Synthetic relative', age: 16 } })).toBe(false);
    expect(personaChildFeatures({ age: 0 })).toBe(true);
    expect(personaChildFeatures({ age: 16 })).toBe(true);
    expect(personaChildFeatures({ description: 'Synthetic 16-year-old student' })).toBe(true);
    expect(personaChildFeatures({ description: '合成角色13岁' })).toBe(true);
    expect(personaChildFeatures({ description: 'Synthetic 116-year-old character' })).toBe(false);
  });
  it('原merge-patch语义：对象递归、数组整体替换、null删除、空串保留', () => {
    expect(
      applyPersonaMergePatch(
        { x: { a: 1, b: 2 }, arr: [1, 2], text: 'before' },
        { x: { a: null, c: 3 }, arr: [], text: '' },
      ),
    ).toEqual({ x: { b: 2, c: 3 }, arr: [], text: '' });
  });
  it('editableDocument遵守raw优先、镜像补齐，物化显式清空不得恢复公共词条', () => {
    const card = {
      raw_persona: { soulspec: { personality_core: 'raw' } },
      soulspec: { personality_core: 'mirror' },
      lorebook: [{ keys: ['key'], content: 'public' }],
      example_dialogues: ['old'],
      core_persona: 'base',
    };
    expect(editablePersonaDocument(card).raw_persona.soulspec).toEqual({ personality_core: 'raw' });
    const next = materializePersonaCard(card, {
      raw_persona: { lorebook: [], examples: null },
      legacy_fields: { core_persona: '' },
    });
    expect(next.lorebook).toEqual([]);
    expect(next).not.toHaveProperty('example_dialogues');
    expect(next.core_persona).toBe('');
    expect(card.core_persona).toBe('base');
  });
  it('公共新版未被用户修改的字段原样保留，个人选择字段通过结构投影生效', () => {
    const row = {
      id: 'old-role',
      core_persona: 'NEW_PUBLIC_CORE',
      speaking_style: 'NEW_PUBLIC_SPEECH',
      raw_json: { soulspec: { personality_core: 'current', values: 'new values' } },
      soul_personality: 'new public personality',
    };
    const result = projectPersonalPersona(
      row,
      targetPersonaPackage(row, [], []),
      { raw_persona: { soulspec: { personality_core: 'PRIVATE_CHOICE' } } },
      'synthetic',
    );
    expect(result.legacyCard.core_persona).toBe('NEW_PUBLIC_CORE');
    expect(result.legacyCard.speaking_style).toBe('NEW_PUBLIC_SPEECH');
    expect(result.legacyCard.soul_personality).toContain('PRIVATE_CHOICE');
    expect(result.effectiveDocument.raw_persona.soulspec).toEqual({
      personality_core: 'PRIVATE_CHOICE',
      values: 'new values',
    });
    expect(JSON.stringify(result)).not.toContain('[object Object]');
  });
  it('个人词条、示例完整承接且ID稳定，字符串词条也能进入运行时', () => {
    const row = { id: 'old-role', core_persona: 'public' };
    const patch = {
      raw_persona: {
        lorebook: [
          'always',
          { key: 'trigger', content: 'owned', enabled: true },
          { content: 'off', enabled: false },
        ],
        examples: [{ user: 'hello', assistant: 'private response', scene: 'greet' }],
      },
    };
    const first = projectPersonalPersona(
      row,
      targetPersonaPackage(row, [], []),
      patch,
      'synthetic',
    );
    const second = projectPersonalPersona(
      row,
      targetPersonaPackage(row, [], []),
      patch,
      'synthetic',
    );
    expect(first.context).toEqual(second.context);
    expect(first.context.lorebook).toHaveLength(2);
    expect(first.context.lorebook[0]!.constant).toBe(true);
    expect(first.context.examples[0]!.assistantText).toBe('private response');
    expect(
      first.sections.find((section) => section.key === 'examples')!.fields[0]!.value,
    ).toContain('角色：private response');
  });
  it('不支持的来源/控制字段不冒充已生效；危险键和过深结构拒绝', () => {
    expect(personaPatchReason({ raw_persona: { unknown_field: 'opaque' } })).toBe(
      'unsupported_structure',
    );
    expect(personaPatchReason({ raw_persona: { character: { name: 'different identity' } } })).toBe(
      'restricted_identity_change',
    );
    expect(
      personaPatchReason({ raw_persona: { soulspec: { voice: { provider: 'override' } } } }),
    ).toBe('restricted_identity_change');
    expect(() => assertSafePersonaJson(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow(
      'UNSAFE_FIELD',
    );
    let deep: unknown = 'leaf';
    for (let i = 0; i < 34; i++) deep = { item: deep };
    expect(() => assertSafePersonaJson(deep)).toThrow('STRUCTURE_LIMIT');
  });
  it('错误附件结构不能静默变成空文字或假成功', () => {
    const row = { id: 'old-role' };
    expect(() =>
      projectPersonalPersona(
        row,
        targetPersonaPackage(row, [], []),
        { raw_persona: { lorebook: [{ content: { bad: 'object' } }] } },
        'synthetic',
      ),
    ).toThrow('LOREBOOK_INVALID');
  });
  it('结构字段明确删除会清对应运行列，不把旧性格连同清除标签一起发送', () => {
    const row = {
      id: 'old-role',
      soul_personality: 'STALE_FLAT_TRAIT',
      raw_json: { soulspec: { personality_core: 'old trait' } },
    };
    const result = projectPersonalPersona(
      row,
      targetPersonaPackage(row, [], []),
      { raw_persona: { soulspec: { personality_core: null } } },
      'synthetic',
    );
    expect(result.legacyCard.soul_personality).toBe('');
    expect(JSON.stringify(result.legacyCard)).not.toContain('STALE_FLAT_TRAIT');
  });
  it('未映射的SoulSpec字段与年龄/身份放宽请求保留待核，不能假装生效', () => {
    expect(personaPatchReason({ raw_persona: { soulspec: { unknown: 'opaque' } } })).toBe(
      'unsupported_structure',
    );
    expect(personaPatchReason({ raw_persona: { character: { age: 18 } } })).toBe(
      'restricted_identity_change',
    );
  });
  it('身份保护只限主角色字段，支持的性格/词条/示例中其他人的name和age不被误拒绝', () => {
    const patch = {
      raw_persona: {
        soulspec: { personality_core: { family: { name: 'Synthetic relative', age: 20 } } },
        lorebook: [{ name: 'Synthetic entry', age: 16, key: 'trigger', content: 'Synthetic note' }],
        examples: [{ name: 'Synthetic example', age: 15, user: 'hello', assistant: 'reply' }],
      },
    };
    expect(personaPatchReason(patch)).toBeNull();
    expect(personaPatchReason({ raw_persona: { character: { name: 'another identity' } } })).toBe(
      'restricted_identity_change',
    );
    expect(personaPatchReason({ raw_persona: { soulspec: { identity: { age: 18 } } } })).toBe(
      'restricted_identity_change',
    );
    expect(personaPatchReason({ raw_persona: { soulspec: { identity: null } } })).toBe(
      'restricted_identity_change',
    );
    expect(
      personaPatchReason({ raw_persona: { soulspec: { identity: { adultModeEligible: true } } } }),
    ).toBe('unsupported_structure');
    expect(
      personaPatchReason({
        raw_persona: { soulspec: { boundary: { must_not_claim_real_person: false } } },
      }),
    ).toBe('restricted_identity_change');
  });
});
