/*
 * 用量（docs/refactor/06-old-ui-spec.md 6.5）：今天 / 7 天 / 30 天；大数字区；按角色、按用途、按模型；
 * 底部「积分提醒线」。只用接口的 *Points 字段。
 */
import { useState } from 'react';
import { BillingEndpoints, ModelAccessEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterAvatar } from './character-avatar.js';
import { GroupHeader, MenuGroup, MenuRow, NavBar, TextTabs } from './shell-kit.js';
import { FieldPage } from './edit-page.js';
import { showToast } from './toast.js';
import { formatPoints, pointsText } from './points.js';
import { localDay } from './wallet.js';

const categoryNames: Record<string, string> = {
  chat: '聊天',
  background: '后台',
  media: '语音与图片',
  import: '导入角色',
  safety: '安全检查',
  admin: '平台',
  planning: '行为规划',
  unsupported: '其他',
};

type Range = 'today' | '7' | '30';

/**
 * 「按模型」默认先列几项（按消耗从高到低），其余用「展开全部」打开。
 * 不能默默丢掉：只看前几项时各模型加起来会小于总的消耗，看起来像合计对不上。
 */
const MODEL_ROWS_LIMIT = 8;

export function UsagePage() {
  const [range, setRange] = useState<Range>('today');
  const [showAllModels, setShowAllModels] = useState(false);
  const [editing, setEditing] = useState<'threshold' | null>(null);
  const [pending, setPending] = useState(false);
  const from = localDay(range === 'today' ? 0 : Number(range) - 1);
  const to = localDay();
  const byCharacter = useRemote(BillingEndpoints.getUsageSummary, {
    query: { from, to, groupBy: 'character' },
  });
  const byCategory = useRemote(BillingEndpoints.getUsageSummary, {
    query: { from, to, groupBy: 'category' },
  });
  // 按模型：沿用同一个用量接口的 groupBy=model（服务器按扣费流水里的 model 聚合），不新增接口。
  const byModel = useRemote(BillingEndpoints.getUsageSummary, {
    query: { from, to, groupBy: 'model' },
  });
  // 显示名优先取模型目录（GET /model/models 的 displayName）；目录里没有（已下架 / 删除）时原样显示 model 键。
  const catalog = useRemote(ModelAccessEndpoints.listModels);
  const wallet = useRemote(BillingEndpoints.getWallet);
  const characters = byCharacter.data?.rows ?? [];
  const names = useCharacterNames(characters.map((r) => r.key).filter((k) => k && k !== '-'));
  const total = byCategory.data?.totalPoints;
  const calls = (byCategory.data?.rows ?? []).reduce((t, r) => t + r.calls, 0);
  const modelNames = new Map((catalog.data?.items ?? []).map((m) => [m.modelKey, m.displayName]));
  const allModelRows = [...(byModel.data?.rows ?? [])].sort(
    (a, b) =>
      b.amountMicros - a.amountMicros ||
      b.calls - a.calls ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const modelRows = showAllModels ? allModelRows : allModelRows.slice(0, MODEL_ROWS_LIMIT);
  const moreModelRows = allModelRows.length - modelRows.length;
  // 没有模型名的扣费（例如角色申请制作的服务费）没有 model 维度，归到「其他」。
  const modelLabel = (key: string) =>
    key === 'none' || key === '-' ? '其他' : (modelNames.get(key) ?? key);
  async function save(value: string) {
    const points = Number(value);
    if (!Number.isFinite(points) || points < 0) {
      showToast('请输入不小于 0 的数字', 2000, 'warning');
      return;
    }
    setPending(true);
    try {
      await api.call(BillingEndpoints.updateWalletSettings, {
        body: { lowBalanceThresholdPoints: points },
      });
      wallet.refresh();
      setEditing(null);
      showToast('已保存', 2000, 'success');
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="usage-page">
      <NavBar title="用量" fallback="/wallet" />
      <TextTabs<Range>
        items={[
          { value: 'today', label: '今天' },
          { value: '7', label: '7 天' },
          { value: '30', label: '30 天' },
        ]}
        value={range}
        onChange={(value) => {
          setRange(value);
          setShowAllModels(false);
        }}
      />
      <section className="usage-card">
        <p>消耗</p>
        <strong className="tabular">{byCategory.data ? formatPoints(total) : '—'}</strong>
        <p>积分 · 共 {calls} 次调用</p>
      </section>
      {characters.length > 0 && (
        <>
          <GroupHeader>按角色</GroupHeader>
          <MenuGroup>
            {characters.map((row) => (
              <MenuRow
                key={row.key}
                chevron={false}
                label={
                  <>
                    {row.key && row.key !== '-' ? (
                      <CharacterAvatar id={row.key} size={40} radius={4} />
                    ) : null}
                    <span className="row-name">
                      {row.key && row.key !== '-' ? (names[row.key] ?? '角色') : '平台'}
                    </span>
                  </>
                }
                value={pointsText(row.points)}
              />
            ))}
          </MenuGroup>
        </>
      )}
      {(byCategory.data?.rows.length ?? 0) > 0 && (
        <>
          <GroupHeader>按用途</GroupHeader>
          <MenuGroup>
            {byCategory.data!.rows.map((row) => (
              <MenuRow
                key={row.key}
                chevron={false}
                label={categoryNames[row.key] ?? row.key}
                subtitle={`${row.calls} 次`}
                value={pointsText(row.points)}
              />
            ))}
          </MenuGroup>
        </>
      )}
      {modelRows.length > 0 && (
        <>
          <GroupHeader>按模型</GroupHeader>
          <MenuGroup>
            {modelRows.map((row) => (
              <MenuRow
                key={row.key}
                chevron={false}
                label={modelLabel(row.key)}
                subtitle={`${row.calls} 次`}
                value={pointsText(row.points)}
              />
            ))}
            {(moreModelRows > 0 || showAllModels) && (
              <MenuRow
                label={showAllModels ? '收起' : `展开全部（共 ${allModelRows.length} 个模型）`}
                onClick={() => setShowAllModels((open) => !open)}
              />
            )}
          </MenuGroup>
        </>
      )}
      {byCategory.data && byCategory.data.rows.length === 0 && (
        <p className="empty">这段时间还没有消耗</p>
      )}
      <GroupHeader>积分提醒</GroupHeader>
      <MenuGroup>
        <MenuRow
          label="积分提醒线"
          value={wallet.data ? pointsText(wallet.data.lowBalanceThresholdPoints) : '—'}
          onClick={() => setEditing('threshold')}
        />
      </MenuGroup>
      {(byCategory.error || byCharacter.error || byModel.error) && (
        <p role="alert" className="notice-bar">
          {byCategory.error || byCharacter.error || byModel.error}
        </p>
      )}
      {editing && wallet.data && (
        <FieldPage
          title="积分提醒线"
          hint="积分低于这个数时提醒你"
          inputMode="numeric"
          initial={String(wallet.data.lowBalanceThresholdPoints ?? '')}
          maxLength={10}
          required
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={(value) => void save(value)}
        />
      )}
    </main>
  );
}
