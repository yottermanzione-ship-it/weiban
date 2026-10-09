import { useState } from 'react';
import { BillingEndpoints, ModelAccessEndpoints, type ModelInfo } from '@weiban/contracts';
import { formatMoney } from '@weiban/client-core';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';

const tierLabels = { cheap: '便宜', medium: '中等', expensive: '较贵' } as const;

function estimateCostPerReply(model: ModelInfo, priceMap: Map<string, number>): string {
  // 500 output tokens + 300 input tokens as rough estimate per reply
  const outKey = `${model.modelKey}:output_tokens_per_million`;
  const inKey = `${model.modelKey}:input_tokens_per_million`;
  const outPrice = priceMap.get(outKey) ?? 0;
  const inPrice = priceMap.get(inKey) ?? 0;
  const micros = Math.round((outPrice * 500 + inPrice * 300) / 1_000_000);
  if (micros <= 0) return '—';
  return formatMoney(micros);
}

type FilterKey = 'all' | 'chinese' | 'value' | 'adult';
const filterOptions: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'chinese', label: '中文角色扮演' },
  { key: 'value', label: '性价比' },
  { key: 'adult', label: '允许成人内容' },
];

export function LeaderboardPage() {
  const models = useRemote(ModelAccessEndpoints.listModels, {});
  const prices = useRemote(BillingEndpoints.getPrices);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [toast, setToast] = useState('');
  const [pending, setPending] = useState(false);

  const priceMap = new Map<string, number>();
  prices.data?.items.forEach((item) => {
    if (!item.band) priceMap.set(`${item.modelKey}:${item.unit}`, item.priceMicros);
  });

  function applyFilter(items: ModelInfo[]): ModelInfo[] {
    const sorted = [...items].sort(
      (a, b) => (a.leaderboardRank ?? 999) - (b.leaderboardRank ?? 999),
    );
    if (filter === 'all') return sorted;
    if (filter === 'adult') return sorted.filter((m) => m.capabilities.includes('adult_content'));
    if (filter === 'chinese') return sorted.filter((m) => m.tags.some((t) => t.includes('中文')));
    if (filter === 'value') return sorted.filter((m) => m.priceTier === 'cheap');
    return sorted;
  }

  async function applyModel(modelKey: string) {
    setPending(true);
    try {
      await api.call(ModelAccessEndpoints.updateSelection, { body: { chat: { modelKey } } });
      setToast('已设为聊天模型。没有单独设置模型的角色，说话风格可能有变化');
      setTimeout(() => setToast(''), 4000);
    } catch (e) {
      setToast(friendlyError(e));
      setTimeout(() => setToast(''), 4000);
    } finally {
      setPending(false);
    }
  }

  const listed = applyFilter(models.data?.items ?? []);

  return (
    <main>
      <h1 className="page-title">模型排行榜</h1>
      <div className="filter-row" role="group" aria-label="筛选">
        {filterOptions.map(({ key, label }) => (
          <button
            key={key}
            className={`filter-btn${filter === key ? ' active' : ''}`}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {(models.error || prices.error) && <p role="alert">{models.error || prices.error}</p>}
      <div className="panel rows leaderboard-list">
        {listed.map((model) => (
          <div key={model.modelKey} className="leaderboard-row">
            <div className="leaderboard-rank">
              {model.leaderboardRank != null ? `#${model.leaderboardRank}` : '—'}
            </div>
            <div className="leaderboard-info">
              <strong>{model.displayName}</strong>
              <p>{model.vendorName}</p>
              <p className="tag-row">
                <span className="badge">{tierLabels[model.priceTier]}</span>
                {model.tags.map((tag) => (
                  <span key={tag} className="badge muted">
                    {tag}
                  </span>
                ))}
              </p>
              <p className="hint">大约每条回复 {estimateCostPerReply(model, priceMap)}</p>
            </div>
            <button
              className="use-btn"
              disabled={pending || !model.available}
              onClick={() => void applyModel(model.modelKey)}
            >
              {model.available ? '用这个' : '暂不可用'}
            </button>
          </div>
        ))}
        {!models.loading && listed.length === 0 && <p className="empty">没有符合条件的模型</p>}
      </div>
      {prices.data && (
        <p className="hint page-foot">
          数据来源：微伴自测评测集（进行中，暂参考外部榜单）· 更新于{' '}
          {new Date(prices.data.effectiveFrom).toLocaleDateString('zh-CN')}
        </p>
      )}
      {toast && (
        <div role="status" className="toast">
          {toast}
        </div>
      )}
    </main>
  );
}
