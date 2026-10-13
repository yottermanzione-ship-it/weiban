import { useState } from 'react';
import { ModelAccessEndpoints, type ModelInfo } from '@weiban/contracts';
import { MenuGroup, MenuRow, NavBar, TextTabs } from './shell-kit.js';
import { showToast } from './toast.js';
import { perReplyText } from './wallet.js';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';

const tierLabels = { cheap: '便宜', medium: '中等', expensive: '较贵' } as const;

type FilterKey = 'all' | 'chinese' | 'value' | 'adult';
const filterOptions: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'chinese', label: '中文角色扮演' },
  { key: 'value', label: '性价比' },
  { key: 'adult', label: '允许成人内容' },
];

export function LeaderboardPage() {
  const models = useRemote(ModelAccessEndpoints.listModels, {});
  const [filter, setFilter] = useState<FilterKey>('all');
  const [pending, setPending] = useState(false);

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
      showToast('已设为聊天模型。没有单独设置模型的角色，说话风格可能有变化', 3000, 'success');
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }

  const listed = applyFilter(models.data?.items ?? []);

  return (
    <main>
      <NavBar title="模型排行榜" fallback="/services" />
      <TextTabs<FilterKey>
        items={filterOptions.map((o) => ({ value: o.key, label: o.label }))}
        value={filter}
        onChange={setFilter}
      />
      {models.error && <p role="alert">{models.error}</p>}
      <MenuGroup className="leaderboard-old">
        {listed.map((model) => {
          const rank = model.leaderboardRank;
          return (
            <MenuRow
              key={model.modelKey}
              chevron={false}
              label={
                <>
                  <span className={`rank-no rank-${rank ?? 0}`}>{rank ?? '—'}</span>
                  <span className="row-name">{model.displayName}</span>
                </>
              }
              subtitle={[
                model.vendorName,
                tierLabels[model.priceTier],
                perReplyText(model),
                ...model.tags,
              ]
                .filter(Boolean)
                .join(' · ')}
              right={
                <button
                  type="button"
                  className="inline-use"
                  disabled={pending || !model.available}
                  onClick={(event) => {
                    event.stopPropagation();
                    void applyModel(model.modelKey);
                  }}
                >
                  {model.available ? '用这个' : '暂不可用'}
                </button>
              }
            />
          );
        })}
      </MenuGroup>
      {!models.loading && listed.length === 0 && <p className="empty">没有符合条件的模型</p>}
      <p className="hint page-note">数据来源：微伴自测评测集（进行中，暂参考外部榜单）</p>
    </main>
  );
}
