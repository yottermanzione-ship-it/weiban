import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChatEndpoints, CompanionEndpoints, ContactsEndpoints } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { Name } from './chat.js';
export function ChatSettingsPage() {
  const { conversationId = '' } = useParams();
  const { state } = useChat();
  const conversation = state.conversations.find((item) => item.conversationId === conversationId);
  const role = conversation?.participants.find((item) => item.kind === 'character');
  if (!conversation || !role)
    return (
      <main>
        <p>会话不存在或已被删除</p>
        <Link to="/chat">返回微伴</Link>
      </main>
    );
  return <Settings key={conversationId} id={conversationId} characterId={role.refId} />;
}
function Settings({ id, characterId }: { id: string; characterId: string }) {
  const { state } = useChat();
  const conversation = state.conversations.find((item) => item.conversationId === id)!;
  const contact = state.contacts.find((item) => item.characterId === characterId);
  const companion = useRemote(CompanionEndpoints.getForCharacter, { params: { characterId } });
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<'clear' | 'remove' | null>(null);
  async function change(operation: () => Promise<unknown>) {
    setPending(true);
    setError('');
    setMessage('');
    try {
      await operation();
      setMessage('已保存，下一条回复开始生效');
      companion.refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <Link to={`/chat/${id}`}>返回聊天</Link>
      <h1 className="page-title">聊天信息</h1>
      <h2>
        <Name conversation={conversation} />
      </h2>
      <div className="panel stack">
        <label className="check">
          <input
            type="checkbox"
            checked={conversation.state.muted}
            disabled={pending}
            onChange={(event) =>
              void change(() =>
                api.call(ChatEndpoints.updateState, {
                  params: { conversationId: id },
                  body: { muted: event.target.checked },
                }),
              )
            }
          />
          消息免打扰
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={conversation.state.pinned}
            disabled={pending}
            onChange={(event) =>
              void change(() =>
                api.call(ChatEndpoints.updateState, {
                  params: { conversationId: id },
                  body: { pinned: event.target.checked },
                }),
              )
            }
          />
          置顶聊天
        </label>
        {companion.data && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={companion.data.instantReply}
                disabled={pending}
                onChange={(event) =>
                  void change(() =>
                    api.call(CompanionEndpoints.updateForCharacter, {
                      params: { characterId },
                      body: { instantReply: event.target.checked },
                    }),
                  )
                }
              />
              秒回
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={companion.data.splitBubbles}
                disabled={pending}
                onChange={(event) =>
                  void change(() =>
                    api.call(CompanionEndpoints.updateForCharacter, {
                      params: { characterId },
                      body: { splitBubbles: event.target.checked },
                    }),
                  )
                }
              />
              拆条
            </label>
          </>
        )}
      </div>
      <form
        className="panel stack"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void change(() =>
            api.call(ContactsEndpoints.update, {
              params: { characterId },
              body: {
                remark: String(form.get('remark') || '') || null,
                addressAs: String(form.get('addressAs') || '') || null,
              },
            }),
          );
        }}
      >
        <label>
          备注名
          <input name="remark" maxLength={20} defaultValue={contact?.remark ?? ''} />
        </label>
        <label>
          TA怎么叫我
          <input name="addressAs" maxLength={20} defaultValue={contact?.addressAs ?? ''} />
        </label>
        <button disabled={pending}>保存称呼</button>
      </form>
      {(error || companion.error) && <p role="alert">{error || companion.error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="panel rows">
        <button onClick={() => setConfirmation('clear')}>清空聊天记录</button>
        <button onClick={() => setConfirmation('remove')}>删除角色</button>
      </div>
      {confirmation && (
        <div
          role="dialog"
          aria-label={confirmation === 'clear' ? '清空聊天记录' : '删除角色'}
          className="panel"
        >
          <p>
            {confirmation === 'clear'
              ? '只清空聊天记录显示，TA的记忆和养成数据会保留'
              : '角色和聊天将从列表移除，30天内重新添加可恢复'}
          </p>
          <button
            disabled={pending}
            onClick={() =>
              void change(async () => {
                if (confirmation === 'clear')
                  await api.call(ChatEndpoints.clearHistory, { params: { conversationId: id } });
                else {
                  await api.call(ContactsEndpoints.remove, {
                    params: { characterId },
                    query: { mode: 'soft' },
                  });
                  navigate('/contacts');
                }
                setConfirmation(null);
              })
            }
          >
            确认
          </button>
          <button disabled={pending} onClick={() => setConfirmation(null)}>
            取消
          </button>
        </div>
      )}
    </main>
  );
}
