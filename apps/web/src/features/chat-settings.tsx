/*
 * 聊天信息页（docs/refactor/06-old-ui-spec.md 4.5）：旧版行样式 + 新版条目（导航树 1.2）。
 * 成员区 → 查找聊天记录 → 免打扰 / 置顶 → 聊天模型 → 和 TA 一起用 → 和 TA 的相处 → 高级 → 背景 → 清空。
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
import { OldIcon } from './old-icons.js';
import {
  ActionSheet,
  GroupHeader,
  MenuGroup,
  MenuRow,
  NavBar,
  Sheet,
  SwitchRow,
} from './shell-kit.js';
import { Dialog, showToast } from './toast.js';

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
  const override = useRemote(ModelAccessEndpoints.getCharacterOverride, {
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
  const [sheet, setSheet] = useState<'fit' | 'proactive' | 'relationship' | null>(null);
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
  const updateRelationship = (relationship: string) =>
    void change(
      () =>
        api.call(ContactsEndpoints.update, {
          params: { characterId },
          body: { relationship },
        }),
      () => setSheet(null),
      '已保存',
    );
  const data = companion.data;
  const modelName = override.data?.chat
    ? (models.data?.items.find((m) => m.modelKey === override.data?.chat?.modelKey)?.displayName ??
      override.data.chat.modelKey.split('/').pop())
    : '跟随默认';
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
      {data && (
        <>
          <GroupHeader>聊天模型</GroupHeader>
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
              label="拆条"
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
            <MenuRow
              label="主动消息"
              value={
                globalOff
                  ? '已全局关闭'
                  : data.proactiveMessages === false
                    ? '关闭'
                    : (frequencyNames[data.proactiveFrequency ?? 'medium'] ?? '适中').replace(
                        /（.*）/,
                        '',
                      )
              }
              onClick={() => setSheet('proactive')}
            />
            <MenuRow
              label="关系类型"
              value={contact?.relationship || '朋友'}
              onClick={() => setSheet('relationship')}
            />
            <SwitchRow
              label="TA 的日常"
              subtitle="TA 会有自己的生活节奏（推演）"
              checked={switchValues.dailyLife ?? data.dailyLife ?? true}
              disabled={!!switchBusy.dailyLife}
              onChange={(dailyLife) =>
                void toggle('dailyLife', dailyLife, () =>
                  api.call(CompanionEndpoints.updateForCharacter, {
                    params: { characterId },
                    body: { dailyLife },
                  }),
                )
              }
            />
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
        <MenuRow label="设置当前聊天背景" onClick={() => showToast('暂未开放', 2000, 'info')} />
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
      {(error || companion.error) && (
        <p role="alert" className="notice-bar">
          {error || companion.error}
        </p>
      )}
      {sheet === 'fit' && data && (
        <ActionSheet
          title="人设贴合度：越贴合越像原角色，越顺从越听你的"
          onClose={() => setSheet(null)}
          items={fitNames.map((name, index) => ({
            label: `${name}${(data.personaFit ?? 3) === index + 1 ? ' ✓' : ''}`,
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
      {sheet === 'relationship' && (
        <FieldSheet
          title="关系类型"
          initial={contact?.relationship ?? '朋友'}
          maxLength={30}
          required
          pending={pending}
          onClose={() => setSheet(null)}
          onSave={(value) => updateRelationship(value || '朋友')}
        />
      )}
      {confirmation === 'clear' && (
        <ActionSheet
          title="只清空聊天记录显示，TA的记忆和养成数据会保留"
          onClose={() => setConfirmation(null)}
          items={[
            {
              label: '清空聊天记录',
              danger: true,
              onClick: () => void change(() => clearHistory(id), undefined, '已清空'),
            },
          ]}
        />
      )}
      {confirmation && confirmation !== 'clear' && (
        <Dialog
          title={confirmation === 'remove' ? '删除角色' : '永久删除'}
          actions={[
            { label: '取消', onClick: () => setConfirmation(null) },
            {
              label: '删除',
              danger: true,
              onClick: () => {
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
              },
            },
          ]}
        >
          <p>
            {confirmation === 'remove'
              ? '角色和聊天将从列表移除，30天内重新添加可恢复'
              : confirmation === 'purge'
                ? '这会永久删除聊天记录、记忆和养成数据，无法恢复'
                : '再次确认永久删除：重新添加也无法恢复这些数据'}
          </p>
        </Dialog>
      )}
    </main>
  );
}

/** 单个文字字段的编辑弹层（顶部「取消 / 完成」，规格 4.14）。 */
export function FieldSheet({
  title,
  initial,
  maxLength,
  required = false,
  pending = false,
  placeholder,
  onClose,
  onSave,
}: {
  title: string;
  initial: string;
  maxLength: number;
  required?: boolean;
  pending?: boolean;
  placeholder?: string;
  onClose(): void;
  onSave(value: string): void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Sheet
      title={title}
      onClose={onClose}
      closeLabel="取消"
      action={
        <button
          type="button"
          className="small-primary primary"
          disabled={pending || (required && !value.trim())}
          onClick={() => onSave(value.trim())}
        >
          完成
        </button>
      }
    >
      <div className="field-sheet">
        <input
          autoFocus
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !(required && !value.trim())) onSave(value.trim());
          }}
        />
        <small>
          {Array.from(value).length}/{maxLength}
        </small>
      </div>
    </Sheet>
  );
}
