/*
 * 用量（docs/refactor/06-old-ui-spec.md 6.5）：今天 / 7 天 / 30 天；大数字区；按角色、按用途；
 * 底部「积分提醒线」。只用接口的 *Points 字段。
 */
import { useState } from 'react';
import { BillingEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterAvatar } from './character-avatar.js';
import { GroupHeader, MenuGroup, MenuRow, NavBar, TextTabs } from './shell-kit.js';
import { FieldSheet } from './chat-settings.js';
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

export function UsagePage() {
  const [range, setRange] = useState<Range>('today');
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
  const wallet = useRemote(BillingEndpoints.getWallet);
  const characters = byCharacter.data?.rows ?? [];
  const names = useCharacterNames(characters.map((r) => r.key).filter((k) => k && k !== '-'));
  const total = byCategory.data?.totalPoints;
  const calls = (byCategory.data?.rows ?? []).reduce((t, r) => t + r.calls, 0);
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
        onChange={setRange}
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
      {(byCategory.error || byCharacter.error) && (
        <p role="alert" className="notice-bar">
          {byCategory.error || byCharacter.error}
        </p>
      )}
      {editing && wallet.data && (
        <FieldSheet
          title="积分提醒线（积分）"
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
