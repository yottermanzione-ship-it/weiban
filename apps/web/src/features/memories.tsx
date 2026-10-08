import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MemoryEndpoints, type MemoryEntry } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
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
  const [busy, setBusy] = useState(false);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  async function change(operation: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      assertOwner();
      await operation();
      records.refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  if (!contact)
    return (
      <main>
        <p>好友不存在或已被删除</p>
        <Link to="/contacts">返回通讯录</Link>
      </main>
    );
  return (
    <main>
      <Link to={`/chat/${contact.conversationId}/settings`}>返回聊天信息</Link>
      <h1 className="page-title">TA记住了什么</h1>
      <p>
        你可以修改、删除，或告诉TA想记住的事。删除后旧消息不会再被用来记下它；再次主动提起时可以重新记下。
      </p>
      <form
        className="panel stack"
        onChange={() => setDraftId(crypto.randomUUID())}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const values = new FormData(form);
          void change(async () => {
            await api.call(MemoryEndpoints.create, {
              networkOnly: true,
              params: { characterId },
              body: {
                clientMemoryId: draftId,
                content: String(values.get('content') ?? ''),
                category: String(values.get('category')) as MemoryEntry['category'],
              },
            });
            form.reset();
            setDraftId(crypto.randomUUID());
          });
        }}
      >
        <label>
          我想让TA记住…
          <textarea name="content" required maxLength={1000} />
        </label>
        <label>
          分类
          <select name="category">
            {Object.entries(categories).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy}>添加记忆</button>
      </form>
      {records.loading && <p role="status">正在读取…</p>}
      {(error || records.error) && <p role="alert">{error || records.error}</p>}
      {records.data?.items.length === 0 && <p>还没有记下的事情</p>}
      {records.data?.items.map((entry) => (
        <MemoryEditor
          key={`${entry.memoryId}:${entry.updatedAt}`}
          entry={entry}
          busy={busy}
          save={(content, status) =>
            void change(() =>
              api.call(MemoryEndpoints.update, {
                networkOnly: true,
                params: { characterId, memoryId: entry.memoryId },
                body: { content, status },
              }),
            )
          }
          remove={() =>
            void change(() =>
              api.call(MemoryEndpoints.remove, {
                networkOnly: true,
                params: { characterId, memoryId: entry.memoryId },
              }),
            )
          }
        />
      ))}
      <nav>
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
    </main>
  );
}
function MemoryEditor({
  entry,
  busy,
  save,
  remove,
}: {
  entry: MemoryEntry;
  busy: boolean;
  save: (text: string, status: MemoryEntry['status']) => void;
  remove: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <form
      className="panel stack"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        save(
          String(form.get('content') ?? ''),
          String(form.get('status')) as MemoryEntry['status'],
        );
      }}
    >
      <h2>{categories[entry.category]}</h2>
      <label>
        内容
        <textarea name="content" defaultValue={entry.content} required maxLength={1000} />
      </label>
      <label>
        状态
        <select name="status" defaultValue={entry.status}>
          <option value="current">现在</option>
          <option value="past">过去</option>
        </select>
      </label>
      <p>
        {entry.createdBy === 'user_manual' ? '你告诉TA的' : '从聊天中记下'} ·{' '}
        {entry.scope === 'adult' ? '来自成人模式' : '来自日常'} · 仅这位角色知道
      </p>
      <p>记下日期：{entry.createdAt.slice(0, 10)}</p>
      <div>
        <button disabled={busy}>保存修改</button>
        <button type="button" disabled={busy} onClick={() => setConfirm(true)}>
          删除
        </button>
      </div>
      {confirm && (
        <div role="dialog" aria-label="删除记忆">
          <p>确认让TA忘记这条？</p>
          <button type="button" disabled={busy} onClick={remove}>
            确认删除
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirm(false)}>
            取消
          </button>
        </div>
      )}
    </form>
  );
}
