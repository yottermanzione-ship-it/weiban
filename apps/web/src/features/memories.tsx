import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MemoryEndpoints, type MemoryEntry } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { CharacterAvatar } from './character-avatar.js';
import { CharacterName } from './chat.js';
import { NavBar, NavIcon, MenuGroup, GroupHeader, Sheet, EmptyState } from './shell-kit.js';
import { Dialog } from './toast.js';
const categories = {
  basic: '关于我',
  preference: '偏好',
  status: '近况',
  people: '身边的人',
  dates: '重要日期',
  episode: '共同经历',
  commitment: '我们说好的',
};
export function MemoriesPage() {
  const { characterId = '' } = useParams();
  const { state, assertOwner } = useChat();
  const contact = state.contacts.find(
    (c) => c.characterId === characterId && c.status === 'active',
  );
  const [afterId, setAfterId] = useState<string>();
  const records = useRemote(MemoryEndpoints.list, {
    networkOnly: true,
    params: { characterId },
    query: { limit: 50, ...(afterId ? { afterId } : {}) },
  });
  const [editing, setEditing] = useState<MemoryEntry | 'new' | null>(null);
  const [removing, setRemoving] = useState<MemoryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function change(operation: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      assertOwner();
      await operation();
      setEditing(null);
      setRemoving(null);
      records.refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  const open = (entry: MemoryEntry | 'new') => {
    setError('');
    setEditing(entry);
  };
  return (
    <main className="memories-page">
      <NavBar
        title="我们的记忆"
        fallback={`/characters/${characterId}`}
        right={
          contact ? (
            <NavIcon name="wechat/add" label="添加记忆" onClick={() => open('new')} />
          ) : undefined
        }
      />
      {!contact ? (
        <EmptyState icon="wechat/person" title="好友不存在或已被删除" />
      ) : (
        <>
          <Link className="memory-owner" to={`/characters/${characterId}`}>
            <CharacterAvatar id={characterId} size={44} />
            <span>
              <CharacterName id={characterId} fallback={contact.remark} />
              <small>你和 TA 共同记下的事</small>
            </span>
          </Link>
          <p className="hint page-note">
            你可以修改、删除，或告诉 TA
            想记住的事。删除后旧消息不会再被用来记下它；再次主动提起时可以重新记下。
          </p>
          {records.loading && (
            <p role="status" className="empty">
              正在读取…
            </p>
          )}
          {records.error && (
            <div className="empty" role="alert">
              <p>{records.error}</p>
              <button onClick={records.refresh}>重试</button>
            </div>
          )}
          {error && !editing && !removing && (
            <p role="alert" className="notice-bar">
              {error}
            </p>
          )}
          {records.data?.items.length === 0 && !records.loading && (
            <EmptyState
              icon="wechat/note"
              title="还没有记下的事情"
              desc="点右上角，告诉 TA 一件你想记住的事"
            />
          )}
          {Object.entries(categories).map(([category, label]) => {
            const entries = records.data?.items.filter((e) => e.category === category) ?? [];
            return entries.length ? (
              <section key={category}>
                <GroupHeader>{label}</GroupHeader>
                <MenuGroup>
                  {entries.map((entry) => (
                    <button
                      type="button"
                      className="memory-entry"
                      key={entry.memoryId}
                      onClick={() => open(entry)}
                    >
                      <span className="memory-entry-content">{entry.content}</span>
                      <small>
                        {entry.status === 'past' ? '过去' : '现在'} ·{' '}
                        {entry.createdBy === 'user_manual' ? '你告诉 TA 的' : '从聊天中记下'} ·{' '}
                        {entry.createdAt.slice(0, 10)}
                      </small>
                      <small>
                        {entry.scope === 'adult' ? '来自私密模式' : '来自日常'} · 此角色的记忆
                      </small>
                    </button>
                  ))}
                </MenuGroup>
              </section>
            ) : null;
          })}
          {(afterId || records.data?.nextCursor) && (
            <nav className="pager-row">
              <button disabled={busy || !afterId} onClick={() => setAfterId(undefined)}>
                第一页
              </button>
              <button
                disabled={busy || !records.data?.nextCursor}
                onClick={() => setAfterId(records.data?.nextCursor ?? undefined)}
              >
                下一页
              </button>
            </nav>
          )}
        </>
      )}
      {editing && (
        <MemorySheet
          key={editing === 'new' ? 'new' : editing.memoryId}
          entry={editing === 'new' ? null : editing}
          busy={busy}
          error={error}
          onClose={() => {
            if (!busy) setEditing(null);
          }}
          onDelete={() => {
            if (editing !== 'new') setRemoving(editing);
          }}
          onSave={(content, category, status, clientMemoryId) =>
            void change(() =>
              editing === 'new'
                ? api.call(MemoryEndpoints.create, {
                    networkOnly: true,
                    params: { characterId },
                    body: { clientMemoryId, content, category },
                  })
                : api.call(MemoryEndpoints.update, {
                    networkOnly: true,
                    params: { characterId, memoryId: editing.memoryId },
                    body: { content, status },
                  }),
            )
          }
        />
      )}
      {removing && (
        <Dialog
          title="删除记忆"
          actions={[
            {
              label: '取消',
              onClick: () => {
                if (!busy) setRemoving(null);
              },
            },
            {
              label: busy ? '正在删除…' : '删除',
              danger: true,
              onClick: () => {
                if (!busy)
                  void change(() =>
                    api.call(MemoryEndpoints.remove, {
                      networkOnly: true,
                      params: { characterId, memoryId: removing.memoryId },
                    }),
                  );
              },
            },
          ]}
        >
          <p>确认让 TA 忘记这条？旧消息不会再被用来记下它。</p>
          {error && <p role="alert">{error}</p>}
        </Dialog>
      )}
    </main>
  );
}
function MemorySheet({
  entry,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  entry: MemoryEntry | null;
  busy: boolean;
  error: string;
  onClose(): void;
  onDelete(): void;
  onSave(
    content: string,
    category: MemoryEntry['category'],
    status: MemoryEntry['status'],
    id: string,
  ): void;
}) {
  const [content, setContent] = useState(entry?.content ?? '');
  const [category, setCategory] = useState<MemoryEntry['category']>(entry?.category ?? 'basic');
  const [status, setStatus] = useState<MemoryEntry['status']>(entry?.status ?? 'current');
  const [id, setId] = useState(() => crypto.randomUUID());
  return (
    <Sheet
      title={entry ? '编辑记忆' : '添加记忆'}
      closeLabel="取消"
      onClose={onClose}
      action={
        <button
          className="small-primary primary"
          disabled={busy || !content.trim()}
          onClick={() => onSave(content.trim(), category, status, id)}
        >
          完成
        </button>
      }
    >
      <form
        className="memory-form"
        onChange={() => setId(crypto.randomUUID())}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && content.trim()) onSave(content.trim(), category, status, id);
        }}
      >
        <fieldset disabled={busy}>
          <label>
            内容
            <textarea
              aria-label="记忆内容"
              value={content}
              required
              maxLength={1000}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          <small className="hint">{content.length}/1000</small>
          {!entry ? (
            <label>
              分类
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as MemoryEntry['category'])}
              >
                {Object.entries(categories).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <p className="hint">{categories[entry.category]}</p>
              <label>
                状态
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as MemoryEntry['status'])}
                >
                  <option value="current">现在</option>
                  <option value="past">过去</option>
                </select>
              </label>
              <button type="button" className="danger" onClick={onDelete}>
                删除这条记忆
              </button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </fieldset>
      </form>
    </Sheet>
  );
}
