/**
 * 热门榜顺序（契约 5.1 `ModelLeaderboardInfo.hotOrder`，总经理 11-03）：
 * 1. 第一位必须是 DeepSeek 模型；有多个时取利润率最高的那个放第一，其余照常参与排序；
 * 2. 其余按利润率从高到低；缺价的排最后；利润率相同时保持传入顺序（目录排序）。
 *
 * 利润率 = 1 −（文字输入成本 + 文字输出成本）÷（文字输入售价 + 文字输出售价），取当前生效价目表的全天价。
 * 成本价是后台内部数据：这里只产出模型键顺序，调用方不得把利润率或成本随响应下发。
 */
export interface HotOrderTextPrices {
  inputPerMillionMicros: number;
  outputPerMillionMicros: number;
}

export interface HotOrderEntry {
  modelKey: string;
  vendorName: string;
  /** 当前生效价目表的文字输入 / 输出全天价；没有价格时为 undefined。 */
  rates?: { price: HotOrderTextPrices; cost: HotOrderTextPrices };
}

const DEEPSEEK = /deepseek|深度求索/i;

export function isDeepSeekModel(entry: Pick<HotOrderEntry, 'modelKey' | 'vendorName'>): boolean {
  return DEEPSEEK.test(entry.modelKey) || DEEPSEEK.test(entry.vendorName);
}

/** 利润率；缺价（没有价格，或售价合计不是正数）时为 null。 */
export function profitMargin(rates: HotOrderEntry['rates']): number | null {
  if (!rates) return null;
  const sale = rates.price.inputPerMillionMicros + rates.price.outputPerMillionMicros;
  const cost = rates.cost.inputPerMillionMicros + rates.cost.outputPerMillionMicros;
  if (!Number.isFinite(sale) || !Number.isFinite(cost) || sale <= 0) return null;
  return 1 - cost / sale;
}

/** 有价的在前（利润率高的在前），缺价的在后；同档保持传入顺序。 */
function byMargin(
  a: { margin: number | null; index: number },
  b: { margin: number | null; index: number },
) {
  if ((a.margin === null) !== (b.margin === null)) return a.margin === null ? 1 : -1;
  if (a.margin !== null && b.margin !== null && a.margin !== b.margin) return b.margin - a.margin;
  return a.index - b.index;
}

export function hotModelOrder(entries: readonly HotOrderEntry[]): string[] {
  const scored = entries.map((entry, index) => ({
    entry,
    index,
    margin: profitMargin(entry.rates),
  }));
  const sorted = [...scored].sort(byMargin);
  // 第一位必须是 DeepSeek：排好序后第一个出现的 DeepSeek 就是利润率最高的那个（都缺价时取目录里靠前的）。
  const lead = sorted.find((item) => isDeepSeekModel(item.entry));
  const ordered = lead ? [lead, ...sorted.filter((item) => item !== lead)] : sorted;
  return ordered.map((item) => item.entry.modelKey);
}
