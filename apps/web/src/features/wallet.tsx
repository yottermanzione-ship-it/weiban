/*
 * 积分（docs/refactor/06-old-ui-spec.md 第 6 节）：钱包、充值、积分明细（含每条消息）、价目表。
 * 1 元 = 100 积分；界面只用接口下发的 *Points 字段（契约 3.3），格式见 points.ts。
 * 聊天、通话、朋友圈里不出现积分数；每条消息的消耗在「积分明细 › 每条消息」里查看。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BillingEndpoints,
  RECHARGE_MIN_FEN,
  RECHARGE_MAX_FEN,
  ChatEndpoints,
  ModelAccessEndpoints,
  type ChargedMessage,
  type LedgerEntry,
  type ModelInfo,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterAvatar } from './character-avatar.js';
import { OldIcon, OldImage } from './old-icons.js';
import {
  Chevron,
  EmptyState,
  GroupHeader,
  IconTile,
  MenuGroup,
  MenuRow,
  NavBar,
  TextTabs,
} from './shell-kit.js';
import { Dialog } from './toast.js';
import { formatPoints, pointsText, signedPoints, yuanText } from './points.js';

function dateKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function localDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return dateKey(d.toISOString());
}

// ---------- 钱包（6.2） ----------

export function WalletPage() {
  const wallet = useRemote(BillingEndpoints.getWallet);
  const today = localDay();
  const usage = useRemote(BillingEndpoints.getUsageSummary, {
    query: { from: today, to: today, groupBy: 'category' },
  });
  const navigate = useNavigate();
  const data = wallet.data;
  const low = data != null && (data.availablePoints ?? 0) < (data.lowBalanceThresholdPoints ?? 0);
  return (
    <main className="wallet-page">
      <NavBar title="积分" fallback="/services" />
      <section className="wallet-card">
        <OldImage name="wechat/membership.webp" size={56} />
        <p className="wallet-label">我的积分</p>
        <strong className="wallet-number tabular">
          {data ? formatPoints(data.balancePoints) : '—'}
        </strong>
        {low && <span className="low-tag">积分不足</span>}
        {data && (data.heldPoints ?? 0) > 0 && (
          <p className="wallet-held">其中 {formatPoints(data.heldPoints)} 积分处理中</p>
        )}
        <button
          type="button"
          className="primary wallet-recharge"
          onClick={() => navigate('/wallet/recharge')}
        >
          充值
        </button>
        <p className="wallet-rate">1 元 = 100 积分</p>
      </section>
      <MenuGroup>
        <MenuRow to="/ledger" label="积分明细" />
        <MenuRow
          to="/usage"
          label="用量"
          value={usage.data ? `今日 ${pointsText(usage.data.totalPoints)}` : undefined}
        />
        <MenuRow to="/prices" label="AI 模型价格" />
      </MenuGroup>
      {wallet.error && (
        <p role="alert" className="notice-bar">
          {wallet.error}
        </p>
      )}
    </main>
  );
}

// ---------- 充值（6.3） ----------

export function RechargePage() {
  const options = useRemote(BillingEndpoints.getRechargeOptions);
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [contact, setContact] = useState<{ hint: string; points?: number } | null>(null);
  const data = options.data;
  const custom = selected === 'custom';
  const tier = data?.tiers.find((t) => t.tierId === selected) ?? data?.tiers[0];
  const validDecimal = /^\d+(\.\d{1,2})?$/.test(amount.trim());
  const [whole = '', decimal = ''] = amount.trim().split('.');
  const fen = validDecimal ? Number(whole) * 100 + Number(decimal.padEnd(2, '0')) : NaN;
  const valid = Number.isSafeInteger(fen) && fen >= RECHARGE_MIN_FEN && fen <= RECHARGE_MAX_FEN;
  async function quote() {
    if (pending || !data || (custom && !valid)) return;
    setPending(true);
    setError('');
    try {
      if (custom) {
        const result = await api.call(BillingEndpoints.quoteRecharge, { body: { amountFen: fen } });
        setContact({ hint: result.contactHint, points: result.points });
      } else setContact({ hint: data.contactHint || '请联系管理员充值', points: tier?.points });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="recharge-page">
      <NavBar title="充值" fallback="/wallet" />
      <p className="recharge-section">选择金额</p>
      <div className="recharge-tiers" role="radiogroup" aria-label="选择金额">
        {data?.tiers.map((t) => (
          <button
            key={t.tierId}
            type="button"
            role="radio"
            aria-checked={!custom && t.tierId === tier?.tierId}
            className={`recharge-tier ${!custom && t.tierId === tier?.tierId ? 'on' : ''}`}
            disabled={pending}
            onClick={() => setSelected(t.tierId)}
          >
            <span className="recharge-points">
              <b>{pointsText(t.points)}</b>
              {t.bonusPoints > 0 && <small>送 {formatPoints(t.bonusPoints)} 积分</small>}
            </span>
            <span className="recharge-price tabular">{yuanText(t.priceMicros)}</span>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          disabled={pending}
          className={`recharge-tier ${custom ? 'on' : ''}`}
          onClick={() => setSelected('custom')}
        >
          自定义金额
        </button>
      </div>
      {custom && (
        <div className="field-rows">
          <label className="field-row">
            <span>金额（元）</span>
            <input
              aria-label="自定义充值金额"
              inputMode="decimal"
              value={amount}
              maxLength={12}
              disabled={pending}
              onChange={(e) => {
                setAmount(e.target.value);
                setError('');
              }}
              placeholder="最低5元"
            />
          </label>
          <p className="hint page-note">5～10,000元，最多两位小数</p>
          {amount && !valid && (
            <p role="alert" className="error page-note">
              请输入5～10,000元的金额，最多两位小数
            </p>
          )}
        </div>
      )}
      {options.loading && <p className="empty">正在读取档位…</p>}
      <div className="recharge-bottom">
        <button
          type="button"
          className="primary full"
          disabled={!data || pending || (custom ? !valid : !tier)}
          onClick={() => void quote()}
        >
          {pending ? '正在确认金额…' : '联系管理员充值'}
        </button>
        <p className="recharge-note">
          积分仅用于本应用内的 AI 对话、通话等消耗，不可提现、不可转让。1 元 = 100 积分。
        </p>
      </div>
      {(error || options.error) && (
        <p role="alert" className="notice-bar">
          {error || options.error}
        </p>
      )}
      {contact && (
        <Dialog actions={[{ label: '知道了', primary: true, onClick: () => setContact(null) }]}>
          {contact.points != null && <p>充值金额对应 {pointsText(contact.points)}</p>}
          <p>{contact.hint}</p>
          <p className="hint">尚未支付或到账</p>
        </Dialog>
      )}
    </main>
  );
}

// ---------- 积分明细（6.4） ----------

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
const typeNames: Record<LedgerEntry['type'], string> = {
  admin_grant: '管理员加积分',
  admin_deduct: '管理员扣积分',
  charge: '消耗',
  refund: '退还',
  adjustment: '调整',
};

interface LedgerGroup {
  key: string;
  day: string;
  kind: 'charge' | 'single';
  characterId: string | null;
  category: string | null;
  entries: LedgerEntry[];
  points: number;
}

function groupLedger(entries: LedgerEntry[]): Map<string, LedgerGroup[]> {
  const days = new Map<string, LedgerGroup[]>();
  for (const entry of entries) {
    const day = dateKey(entry.createdAt);
    const list = days.get(day) ?? [];
    if (entry.type === 'charge') {
      const key = `${day}|${entry.characterId ?? '-'}|${entry.category ?? '-'}`;
      let group = list.find((g) => g.key === key);
      if (!group) {
        group = {
          key,
          day,
          kind: 'charge',
          characterId: entry.characterId,
          category: entry.category,
          entries: [],
          points: 0,
        };
        list.push(group);
      }
      group.entries.push(entry);
      group.points += entry.points ?? 0;
    } else
      list.push({
        key: entry.entryId,
        day,
        kind: 'single',
        characterId: entry.characterId,
        category: entry.category,
        entries: [entry],
        points: entry.points ?? 0,
      });
    days.set(day, list);
  }
  return days;
}

function dayLabel(day: string) {
  const [, m, d] = day.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

export function LedgerPage() {
  const [filter, setFilter] = useState<'all' | 'spend' | 'topup'>('all');
  const [cursor, setCursor] = useState<string>();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [charged, setCharged] = useState<Record<string, ChargedMessage | null>>({});
  const [open, setOpen] = useState<LedgerGroup | null>(null);
  const navigate = useNavigate();
  const remote = useRemote(BillingEndpoints.listLedger, {
    query: { type: filter, limit: 100, ...(cursor ? { cursor } : {}) },
  });
  useEffect(() => {
    setEntries([]);
    setCursor(undefined);
  }, [filter]);
  useEffect(() => {
    if (remote.data)
      setEntries((before) => {
        const seen = new Set(before.map((e) => e.entryId));
        return [...before, ...remote.data!.items.filter((e) => !seen.has(e.entryId))];
      });
  }, [remote.data]);
  // 两段取数（6.4）：扣费流水的 usageRecordId 批量查消息摘要（每次 ≤ 100）。
  useEffect(() => {
    const missing = entries
      .map((e) => e.usageRecordId)
      .filter((id): id is string => !!id && !(id in charged));
    if (!missing.length) return;
    let active = true;
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += 100) chunks.push(missing.slice(i, i + 100));
    void Promise.all(
      chunks.map((usageRecordIds) =>
        api.call(ChatEndpoints.listChargedMessages, { body: { usageRecordIds } }),
      ),
    )
      .then((results) => {
        if (!active) return;
        setCharged((before) => {
          const next = { ...before };
          // 查不到的也记下，避免重复请求（值为占位）。
          for (const id of missing) if (!(id in next)) next[id] = null;
          for (const r of results) for (const item of r.items) next[item.usageRecordId] = item;
          return next;
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [entries, charged]);
  const characterIds = useMemo(
    () => [...new Set(entries.map((e) => e.characterId).filter((id): id is string => !!id))],
    [entries],
  );
  const names = useCharacterNames(characterIds);
  const days = groupLedger(entries);
  const messagesOf = (group: LedgerGroup) =>
    group.entries
      .map((e) => (e.usageRecordId ? charged[e.usageRecordId] : null))
      .filter((m): m is ChargedMessage => !!m);

  if (open) {
    const messages = messagesOf(open).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const title = `${open.characterId ? (names[open.characterId] ?? '角色') : '平台'} · ${categoryNames[open.category ?? 'unsupported'] ?? '其他'}`;
    return (
      <main className="ledger-page">
        <NavBar title={title} onBack={() => setOpen(null)} />
        <GroupHeader right={`消耗 ${formatPoints(Math.abs(open.points))}`}>
          {dayLabel(open.day)}
        </GroupHeader>
        <MenuGroup>
          {messages.map((m) => (
            <button
              key={m.usageRecordId}
              type="button"
              className="charge-row"
              onClick={() => navigate(`/chat/${m.conversationId}`)}
            >
              <span className="charge-top">
                <small>
                  {new Date(m.createdAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </small>
                <b className="tabular">{signedPoints(-m.pointsCost)} 积分</b>
              </span>
              <span className="charge-excerpt">{m.excerpt}</span>
            </button>
          ))}
        </MenuGroup>
        {messages.length === 0 && <EmptyState icon="wechat/note" title="没有可查看的消息" />}
      </main>
    );
  }

  return (
    <main className="ledger-page">
      <NavBar title="积分明细" fallback="/wallet" />
      <TextTabs<typeof filter>
        items={[
          { value: 'all' as const, label: '全部' },
          { value: 'spend' as const, label: '消耗' },
          { value: 'topup' as const, label: '增加' },
        ]}
        value={filter}
        onChange={setFilter}
        right="单位：积分"
      />
      {[...days.entries()].map(([day, groups]) => {
        const spent = groups
          .flatMap((g) => g.entries)
          .reduce((t, e) => t + Math.min(0, e.points ?? 0), 0);
        const added = groups
          .flatMap((g) => g.entries)
          .reduce((t, e) => t + Math.max(0, e.points ?? 0), 0);
        return (
          <section key={day}>
            <GroupHeader
              right={[
                spent < 0 ? `消耗 ${formatPoints(-spent)}` : '',
                added > 0 ? `增加 ${formatPoints(added)}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              {dayLabel(day)}
            </GroupHeader>
            <MenuGroup>
              {groups.map((group) => {
                const entry = group.entries[0]!;
                if (group.kind === 'single') {
                  const grant = (entry.points ?? 0) > 0;
                  return (
                    <div key={group.key} className="ledger-row-old">
                      {grant ? (
                        <IconTile icon="wechat/add" tint="green" size="md" />
                      ) : (
                        <IconTile icon="wechat/note" tint="orange" size="md" />
                      )}
                      <span className="ledger-text">
                        <span>{typeNames[entry.type]}</span>
                        <small>
                          {entry.note || `剩余 ${formatPoints(entry.balanceAfterPoints)}`}
                        </small>
                      </span>
                      <b className={`tabular ${grant ? 'income' : ''}`}>
                        {signedPoints(entry.points)}
                      </b>
                    </div>
                  );
                }
                const messages = messagesOf(group);
                const linkable = messages.length > 0;
                const who = group.characterId ? (names[group.characterId] ?? '角色') : '平台';
                const body = (
                  <>
                    {group.characterId ? (
                      <CharacterAvatar id={group.characterId} size={40} radius={4} />
                    ) : (
                      <IconTile icon="wechat/grid" tint="blue" size="md" />
                    )}
                    <span className="ledger-text">
                      <span>
                        {who} · {categoryNames[group.category ?? 'unsupported'] ?? '其他'}
                      </span>
                      <small>
                        {linkable
                          ? `共 ${messages.length} 条消息`
                          : `共 ${group.entries.length} 次`}
                      </small>
                    </span>
                    <b className="tabular">{signedPoints(group.points)}</b>
                    {linkable && <Chevron />}
                  </>
                );
                return linkable ? (
                  <button
                    key={group.key}
                    type="button"
                    className="ledger-row-old"
                    onClick={() => setOpen(group)}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={group.key} className="ledger-row-old">
                    {body}
                  </div>
                );
              })}
            </MenuGroup>
          </section>
        );
      })}
      {!remote.loading && !entries.length && !remote.error && (
        <EmptyState icon="wechat/note" title="还没有积分变动" />
      )}
      {remote.error && (
        <p role="alert" className="notice-bar">
          {remote.error}
        </p>
      )}
      {remote.data?.nextCursor && (
        <div className="pager-row">
          <button disabled={remote.loading} onClick={() => setCursor(remote.data!.nextCursor!)}>
            查看更多
          </button>
        </div>
      )}
    </main>
  );
}

// ---------- 价目表（6.5） ----------

export function perReplyText(model: Pick<ModelInfo, 'pointsPerReply'>) {
  return model.pointsPerReply == null ? '—' : `约每条 ${formatPoints(model.pointsPerReply)} 积分`;
}

export function PricesPage() {
  const models = useRemote(ModelAccessEndpoints.listModels);
  const items = models.data?.items ?? [];
  const chat = items.filter((m) => !m.capabilities.includes('adult_content'));
  const adult = items.filter((m) => m.capabilities.includes('adult_content'));
  const section = (title: string, list: ModelInfo[]) =>
    list.length > 0 && (
      <>
        <GroupHeader>{title}</GroupHeader>
        <MenuGroup>
          {list.map((model) => (
            <MenuRow
              key={model.modelKey}
              label={model.displayName}
              subtitle={`${perReplyText(model)}${model.available ? '' : ' · 暂不可用'}`}
              chevron={false}
            />
          ))}
        </MenuGroup>
      </>
    );
  return (
    <main>
      <NavBar title="AI 模型价格" fallback="/wallet" />
      {section('聊天模型', chat)}
      {section('私密模式模型', adult)}
      <p className="hint page-note">
        「约每条」按一次普通回复估算，实际按字数多少略有浮动；每条消息的实际消耗可在积分明细里查看。
      </p>
      {models.error && (
        <p role="alert" className="notice-bar">
          {models.error}
        </p>
      )}
    </main>
  );
}
