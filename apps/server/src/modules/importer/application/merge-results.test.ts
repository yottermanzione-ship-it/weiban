import { describe, expect, it } from 'vitest';
import type { ImportResult } from '@weiban/contracts';
import { mergeResults } from './importer.service.js';

const CHARACTER = '00000000-0000-4000-8000-000000000001';
const supplement = (text: string): Extract<ImportResult, { kind: 'supplement' }> => ({
  kind: 'supplement',
  targetCharacterId: CHARACTER,
  text,
});

describe('分批导入的草稿合并', () => {
  it('下一批补充角色卡时不覆盖用户编辑器已保存的值，包括刻意清空的字段', () => {
    const original: Extract<ImportResult, { kind: 'new_character' }> = {
      kind: 'new_character',
      draft: { cardSchemaVersion: 1, data: {} },
      editorFields: {
        name: '自取名字',
        description: '',
        catchphrases: [],
        speechStyle: '',
        exampleDialogue: '',
        tags: [],
      },
      detectedRealNames: [],
      suggestedClassification: {
        basis: 'original',
        realPersonKind: null,
        ageSetting: 'adult',
        childAppearance: false,
      },
    };
    const incoming = {
      ...original,
      editorFields: { ...original.editorFields!, name: '分析器名字' },
    };
    expect(mergeResults(original, incoming)).toMatchObject({ editorFields: original.editorFields });
  });
  it('保留既有编辑内容，追加下一批并累加过滤结果', () => {
    expect(
      mergeResults(
        { ...supplement('已有内容'), filteredCount: 2 },
        {
          ...supplement('新批次'),
          filteredCount: 3,
        },
      ),
    ).toMatchObject({ text: '已有内容\n新批次', filteredCount: 5 });
  });

  it('追加内容不能突破补充设定的长度上限', () => {
    const merged = mergeResults(supplement('甲'.repeat(4999)), supplement('乙'.repeat(100)));
    expect(merged?.kind === 'supplement' && merged.text.length).toBe(5000);
  });

  it('不同类型的草稿不混合', () => {
    const incoming = {
      kind: 'new_character',
      draft: { cardSchemaVersion: 1, data: {} },
      detectedRealNames: [],
      suggestedClassification: {
        basis: 'original',
        realPersonKind: null,
        ageSetting: 'adult',
        childAppearance: false,
      },
    } satisfies ImportResult;
    expect(mergeResults(supplement('原文'), incoming)).toBeNull();
  });
});
