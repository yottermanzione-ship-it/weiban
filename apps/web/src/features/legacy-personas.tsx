import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  LegacyPersonaEndpoints,
  type LegacyPersonaDetail,
  type LegacyPersonaSummary,
} from '@weiban/contracts';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import {
  LegacyPersonaSession,
  legacyPersonaBlockedNotice,
  legacyPersonaConflict,
  legacyPersonaError,
} from '../data/legacy-personas.js';
import { MenuGroup, MenuRow, NavBar } from './shell-kit.js';
import { AlertDialog, showToast } from './toast.js';
import './legacy-personas.css';

const stateText = { active: '正在生效', blocked: '已保留但未生效', reset: '已恢复默认' } as const;
function useOwner() {
  const { session } = useAuth();
  if (!session) return null;
  const owner = { userId: session.user.userId, sessionId: session.session.sessionId };
  return api.owns(owner) ? `${owner.userId}:${owner.sessionId}` : null;
}
function useRequests(owner: string) {
  const [requests] = useState(() => new LegacyPersonaSession(owner, () => api.ownerKey()));
  useEffect(() => {
    requests.activate();
    return () => requests.dispose();
  }, [requests]);
  return requests;
}
function useList(owner: string) {
  const requests = useRequests(owner);
  const readRevision = useRef(0);
  const [items, setItems] = useState<LegacyPersonaSummary[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!requests.isCurrent()) return;
    const revision = ++readRevision.current;
    const live = () => requests.isCurrent() && readRevision.current === revision;
    setLoading(true);
    setError('');
    try {
      const result = await requests.request((signal) =>
        api.call(LegacyPersonaEndpoints.list, { networkOnly: true, signal }),
      );
      if (live()) setItems(result.items);
    } catch (failure) {
      if (live()) setError(legacyPersonaError(failure, 'read'));
    } finally {
      if (live()) setLoading(false);
    }
  }, [requests]);
  useEffect(() => {
    void load();
  }, [load]);
  return { items, error, loading, load };
}

/** Keep an absent/unsupported migration record out of otherwise working pages. */
export function LegacyPersonaEntry({ characterId }: { characterId?: string }) {
  const owner = useOwner();
  return owner ? (
    <OwnedEntry key={`${owner}:${characterId ?? 'list'}`} owner={owner} characterId={characterId} />
  ) : null;
}
function OwnedEntry({ owner, characterId }: { owner: string; characterId?: string }) {
  const { items, error } = useList(owner);
  const record = characterId ? items?.find((item) => item.characterId === characterId) : null;
  if (error || !items?.length || (characterId && !record)) return null;
  return (
    <MenuRow
      label="我的旧版设定"
      subtitle={record ? stateText[record.state] : '查看从旧版保留的专属设定'}
      to={characterId ? `/characters/${characterId}/legacy-persona` : '/settings/legacy-personas'}
    />
  );
}

export function LegacyPersonasPage() {
  const owner = useOwner();
  return owner ? <OwnedList key={owner} owner={owner} /> : <SignedOut />;
}
function SignedOut() {
  return (
    <main className="legacy-persona-page">
      <NavBar title="我的旧版设定" fallback="/settings" />
      <p className="page-note">请登录后查看自己的旧版设定。</p>
    </main>
  );
}
function OwnedList({ owner }: { owner: string }) {
  const { items, error, loading, load } = useList(owner);
  return (
    <main className="legacy-persona-page">
      <NavBar title="我的旧版设定" fallback="/settings" />
      <p className="page-note">这里是你在旧版为角色保存的专属设定。每份设定只对你生效。</p>
      {loading && !items && (
        <p role="status" className="page-note">
          正在读取旧版设定…
        </p>
      )}
      {error && <ReadFailure message={error} loading={loading} onRetry={() => void load()} />}
      {items && items.length > 0 && (
        <MenuGroup>
          {items.map((item) => (
            <MenuRow
              key={item.characterId}
              label={item.characterName || '角色'}
              subtitle={stateText[item.state]}
              to={`/characters/${item.characterId}/legacy-persona`}
            />
          ))}
        </MenuGroup>
      )}
      {items?.length === 0 && !error && <p className="empty">当前没有可查看的旧版设定。</p>}
    </main>
  );
}
function ReadFailure({
  message,
  loading,
  onRetry,
}: {
  message: string;
  loading: boolean;
  onRetry(): void;
}) {
  return (
    <div className="legacy-persona-notice" role="alert">
      <p>{message}</p>
      <button type="button" className="text-button" onClick={onRetry} disabled={loading}>
        {loading ? '正在读取…' : '重试读取'}
      </button>
    </div>
  );
}

export function LegacyPersonaPage() {
  const { characterId = '' } = useParams();
  const owner = useOwner();
  return owner ? (
    <OwnedDetail key={`${owner}:${characterId}`} owner={owner} characterId={characterId} />
  ) : (
    <SignedOut />
  );
}
function OwnedDetail({ owner, characterId }: { owner: string; characterId: string }) {
  const requests = useRequests(owner);
  const readRevision = useRef(0);
  const [item, setItem] = useState<LegacyPersonaDetail | null | undefined>();
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState('');
  const [resetError, setResetError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const load = useCallback(async () => {
    if (!requests.isCurrent()) return false;
    const revision = ++readRevision.current;
    const live = () => requests.isCurrent() && readRevision.current === revision;
    setLoading(true);
    setReadError('');
    try {
      const result = await requests.request((signal) =>
        api.call(LegacyPersonaEndpoints.get, {
          params: { characterId },
          networkOnly: true,
          signal,
        }),
      );
      if (!live()) return false;
      if (result.item && result.item.characterId !== characterId)
        throw new Error('LEGACY_PERSONA_SCOPE_MISMATCH');
      setItem(result.item);
      if (result.item?.state === 'reset') {
        requests.clearReset();
        setResetError('');
      }
      return true;
    } catch (failure) {
      if (live()) {
        setItem(undefined);
        setReadError(legacyPersonaError(failure, 'read'));
      }
      return false;
    } finally {
      if (live()) setLoading(false);
    }
  }, [characterId, requests]);
  useEffect(() => {
    void load();
  }, [load]);
  async function reset() {
    if (!item || busy || !requests.isCurrent()) return;
    setBusy(true);
    setResetError('');
    setNotice('');
    try {
      const result = await requests.reset(characterId, item.version, async (body, signal) => {
        const result = await api.call(LegacyPersonaEndpoints.reset, {
          params: { characterId },
          body,
          networkOnly: true,
          signal,
        });
        if (
          result.item.characterId !== characterId ||
          result.item.state !== 'reset' ||
          result.item.sections.length !== 0 ||
          result.item.originalRetained
        )
          throw new Error('LEGACY_PERSONA_RESET_UNCONFIRMED');
        return result;
      });
      if (!requests.isCurrent()) return;
      if (result.item.characterId !== characterId) throw new Error('LEGACY_PERSONA_SCOPE_MISMATCH');
      setItem(result.item);
      setConfirming(false);
      showToast('已恢复默认', 2000, 'success');
    } catch (failure) {
      if (!requests.isCurrent()) return;
      setConfirming(false);
      if (legacyPersonaConflict(failure)) {
        const refreshed = await load();
        if (requests.isCurrent())
          setNotice(
            refreshed
              ? '这份设定已更新，已重新读取。请核对后再决定是否恢复默认。'
              : '这份设定已更新，请重新读取后再操作。',
          );
      } else setResetError(legacyPersonaError(failure, 'reset'));
    } finally {
      if (requests.isCurrent()) setBusy(false);
    }
  }
  return (
    <main className="legacy-persona-page">
      <NavBar title="我的旧版设定" fallback={`/characters/${characterId}`} />
      {loading && item === undefined && (
        <p className="page-note" role="status">
          正在读取旧版设定…
        </p>
      )}
      {readError && (
        <ReadFailure message={readError} loading={loading} onRetry={() => void load()} />
      )}
      {notice && (
        <p role="status" className="legacy-persona-notice">
          {notice}
        </p>
      )}
      {item === null && <p className="empty">当前没有可查看的旧版设定。</p>}
      {item && (
        <>
          <header className="legacy-persona-heading">
            <h1>{item.characterName || '角色'}</h1>
            <span className={`legacy-persona-state ${item.state}`}>{stateText[item.state]}</span>
          </header>
          <p className="page-note">
            {item.state === 'active'
              ? '这些是你在旧版保存的专属设定，正在用于你和这位角色的聊天。'
              : item.state === 'reset'
                ? '已清除你的旧版定制，以后跟随当前公共人设。聊天记录、记忆和积分不受影响。'
                : legacyPersonaBlockedNotice(item.blockedReason)}
          </p>
          {item.state !== 'reset' &&
            item.sections.map((section) => (
              <section
                className="legacy-persona-section"
                key={section.key}
                aria-labelledby={`legacy-section-${section.key}`}
              >
                <h2 id={`legacy-section-${section.key}`}>{section.title}</h2>
                <dl>
                  {section.fields.map((field, index) => (
                    <div className="legacy-persona-field" key={`${section.key}:${index}`}>
                      <dt>{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          {item.state !== 'reset' && item.sections.length === 0 && (
            <p className="page-note">
              {item.originalRetained
                ? '旧版内容已保留，暂时没有整理好的可读内容。'
                : '暂时没有可显示的旧版内容。'}
            </p>
          )}
          {item.state !== 'reset' && item.originalRetained && (
            <p className="legacy-persona-retained">旧版原始记录已保留。</p>
          )}
          {resetError && (
            <div role="alert" className="legacy-persona-notice">
              <p>{resetError}</p>
              {requests.resetPending && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => void reset()}
                >
                  {busy ? '正在确认结果…' : '重试恢复默认'}
                </button>
              )}
            </div>
          )}
          {item.state !== 'reset' && item.resetAllowed && !requests.resetPending && (
            <MenuGroup>
              <MenuRow
                label="恢复默认"
                danger
                disabled={busy || loading}
                onClick={() => setConfirming(true)}
              />
            </MenuGroup>
          )}
          {item.state === 'reset' && (
            <p className="legacy-persona-retained">这份旧版定制已清除，不会因再次迁移恢复。</p>
          )}
        </>
      )}
      {confirming && item && (
        <AlertDialog
          title="恢复默认？"
          message={`只清除你对「${item.characterName || '这位角色'}」的旧版定制，以后跟随当前公共人设。你的聊天记录、记忆和积分不受影响。恢复后不能在这里撤销。`}
          confirmLabel="恢复默认"
          pending={busy}
          onCancel={() => {
            if (!busy) setConfirming(false);
          }}
          onConfirm={() => void reset()}
        />
      )}
    </main>
  );
}
