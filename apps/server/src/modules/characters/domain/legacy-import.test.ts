import { describe, expect, it } from 'vitest';
import {
  buildLegacyImportPlan,
  legacyImportReport,
  type LegacyImportExisting,
} from './legacy-import.js';

const c1 = '11111111-1111-4111-8111-111111111111';
const c3 = '33333333-3333-4333-8333-333333333333';
const c4 = '44444444-4444-4444-8444-444444444444';
const c6 = '66666666-6666-4666-8666-666666666666';
const orphan = '99999999-9999-4999-8999-999999999999';

const character = (id: string, displayName: string, extra: Record<string, unknown> = {}) => ({
  id,
  display_name: displayName,
  core_persona: `${displayName}的核心人设`,
  speaking_style: '短句',
  opening_messages_json: ['你好'],
  ...extra,
});

const input = {
  characters: [
    character(c1, '程澈'),
    character(c1, '程澈（重复行）'),
    { id: c3, opening_messages_json: '[]', core_persona: '' },
    character(c4, '长签名角色', { signature: '很长的签名'.repeat(20) }),
    { id: 'not-a-uuid', display_name: '坏 id' },
    character(c6, '已存在角色'),
  ],
  lorebook: [
    { id: 'l1', character_id: c1, trigger_keys_json: '["灯塔"]', content: '灯塔项目。' },
    { id: 'l1', character_id: c1, trigger_keys_json: '["灯塔"]', content: '重复。' },
    { id: 'l3', character_id: orphan, trigger_keys_json: '["孤儿"]', content: '孤儿条目。' },
    { id: 'l4', character_id: c1, trigger_keys_json: '["空"]', content: '' },
    { id: 'l5', character_id: c1, trigger_keys_json: '["长"]', content: '长'.repeat(5000) },
  ],
  examples: [
    { id: 'e1', character_id: c1, user_text: '在吗', assistant_text: '嗯。', sort_order: 1 },
    { id: 'e1', character_id: c1, user_text: '重复', assistant_text: '重复', sort_order: 2 },
    { id: 'e3', character_id: orphan, user_text: '孤儿', assistant_text: '孤儿' },
    { id: 'e4', character_id: c1, user_text: '长'.repeat(5000), assistant_text: '回复' },
    { id: 'e5', character_id: c1, user_text: '', assistant_text: '' },
    { id: 'e-existing', character_id: c1, user_text: '已有', assistant_text: '已有' },
  ],
};

const existing: LegacyImportExisting = {
  characterIds: new Set([c6]),
  lorebookIds: new Set(),
  exampleIds: new Set(['e-existing']),
};

describe('旧卡导入 dry-run 计划', () => {
  it('按旧 id 去重、跳过已存在、报告缺失与超长', () => {
    const plan = buildLegacyImportPlan(input, existing);
    expect(plan.characters.toCreate.map((row) => row.id)).toEqual([c1, c3, c4]);
    expect(plan.characters.alreadyExists).toEqual([c6]);
    expect(plan.characters.duplicates).toEqual([c1]);
    expect(plan.characters.invalid.map((row) => row.reason)).toEqual(['invalid_uuid']);
    // c3 缺 display_name / core_persona / opening_messages，c4 缺 opening_messages。
    expect(plan.characters.missing.some((row) => row.field === 'display_name')).toBe(true);
    expect(plan.characters.missing.some((row) => row.field === 'core_persona')).toBe(true);
    expect(plan.characters.overlong).toContainEqual(
      expect.objectContaining({ id: c4, field: 'signature', reason: 'overlong' }),
    );
    // 分类默认按旧字段：没有 identity_type 时按真人公众人物（宁可多审）。
    expect(plan.characters.toCreate[0]?.classification).toMatchObject({
      basis: 'real_person',
      realPersonKind: 'celebrity',
      ageSetting: 'adult',
    });
    expect(plan.characters.toCreate[0]?.categoryId).toBe('celebrity');
    // 名字直接进新库 name，旧卡整行原样保留。
    expect(plan.characters.toCreate[0]?.name).toBe('程澈');
    expect(plan.characters.toCreate[0]?.row.display_name).toBe('程澈');
  });

  it('世界书 / 示例：已存在、重复、孤儿、缺失、超长分别计数', () => {
    const plan = buildLegacyImportPlan(input, existing);
    expect(plan.lorebook.toCreate.map((row) => row.id)).toEqual(['l1', 'l5']);
    expect(plan.lorebook.duplicates).toEqual(['l1']);
    expect(plan.lorebook.orphan.map((row) => row.id)).toEqual(['l3']);
    expect(plan.lorebook.missing.map((row) => row.id)).toEqual(['l4']);
    expect(plan.lorebook.overlong.map((row) => row.field)).toContain('content');
    expect(plan.examples.toCreate.map((row) => row.id)).toEqual(['e1', 'e4']);
    expect(plan.examples.duplicates).toEqual(['e1']);
    expect(plan.examples.orphan.map((row) => row.id)).toEqual(['e3']);
    expect(plan.examples.missing.map((row) => row.id)).toEqual(['e5']);
    expect(plan.examples.overlong.map((row) => row.field)).toContain('user_text');
    expect(plan.examples.alreadyExists).toEqual(['e-existing']);
  });

  it('报告计数与计划一致，且不包含整行原文', () => {
    const report = legacyImportReport(buildLegacyImportPlan(input, existing));
    expect(report.characters.total).toBe(6);
    expect(report.characters.toCreate).toBe(3);
    expect(report.characters.alreadyExists).toBe(1);
    expect(report.characters.duplicateCount).toBe(1);
    expect(report.characters.invalidCount).toBe(1);
    expect(report.lorebook.total).toBe(5);
    expect(report.lorebook.toCreate).toBe(2);
    expect(report.lorebook.orphan).toBe(1);
    expect(report.examples.toCreate).toBe(2);
    expect(report.examples.overlongFields).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain('核心人设');
  });
});
