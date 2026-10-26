/*
 * 聊天信息页（docs/refactor/06-old-ui-spec.md 4.5）：旧版行样式 + 新版条目（导航树 1.2）。
 * 成员区 → 查找聊天记录 → 免打扰 / 置顶 → 聊天模型 → 和 TA 的相处 → 高级 → 背景 → 清空。
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChatEndpoints,
  CompanionEndpoints,
  ContactsEndpoints,
  IdentityEndpoints,
  ModelAccessEndpoints,
  QuietStateEndpoints,
} from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { CharacterName } from './chat.js';
import { CharacterAvatar } from './character-avatar.js';
import { useCallEntry } from './call.js';
import { VoiceRow } from './voices.js';
import { PlazaPublishRow } from './plaza.js';
import { EcologyCharacterRow } from './murmurs.js';
import { OldIcon } from './old-icons.js';
import {
  ActionSheet,
  GroupHeader,
  MenuGroup,
  MenuRow,
  NavBar,
  Sheet,
  SwitchRow,
  SyncPendingState,
} from './shell-kit.js';
import { AlertDialog, showToast } from './toast.js';

const fitNames = ['极顺从', '顺从', '均衡', '贴合', '极贴合'];
const frequencyNames: Record<string, string> = {
  low: '少（每天最多 1 次）',
  medium: '适中（默认）',
  high: '多',
};

export function ChatSettingsPage() {
  const { conversationId = '' } = useParams();
  const { state } = useChat();
  const conversation = state.conversations.find((item) => item.conversationId === conversationId);
  const role = conversation?.participants.find((item) => item.kind === 'character');
  // 深链接或刷新时本地同步还没跑完，先给加载态，避免误报「会话不存在」
  if (!conversation && !state.initialized)
    return (
      <main>
        <NavBar title="聊天信息" fallback="/chat" />
        <SyncPendingState icon="wechat/chat" label="正在读取会话…" />
      </main>
    );
  if (!conversation || !role)
    return (
      <main>
        <NavBar title="聊天信息" fallback="/chat" />
        <p className="empty">会话不存在或已被删除</p>
      </main>
    );
  return <Settings key={conversationId} id={conversationId} characterId={role.refId} />;
}

function Settings({ id, characterId }: { id: string; characterId: string }) {
  const { state, clearHistory, synchronize, assertOwner } = useChat();
  const conversation = state.conversations.find((item) => item.conversationId === id)!;
  const contact = state.contacts.find((item) => item.characterId === characterId);
  const models = useRemote(ModelAccessEndpoints.listModels);
  const scenarios = useRemote(ModelAccessEndpoints.getCharacterScenarios, {
    params: { characterId },
  });
  const companion = useRemote(CompanionEndpoints.getForCharacter, { params: { characterId } });
  const notification = useRemote(IdentityEndpoints.getNotificationSettings);
  const globalOff = notification.data?.proactiveMessagesEnabled === false;
  const callEntry = useCallEntry(characterId);
  const quiet = useRemote(QuietStateEndpoints.get, { networkOnly: true });
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [switchBusy, setSwitchBusy] = useState<Record<string, boolean>>({});
  const [switchValues, setSwitchValues] = useState<Record<string, boolean>>({});
  async function toggle(key: string, value: boolean, operation: () => Promise<unknown>) {
    if (switchBusy[key]) return;
    const had = Object.hasOwn(switchValues, key);
    const before = switchValues[key];
    setSwitchBusy((items) => ({ ...items, [key]: true }));
    setSwitchValues((items) => ({ ...items, [key]: value }));
    setError('');
    try {
      assertOwner();
      await operation();
    } catch (e) {
      setSwitchValues((items) => {
        const next = { ...items };
        if (had) next[key] = before!;
        else delete next[key];
        return next;
      });
      setError(friendlyError(e));
    } finally {
      setSwitchBusy((items) => ({ ...items, [key]: false }));
    }
  }
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<'fit' | 'proactive' | null>(null);
  const [confirmation, setConfirmation] = useState<
    'clear' | 'remove' | 'purge' | 'purgeConfirmed' | null
  >(null);
  async function change(operation: () => Promise<unknown>, after?: () => void, success?: string) {
    setPending(true);
    setError('');
    try {
      assertOwner();
      await operation();
      await synchronize();
      if (success) showToast(success, 2000, 'success');
      companion.refresh();
      after?.();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  const updateCompanion = (body: Record<string, unknown>, success?: string) =>
    void change(
      () => api.call(CompanionEndpoints.updateForCharacter, { params: { characterId }, body }),
      undefined,
      success,
    );
  const data = companion.data;
  // 3.22：显示该角色「文本聊天」实际用的模型（单独指定或跟随场景设置）。
  const ownChat = scenarios.data?.scenarios.find((s) => s.scenario === 'chat');
  const chatKey = ownChat?.selection?.modelKey ?? ownChat?.effective?.modelKey;
  const modelName = chatKey
    ? `${models.data?.items.find((m) => m.modelKey === chatKey)?.displayName ?? chatKey.split('/').pop()}${ownChat?.selection ? '' : '（跟随）'}`
    : '未配置';
  return (
    <main className="chat-info-page">
      <NavBar title="聊天信息" fallback={`/chat/${id}`} />
      <div className="member-panel">
        <Link className="member-cell" to={`/characters/${characterId}`}>
          <CharacterAvatar id={characterId} size={46} radius={6} />
          <small>
            <CharacterName id={characterId} fallback={contact?.remark} />
          </small>
        </Link>
        <Link className="member-cell" to={`/groups/new?with=${characterId}`} aria-label="发起群聊">
          <span className="member-action">
            <OldIcon name="wechat/add" size={26} />
          </span>
          <small>添加</small>
        </Link>
      </div>
      <MenuGroup>
        <MenuRow to={`/chat/${id}/search`} label="查找聊天记录" />
      </MenuGroup>
      <MenuGroup>
        <SwitchRow
          label="消息免打扰"
          checked={switchValues.muted ?? conversation.state.muted}
          disabled={!!switchBusy.muted}
          onChange={(muted) =>
            void toggle('muted', muted, () =>
              api.call(ChatEndpoints.updateState, {
                params: { conversationId: id },
                body: { muted },
              }),
            )
          }
        />
        <SwitchRow
          label="置顶聊天"
          checked={switchValues.pinned ?? conversation.state.pinned}
          disabled={!!switchBusy.pinned}
          onChange={(pinned) =>
            void toggle('pinned', pinned, () =>
              api.call(ChatEndpoints.updateState, {
                params: { conversationId: id },
                body: { pinned },
              }),
            )
          }
        />
      </MenuGroup>
      {companion.loading && !data && (
        <MenuGroup>
          <div className="menu-pad stack" role="status" aria-label="正在读取聊天设置">
            <div className="skeleton-row" />
            <div className="skeleton-row" />
            <div className="skeleton-row" />
          </div>
        </MenuGroup>
      )}
      {companion.error && (
        <div className="notice-bar" role="alert">
          <p>{companion.error}</p>
          <button className="text-button" onClick={companion.refresh}>
            重试聊天设置
          </button>
        </div>
      )}
      {data && (
        <>
          <GroupHeader>模型</GroupHeader>
          <MenuGroup>
            <MenuRow
              to={`/characters/${characterId}/model`}
              label="TA 用的模型"
              value={modelName}
            />
          </MenuGroup>
          <GroupHeader>和 TA 的相处</GroupHeader>
          <MenuGroup>
            <MenuRow
              label="人设贴合度"
              value={fitNames[(data.personaFit ?? 3) - 1]}
              onClick={() => setSheet('fit')}
            />
            <SwitchRow
              label="秒回"
              checked={switchValues.instantReply ?? data.instantReply}
              disabled={!!switchBusy.instantReply}
              onChange={(instantReply) =>
                void toggle('instantReply', instantReply, () =>
                  api.call(CompanionEndpoints.updateForCharacter, {
                    params: { characterId },
                    body: { instantReply },
                  }),
                )
              }
            />
            <SwitchRow
              label="消息拆分"
              subtitle="一次回复拆成几条，一句一个气泡"
              checked={switchValues.splitBubbles ?? data.splitBubbles}
              disabled={!!switchBusy.splitBubbles}
              onChange={(splitBubbles) =>
                void toggle('splitBubbles', splitBubbles, () =>
                  api.call(CompanionEndpoints.updateForCharacter, {
                    params: { characterId },
                    body: { splitBubbles },
                  }),
                )
              }
            />
            {/* v5 角色生态（批 C）：原「主动消息」「TA 的日常」由角色生态的角色开关代替（17 号 §1）。 */}
            <EcologyCharacterRow characterId={characterId} />
          </MenuGroup>
          <GroupHeader>高级</GroupHeader>
          <MenuGroup>
            <VoiceRow characterId={characterId} voiceId={data.voiceId ?? null} />
            <MenuRow to={`/characters/${characterId}/supplement`} label="我的补充设定" />
            <PlazaPublishRow characterId={characterId} />
          </MenuGroup>
        </>
      )}
      <MenuGroup>
        <MenuRow to={`/chat/${id}/background`} label="设置当前聊天背景" />
      </MenuGroup>
      <MenuGroup>
        <MenuRow
          label="清空聊天记录"
          danger
          chevron={false}
          center
          disabled={pending}
          onClick={() => setConfirmation('clear')}
        />
      </MenuGroup>
      <MenuGroup>
        <MenuRow
          label="删除角色"
          danger
          chevron={false}
          center
          disabled={pending}
          onClick={() => setConfirmation('remove')}
        />
        <MenuRow
          label="永久删除角色和数据"
          danger
          chevron={false}
          center
          disabled={pending}
          onClick={() => setConfirmation('purge')}
        />
      </MenuGroup>
      {error && (
        <p role="alert" className="notice-bar">
          {error}
        </p>
      )}
      {sheet === 'fit' && data && (
        <ActionSheet
          title="人设贴合度：越贴合越像原角色，越顺从越听你的"
          onClose={() => setSheet(null)}
          items={fitNames.map((name, index) => ({
            label: name,
            checked: (data.personaFit ?? 3) === index + 1,
            onClick: () => updateCompanion({ personaFit: index + 1 }),
          }))}
        />
      )}
      {sheet === 'proactive' && data && (
        <Sheet title="主动消息" onClose={() => setSheet(null)} closeLabel="完成">
          <MenuGroup>
            <SwitchRow
              label="TA 主动找我"
              subtitle={globalOff ? '已在 服务 › 主动消息与免打扰 中关闭' : undefined}
              checked={
                !globalOff && (switchValues.proactiveMessages ?? data.proactiveMessages ?? true)
              }
              disabled={!!switchBusy.proactiveMessages || globalOff}
              onChange={(proactiveMessages) =>
                void toggle('proactiveMessages', proactiveMessages, () =>
                  api.call(CompanionEndpoints.updateForCharacter, {
                    params: { characterId },
                    body: { proactiveMessages },
                  }),
                )
              }
            />
          </MenuGroup>
          {!globalOff && (switchValues.proactiveMessages ?? data.proactiveMessages) !== false && (
            <>
              <GroupHeader>频率</GroupHeader>
              <MenuGroup>
                {(['low', 'medium', 'high'] as const).map((value) => (
                  <MenuRow
                    key={value}
                    label={frequencyNames[value]}
                    chevron={false}
                    right={
                      (data.proactiveFrequency ?? 'medium') === value ? (
                        <OldIcon name="wechat/check" size={22} className="ink-brand" />
                      ) : undefined
                    }
                    onClick={() =>
                      updateCompanion({ proactiveFrequency: value }, '下一次主动消息开始生效')
                    }
                  />
                ))}
              </MenuGroup>
            </>
          )}
          {callEntry && (
            <MenuGroup>
              <SwitchRow
                label="TA 给我打电话"
                checked={
                  notification.data?.proactiveCallsEnabled !== false &&
                  (switchValues.proactiveCalls ?? data.proactiveCalls ?? false)
                }
                disabled={
                  !!switchBusy.proactiveCalls || notification.data?.proactiveCallsEnabled === false
                }
                onChange={(proactiveCalls) =>
                  void toggle('proactiveCalls', proactiveCalls, () =>
                    api.call(CompanionEndpoints.updateForCharacter, {
                      params: { characterId },
                      body: { proactiveCalls },
                    }),
                  )
                }
              />
            </MenuGroup>
          )}
          {callEntry &&
            quiet.data?.inconvenientUntil &&
            new Date(quiet.data.inconvenientUntil).getTime() > Date.now() && (
              <p className="hint">
                你说过现在不方便，
                {new Date(quiet.data.inconvenientUntil).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                前 TA 不会打电话、不发语音
              </p>
            )}
          {globalOff && (
            <p className="hint">
              <Link to="/services/proactive">去设置 ›</Link>
            </p>
          )}
        </Sheet>
      )}
      {/* U2：清空记录、删除角色都不可撤销 → Alert Dialog（红字主按钮写清后果，点蒙层不关） */}
      {confirmation === 'clear' && (
        <AlertDialog
          title="清空聊天记录？"
          message="只清空聊天记录显示，TA 的记忆和养成数据会保留。清空后不能恢复。"
          confirmLabel="清空聊天记录"
          pending={pending}
          onCancel={() => setConfirmation(null)}
          onConfirm={() =>
            void change(
              () => clearHistory(id),
              () => setConfirmation(null),
              '已清空',
            )
          }
        />
      )}
      {confirmation && confirmation !== 'clear' && (
        <AlertDialog
          title={
            confirmation === 'remove'
              ? '删除角色？'
              : confirmation === 'purge'
                ? '永久删除角色和数据？'
                : '再次确认永久删除'
          }
          message={
            confirmation === 'remove'
              ? '角色和聊天将从列表移除，30 天内重新添加可恢复。'
              : confirmation === 'purge'
                ? '这会永久删除聊天记录、记忆和养成数据，无法恢复。'
                : '重新添加也无法恢复这些数据。'
          }
          confirmLabel={
            confirmation === 'remove' ? '删除角色' : confirmation === 'purge' ? '继续' : '永久删除'
          }
          pending={pending}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            if (confirmation === 'purge') {
              setConfirmation('purgeConfirmed');
              return;
            }
            void change(
              () =>
                api.call(ContactsEndpoints.remove, {
                  params: { characterId },
                  query: { mode: confirmation === 'remove' ? 'soft' : 'purge' },
                }),
              () => {
                setConfirmation(null);
                navigate('/contacts');
              },
            );
          }}
        />
      )}
    </main>
  );
}
