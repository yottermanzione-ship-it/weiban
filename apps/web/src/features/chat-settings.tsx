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
  const { state, clearHistory, synchronize, assertOwner } = useChat();
  const conversation = state.conversations.find((item) => item.conversationId === id)!;
  const contact = state.contacts.find((item) => item.characterId === characterId);
  const modes = useRemote(CompanionEndpoints.listModes, { params: { characterId } });
  const companion = useRemote(CompanionEndpoints.getForCharacter, { params: { characterId } });
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<
    'clear' | 'remove' | 'purge' | 'purgeConfirmed' | null
  >(null);
  async function change(operation: () => Promise<unknown>, after?: () => void) {
    setPending(true);
    setError('');
    setMessage('');
    try {
      assertOwner();
      await operation();
      await synchronize();
      setMessage('已保存');
      companion.refresh();
      after?.();
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
            <h3 className="group-label">和 TA 的相处</h3>
            {modes.data && (
              <label>
                情景模式
                <select
                  disabled={pending}
                  value={companion.data.scenarioMode ?? 'daily'}
                  onChange={(event) =>
                    void change(() =>
                      api.call(CompanionEndpoints.updateForCharacter, {
                        params: { characterId },
                        body: {
                          scenarioMode: event.target.value as
                            'daily' | 'tsundere' | 'romance' | 'adult',
                        },
                      }),
                    )
                  }
                >
                  {modes.data.items.map((mode) => (
                    <option key={mode.id} value={mode.id}>
                      {mode.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              人设贴合度（
              {['极顺从', '顺从', '均衡', '贴合', '极贴合'][(companion.data.personaFit ?? 3) - 1]}
              ）
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={companion.data.personaFit ?? 3}
                disabled={pending}
                onChange={(event) =>
                  void change(() =>
                    api.call(CompanionEndpoints.updateForCharacter, {
                      params: { characterId },
                      body: { personaFit: Number(event.target.value) },
                    }),
                  )
                }
              />
            </label>
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
            <label className="check">
              <input
                type="checkbox"
                checked={companion.data.proactiveMessages ?? true}
                disabled={pending}
                onChange={(event) =>
                  void change(() =>
                    api.call(CompanionEndpoints.updateForCharacter, {
                      params: { characterId },
                      body: { proactiveMessages: event.target.checked },
                    }),
                  )
                }
              />
              主动消息
            </label>
            {companion.data.proactiveMessages !== false && (
              <label>
                主动消息频率
                <select
                  disabled={pending}
                  value={companion.data.proactiveFrequency ?? 'medium'}
                  onChange={(event) =>
                    void change(() =>
                      api.call(CompanionEndpoints.updateForCharacter, {
                        params: { characterId },
                        body: {
                          proactiveFrequency: event.target.value as 'low' | 'medium' | 'high',
                        },
                      }),
                    )
                  }
                >
                  <option value="low">少（每天最多 1 次）</option>
                  <option value="medium">适中（默认）</option>
                  <option value="high">多</option>
                </select>
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={companion.data.proactiveCalls ?? false}
                disabled={pending}
                onChange={(event) =>
                  void change(() =>
                    api.call(CompanionEndpoints.updateForCharacter, {
                      params: { characterId },
                      body: { proactiveCalls: event.target.checked },
                    }),
                  )
                }
              />
              主动来电
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={companion.data.dailyLife ?? true}
                disabled={pending}
                onChange={(event) =>
                  void change(() =>
                    api.call(CompanionEndpoints.updateForCharacter, {
                      params: { characterId },
                      body: { dailyLife: event.target.checked },
                    }),
                  )
                }
              />
              TA 的日常（推演）
            </label>
            <Link to={`/characters/${characterId}/memories`}>TA 记住了什么</Link>
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
                relationship: String(form.get('relationship') || '朋友'),
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
        <label>
          我们的关系
          <input
            name="relationship"
            maxLength={30}
            defaultValue={contact?.relationship ?? '朋友'}
            required
          />
        </label>
        <button disabled={pending}>保存称呼和关系</button>
      </form>
      {(error || companion.error) && <p role="alert">{error || companion.error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="panel rows">
        <button disabled={pending} onClick={() => setConfirmation('clear')}>
          清空聊天记录
        </button>
        <button disabled={pending} onClick={() => setConfirmation('remove')}>
          删除角色
        </button>
        <button disabled={pending} onClick={() => setConfirmation('purge')}>
          永久删除角色和数据
        </button>
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
              : confirmation === 'remove'
                ? '角色和聊天将从列表移除，30天内重新添加可恢复'
                : confirmation === 'purge'
                  ? '这会永久删除聊天记录、记忆和养成数据，无法恢复'
                  : '再次确认永久删除：重新添加也无法恢复这些数据'}
          </p>
          <button
            disabled={pending}
            onClick={() => {
              if (confirmation === 'purge') {
                setConfirmation('purgeConfirmed');
                return;
              }
              void change(
                async () => {
                  if (confirmation === 'clear') await clearHistory(id);
                  else {
                    await api.call(ContactsEndpoints.remove, {
                      params: { characterId },
                      query: { mode: confirmation === 'remove' ? 'soft' : 'purge' },
                    });
                  }
                },
                () => {
                  setConfirmation(null);
                  if (confirmation !== 'clear') navigate('/contacts');
                },
              );
            }}
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
