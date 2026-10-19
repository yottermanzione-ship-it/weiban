/*
 * 角色生态 v1（17 号 §5）：TA 的碎碎念页（角色资料页入口）、资料页签名 / 状态、聊天信息页的角色生态开关。
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EcologyEndpoints, type EcologyMurmur } from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { EmptyState, MenuRow, NavBar, SwitchRow } from './shell-kit.js';
import { showToast } from './toast.js';

function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  const y = new Date(now.getTime() - 86400_000);
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function pointsText(p: number): string {
  if (p <= 0) return '没花积分';
  return `花了 ${p < 1 ? p.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : p.toFixed(1).replace(/\.0$/, '')} 积分`;
}

export function MurmursPage() {
  const { characterId = '' } = useParams();
  const [items, setItems] = useState<EcologyMurmur[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(next: string | null) {
    setLoading(true);
    setError('');
    try {
      const page = await api.call(EcologyEndpoints.listMurmurs, {
        params: { characterId },
        query: { limit: 20, ...(next ? { cursor: next } : {}) },
      });
      setItems((prev) => (next ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  return (
    <main className="murmurs-page">
      <NavBar title="TA 的碎碎念" fallback={`/characters/${characterId}`} />
      {error && (
        <div className="notice-bar" role="alert">
          <p>{error}</p>
          <button className="text-button" onClick={() => void load(null)}>
            重试
          </button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <EmptyState
          title="还没有碎碎念"
          desc="打开「角色生态」后，TA 每次想一想都会在这里写一两句。"
        />
      )}
      <ol className="murmur-list">
        {items.map((m) => (
          <li key={m.murmurId} className="murmur-item">
            <time>{when(m.createdAt)}</time>
            <p className="murmur-text">{m.text}</p>
            <p className="murmur-meta">
              {m.origin === 'user_request' ? '你让 TA 做的 · ' : ''}
              {m.actionSummary} · {pointsText(m.points)}
            </p>
          </li>
        ))}
      </ol>
      {cursor && (
        <button
          type="button"
          className="text-button murmur-more"
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          {loading ? '正在读取…' : '更早的'}
        </button>
      )}
      <p className="ecology-footnote">
        碎碎念只有你能看到。想调整 TA 多久想一次，去 <Link to="/services/ecology">角色生态</Link>。
      </p>
    </main>
  );
}

/** 资料页：签名（角色在生态里改过就用新的，否则用角色卡签名）。 */
export function EcologySignatureLine({
  characterId,
  tagline,
  enabled,
}: {
  characterId: string;
  tagline: string | null | undefined;
  enabled: boolean;
}) {
  const profile = useRemote(
    EcologyEndpoints.getCharacterProfile,
    { params: { characterId } },
    enabled,
  );
  const status = profile.data?.statusText;
  const signature = profile.data?.signature || tagline;
  return (
    <>
      {status && <p className="ecology-status">状态：{status}</p>}
      {signature && <p>签名：{signature}</p>}
    </>
  );
}

/** 资料页入口。 */
export function MurmursRow({ characterId }: { characterId: string }) {
  return <MenuRow to={`/characters/${characterId}/murmurs`} label="TA 的碎碎念" />;
}

/** 聊天信息页：这个角色是否参与角色生态（和生态页的角色开关是同一个）。 */
export function EcologyCharacterRow({ characterId }: { characterId: string }) {
  const settings = useRemote(EcologyEndpoints.get, { networkOnly: true });
  const [value, setValue] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const row = settings.data?.characters.find((c) => c.characterId === characterId);
  const on = settings.data?.enabled ?? false;
  if (!settings.data) return null;
  if (!on)
    return (
      <MenuRow
        to="/services/ecology"
        label="角色生态"
        value={settings.data.eligible ? '未开启' : 'PRO+ 专属'}
      />
    );
  return (
    <SwitchRow
      label="TA 参与角色生态"
      subtitle="TA 会自己找你、发朋友圈，按做的事消耗积分"
      checked={value ?? row?.enabled ?? true}
      disabled={busy}
      onChange={async (enabled) => {
        setBusy(true);
        setValue(enabled);
        try {
          await api.call(EcologyEndpoints.setCharacter, {
            params: { characterId },
            body: { enabled },
          });
        } catch (e) {
          setValue(null);
          showToast(friendlyError(e), 2500, 'error');
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
