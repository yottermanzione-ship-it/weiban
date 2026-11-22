import { Form, InputNumber } from 'antd';
import type { AdminModel, PriceUnit, RouteCostRates } from '@weiban/contracts';
import { SERVICE_UNIT_LABELS, type ServiceUnit } from './service-pricing.js';

export type RouteCostDraft = Partial<Record<PriceUnit, number | null>>;

const tokenCosts = {
  input_tokens_per_million: ['输入', 'input'],
  output_tokens_per_million: ['输出', 'output'],
  cached_input_tokens_per_million: ['缓存命中', 'cache'],
  cache_write_5m_tokens_per_million: ['缓存写入 5 分钟', 'cacheWrite5m'],
  cache_write_1h_tokens_per_million: ['缓存写入 1 小时', 'cacheWrite1h'],
} as const;
const tokenUnits = Object.keys(tokenCosts) as Array<keyof typeof tokenCosts>;
const microsPerYuan = 1_000_000;

export function costDraftOf(rates: RouteCostRates | null | undefined): RouteCostDraft {
  return Object.fromEntries(
    Object.entries(rates ?? {}).map(([unit, cost]) => [unit, cost / microsPerYuan]),
  );
}

export function costRatesOf(draft: RouteCostDraft | undefined): RouteCostRates | null {
  const rates = Object.entries(draft ?? {}).filter(([, cost]) => cost != null);
  return rates.length
    ? Object.fromEntries(rates.map(([unit, cost]) => [unit, Math.round(cost! * microsPerYuan)]))
    : null;
}

export function RouteCostFields({
  name,
  model,
  showTokens,
  services,
}: {
  name: number;
  model: AdminModel | null;
  showTokens: boolean;
  services: ServiceUnit[];
}) {
  const fields = [
    ...(showTokens
      ? tokenUnits.map((unit) => ({
          unit,
          label: tokenCosts[unit][0],
          fallback: model?.costRates?.[tokenCosts[unit][1]],
        }))
      : []),
    ...services.map((unit) => ({
      unit,
      label: SERVICE_UNIT_LABELS[unit],
      fallback: model?.serviceRates?.find((rate) => rate.unit === unit)?.cost,
    })),
  ];
  if (!fields.length) return null;
  return (
    <details className="route-cost-fields">
      <summary>线路成本（元）</summary>
      {showTokens && <span className="cell-sub">文字按百万 token</span>}
      <div className="form-three">
        {fields.map(({ unit, label, fallback }) => (
          <Form.Item
            key={unit}
            name={[name, 'costRates', unit]}
            label={label}
            rules={[{ type: 'number', min: 0, max: 100_000, message: '填写 0～100000 元' }]}
          >
            <InputNumber
              min={0}
              max={100_000}
              precision={6}
              step={0.01}
              formatter={(value, { userTyping, input }) => {
                if (userTyping) return input;
                const text = String(value ?? '');
                return text ? String(Number(text)) : '';
              }}
              style={{ width: '100%' }}
              placeholder={fallback == null ? '沿用默认成本' : `默认 ${fallback}`}
            />
          </Form.Item>
        ))}
      </div>
    </details>
  );
}
