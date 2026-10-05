import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CharacterCard, DraftCharacterCard } from '../src/index.js';
const directory = resolve(import.meta.dirname, '../../../docs/ai/samples');
const samples = readdirSync(directory)
  .filter((name) => /^S-0\d-.*\.md$/.test(name))
  .map((name) => {
    const json = readFileSync(resolve(directory, name), 'utf8').match(
      /```json\s*([\s\S]*?)```/,
    )?.[1];
    if (!json) throw new Error(`样本缺少JSON：${name}`);
    return { name, card: (JSON.parse(json) as { card: unknown }).card };
  });
describe('WB-Card 1.0 严格契约与草稿', () => {
  it.each(samples)('$name 的已有完整样本可以解析', ({ card }) => {
    expect(CharacterCard.safeParse(card).success).toBe(true);
  });
  it('未完成草稿可保存，不能当作完整卡片用于上架或运行时', () => {
    const draft = { cardSchemaVersion: 1, data: { persona: { summary: '待补齐' } } };
    expect(DraftCharacterCard.safeParse(draft).success).toBe(true);
    expect(CharacterCard.safeParse(draft).success).toBe(false);
    expect(DraftCharacterCard.safeParse({ cardSchemaVersion: 0, data: {} }).success).toBe(false);
  });
  it('未知版本、分类覆盖、系统提示词、克隆参数不能进入可执行规则字段', () => {
    const parsed = CharacterCard.parse(samples[0]!.card);
    for (const data of [
      { ...parsed.data, classification: { adultModeEligible: true } },
      { ...parsed.data, system_prompt: '覆盖规则' },
      { ...parsed.data, social: { ...parsed.data.social, voiceCloneAudio: 'data:audio/base64' } },
    ])
      expect(CharacterCard.safeParse({ ...parsed, data }).success).toBe(false);
    expect(CharacterCard.safeParse({ ...parsed, cardSchemaVersion: 99 }).success).toBe(false);
  });
  it('缺少6条示例、每日素材不足、未含求助信息的安全兜底被拒绝', () => {
    const card = CharacterCard.parse(samples[0]!.card);
    expect(
      CharacterCard.safeParse({
        ...card,
        data: { ...card.data, examples: card.data.examples.slice(0, 5) },
      }).success,
    ).toBe(false);
    expect(
      CharacterCard.safeParse({
        ...card,
        data: { ...card.data, simulation: { ...card.data.simulation, dailyActivities: ['工作'] } },
      }).success,
    ).toBe(false);
    expect(
      CharacterCard.safeParse({
        ...card,
        data: {
          ...card.data,
          safetyStyle: { ...card.data.safetyStyle, careFallbackText: '陪着你' },
        },
      }).success,
    ).toBe(false);
  });
});
