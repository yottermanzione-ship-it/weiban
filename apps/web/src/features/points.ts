/*
 * 积分显示（docs/refactor/06-old-ui-spec.md 6.1）：1 元 = 100 积分；界面只用接口下发的 *Points 字段，不自己换算。
 * 最多 2 位小数并去掉末尾 0；整数部分 ≥ 1,000 加千位逗号；0 < |n| < 0.01 显示「< 0.01」。
 * 消耗写「−0.89」（全角减号），增加写「+1,000」。
 */
const formatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatPoints(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.01) return value < 0 ? '−< 0.01' : '< 0.01';
  const text = formatter.format(abs);
  return value < 0 ? `−${text}` : text;
}

/** 带正负号：增加「+1,000」，消耗「−0.89」。 */
export function signedPoints(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (value > 0) return `+${formatPoints(value)}`;
  return formatPoints(value);
}

/** 带单位：「1,234 积分」。 */
export function pointsText(value: number | null | undefined): string {
  return `${formatPoints(value)} 积分`;
}

/** 元价（档位价格）：priceMicros ÷ 1,000,000，最多 2 位小数。 */
export function yuanText(micros: number): string {
  return `¥${formatter.format(micros / 1_000_000)}`;
}

/** 管理后台用：微元 → 元，保留 4 位小数（上游成本）。 */
export function yuanPrecise(micros: number, digits = 4): string {
  return `¥${(micros / 1_000_000).toFixed(digits)}`;
}

/** 3.17：模型的积分消耗倍率（只展示，扣费按实际用量）。 */
export function multiplierText(model: { displayMultiplier?: number | null }) {
  const m = model.displayMultiplier;
  if (m == null) return '';
  return `×${m >= 10 ? m.toFixed(0) : m >= 1 ? m.toFixed(1) : m.toFixed(2)}`;
}
