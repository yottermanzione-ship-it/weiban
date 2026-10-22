import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { BillingReadPort, ModelGatewayPort, ModelQuotePort } from '@weiban/contracts';
import { CardLineService } from './moment-cards.js';
import { ImportAiService } from './import-ai.js';
import { PersonaUpdateSummaryService } from './supplement-ai.js';
import { planningCostLimitReached } from './planner.js';

describe('契约 3.1 的 AI 接入', () => {
  it('规划费用按聊天实付额的比例停用，没有聊天花费时使用免费规则', () => {
    expect(planningCostLimitReached(0, 0)).toBe(true);
    expect(planningCostLimitReached(100000, 9999)).toBe(false);
    expect(planningCostLimitReached(100000, 10000)).toBe(true);
    expect(planningCostLimitReached(1000000, 30000)).toBe(false);
  });
  it('余额耗尽时不调用卡片文案模型或读取角色资料', async () => {
    const generateText = vi.fn();
    const billing = {
      getSpendStatus: vi.fn().mockResolvedValue({
        depleted: true,
        availableMicros: 0,
      }),
    } as unknown as BillingReadPort;
    const args = [{ generateText }, {}, {}, billing] as unknown as ConstructorParameters<
      typeof CardLineService
    >;
    const service = new CardLineService(...args);
    expect(
      await service.writeCardCopy({
        userId: 'u',
        characterId: 'c',
        kind: 'anniversary',
        templateTitle: '纪念日',
        templateLine: '模板文案',
        facts: {},
        idempotencyKey: 'card:1',
      }),
    ).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  it('导入估价由模型报价汇总，截图采用识图模型报价', async () => {
    const quote = vi.fn<ModelQuotePort['quote']>().mockResolvedValue({
      ok: true,
      value: { modelKey: 'selected', amountMicros: 1234, priceVersionId: 'v' },
    });
    const args = [{}, {}, {}, {}, { quote }] as unknown as ConstructorParameters<
      typeof ImportAiService
    >;
    const service = new ImportAiService(...args);
    expect(await service.estimate({ userId: 'u', charCount: 24000, screenshotCount: 1 })).toBe(
      4936,
    );
    expect(quote.mock.calls.map(([request]) => request.purpose)).toEqual([
      'import_analysis',
      'import_analysis',
      'import_analysis',
      'vision',
    ]);
  });

  it('不能报价时不展示固定系数伪造的费用', async () => {
    const quote = vi.fn().mockResolvedValue({ ok: false, error: 'price_missing' });
    const args = [{}, {}, {}, {}, { quote }] as unknown as ConstructorParameters<
      typeof ImportAiService
    >;
    await expect(
      new ImportAiService(...args).estimate({ userId: 'u', charCount: 1, screenshotCount: 0 }),
    ).rejects.toThrow('当前模型不能报价');
  });

  it('人设摘要生成失败返回空值，由发布方选择管理员摘要或模板', async () => {
    const gateway = {
      generateText: vi.fn().mockResolvedValue({ ok: false, error: 'provider_unavailable' }),
    } as unknown as ModelGatewayPort;
    const service = new PersonaUpdateSummaryService(gateway);
    const card = {
      data: {
        profileExtra: { occupation: '', worksDetail: [] },
        knowledge: { entries: [] },
        speech: {},
        persona: {},
      },
    } as unknown as Parameters<typeof service.summarize>[0]['after'];
    expect(
      await service.summarize({
        adminId: 'u',
        characterId: 'c',
        before: card,
        after: card,
        version: 2,
      }),
    ).toBeNull();
  });
});
