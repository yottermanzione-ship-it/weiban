import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Keyboard,
  Microphone,
  Smiley,
  PlusCircle,
  Image as ImageIcon,
  Camera,
  Phone,
} from '@phosphor-icons/react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  ChatActionEndpoints,
  ChatEndpoints,
  IdentityEndpoints,
  CharacterEndpoints,
  ModelAccessEndpoints,
  MEDIA_LIMITS,
  type Conversation,
  type UserSendableContent,
  type Message,
  type Participant,
} from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { useCharacterNames } from '../data/character-names.js';
import { VirtualList } from './virtual-list.js';
import { HomeScreenGuide } from './home-screen-guide.js';
import { CharacterAvatar } from './character-avatar.js';
import { UserAvatar } from './user-avatar.js';
import { WhileAwayCard, useWhileAway } from './while-away.js';
import {
  CallRecordBubble,
  HoldToTalk,
  ImageBubble,
  ImageViewer,
  LinkCardBubble,
  Linkified,
  LocalImageBubble,
  StickerBubble,
  StickerPanel,
  VoiceBubble,
  addFavorite,
  addToStickers,
  callRecordText,
  useTranscriptUnavailableNotice,
  voicePlayer,
  type RecordResult,
} from './media.js';
import { useCall, useCallEntry } from './call.js';
import { Dialog, showToast } from './toast.js';
import { prepareImage, uploadMedia } from '../data/upload.js';
import { ApiFailure } from '@weiban/client-core';
interface Upload {
  localId: string;
  kind: 'image' | 'voice';
  blob: Blob;
  url?: string;
  width: number | null;
  height: number | null;
  durationMs?: number;
  progress: number;
  failed: boolean;
}
export function CharacterName({ id, fallback }: { id: string; fallback?: string | null }) {
  const profile = useRemote(CharacterEndpoints.getProfile, { params: { characterId: id } });
  return <>{fallback || profile.data?.name || '角色'}</>;
}
/** 群里的角色成员（不含已退出的）。 */
export function groupMembers(conversation: Conversation): Participant[] {
  return conversation.participants.filter((item) => item.kind === 'character');
}
export function Name({ conversation }: { conversation: Conversation }) {
  const { state } = useChat();
  const members = groupMembers(conversation);
  const names = useCharacterNames(
    conversation.type === 'group' && !conversation.title ? members.map((m) => m.refId) : [],
  );
  const role = members[0];
  if (conversation.title)
    return (
      <>
        {conversation.title}
        {conversation.type === 'group' ? `（${members.length + 1}）` : ''}
      </>
    );
  if (conversation.type === 'group')
    return (
      <>
        {members
          .map(
            (m) =>
              state.contacts.find((c) => c.characterId === m.refId)?.remark ||
              names[m.refId] ||
              '角色',
          )
          .join('、')}
        （{members.length + 1}）
      </>
    );
  return role ? (
    <CharacterName
      id={role.refId}
      fallback={state.contacts.find((item) => item.characterId === role.refId)?.remark}
    />
  ) : (
    <>会话</>
  );
}

const modeNames: Record<string, string> = {
  daily: '日常',
  tsundere: '傲娇',
  romance: '恋爱',
  adult: '成人',
};
function systemText(code: string, params: Record<string, string | number | boolean>): string {
  const p = (key: string) => String(params[key] ?? '');
  switch (code) {
    case 'contact_accepted':
      return '已通过好友申请，现在可以开始聊天了';
    case 'scenario_mode_changed':
      if (params.reason === 'adult_mode_unavailable') return '成人模式已不可用，已回到日常模式';
      return `已切换到${modeNames[p('mode')] ?? '日常'}模式`;
    case 'scenario_mode_switched':
      if (params.reason === 'member_not_eligible') return '有新成员加入，群聊已回到日常模式';
      return `已切换到${modeNames[p('mode')] ?? '日常'}模式`;
    case 'group_created':
      return `你邀请 ${p('names')} 加入了群聊`;
    case 'group_invited_by_character':
      return `${p('name')} 邀请你和 ${p('names')} 加入了群聊`;
    case 'member_joined':
      return params.byName
        ? `${p('byName')} 邀请 ${p('names')} 加入了群聊`
        : `你邀请 ${p('names')} 加入了群聊`;
    case 'member_removed':
      return `你将 ${p('name')} 移出了群聊`;
    case 'member_left':
      return `${p('name')} 退出了群聊`;
    case 'group_renamed':
      if (params.reset) return params.byName ? `${p('byName')} 恢复了默认群名` : '你恢复了默认群名';
      return params.byName
        ? `${p('byName')} 修改群名为「${p('title')}」`
        : `你修改群名为「${p('title')}」`;
    case 'group_dissolved':
      return '群聊已解散';
    default:
      return '会话提示';
  }
}
export function content(message: Message): string {
  if (message.status === 'recalled') return '这条消息已撤回';
  switch (message.content?.type) {
    case 'text':
      return message.content.text;
    case 'nudge':
      return '拍了拍';
    case 'system':
      return systemText(message.content.code, message.content.params);
    case 'contact_card':
      return `[名片] ${message.content.name}`;
    case 'action_card':
      return message.content.text;
    case 'image':
      return '[图片]';
    case 'voice':
      return `[语音] ${Math.max(1, Math.round(message.content.durationMs / 1000))}″`;
    case 'sticker':
      return '[表情]';
    case 'link':
      return `[链接] ${message.content.title}`;
    case 'call_record':
      return `[语音通话] ${callRecordText(message.content)}`;
    default:
      return '当前版本不支持此消息';
  }
}

/** 名片消息（C 4.2）：点开是资料页，添加时带推荐人。 */
function ContactCardBubble({
  content: card,
}: {
  content: Extract<Message['content'], { type: 'contact_card' }>;
}) {
  return (
    <Link
      className="contact-card"
      to={`/characters/${card.characterId}?ref=${card.recommenderCharacterId}`}
    >
      <CharacterAvatar id={card.characterId} size={40} />
      <span>
        <strong>{card.name}</strong>
        <small>个人名片</small>
      </span>
    </Link>
  );
}

/** 带按钮的卡片（ADR-0026）：只能点一次。 */
function ActionCardBubble({
  message,
  onChosen,
}: {
  message: Message;
  onChosen(message: Message): void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (message.content?.type !== 'action_card') return null;
  const chosen = message.actionChoice?.actionId;
  return (
    <div className="action-card">
      <p>{message.content.text}</p>
      <div className="button-row">
        {message.content.actions.map((action) => (
          <button
            key={action.actionId}
            className={action.style === 'primary' ? 'primary' : ''}
            disabled={pending || !!chosen}
            aria-pressed={chosen === action.actionId}
            onClick={() => {
              setPending(true);
              setError('');
              void api
                .call(ChatActionEndpoints.chooseMessageAction, {
                  params: { conversationId: message.conversationId, messageId: message.messageId },
                  body: { actionId: action.actionId },
                })
                .then(onChosen)
                .catch((e) => setError(friendlyError(e)))
                .finally(() => setPending(false));
            }}
          >
            {chosen === action.actionId ? `已选择：${action.label}` : action.label}
          </button>
        ))}
      </div>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}

export function ConversationPage() {
  const { conversationId = '' } = useParams();
  const chat = useChat();
  const { focus } = chat;
  const conversation = chat.state.conversations.find(
    (item) => item.conversationId === conversationId,
  );
  useEffect(() => {
    focus(conversationId);
    return () => focus(null);
  }, [conversationId, focus]);
  if (!conversation || (conversation.type === 'group' && conversation.state.hidden))
    return (
      <main>
        <Link to="/chat">返回微伴</Link>
        <p role="status" className="empty">
          {!chat.state.initialized
            ? '正在打开聊天…'
            : conversation
              ? '这个群聊已解散'
              : '会话不存在或已被删除'}
        </p>
      </main>
    );
  return <ConversationView key={conversationId} conversation={conversation} />;
}
function ConversationView({ conversation }: { conversation: Conversation }) {
  const chat = useChat();
  const id = conversation.conversationId;
  const group = conversation.type === 'group';
  const userProfile = useRemote(IdentityEndpoints.getProfile);
  const members = groupMembers(conversation);
  const role = members[0];
  const everyone = [
    ...conversation.participants,
    ...(conversation.group?.formerParticipants ?? []),
  ];
  const memberNames = useCharacterNames(
    group ? everyone.filter((p) => p.kind === 'character').map((p) => p.refId) : [],
  );
  const displayName = (characterId: string) =>
    chat.state.contacts.find((c) => c.characterId === characterId)?.remark ||
    memberNames[characterId] ||
    '角色';
  const status = useRemote(ModelAccessEndpoints.getModelStatus, {
    query: { characterId: group ? undefined : role?.refId },
  });
  const location = useLocation();
  const prefill = (location.state as { prefill?: string } | null)?.prefill;
  const [text, setText] = useState(prefill ?? '');
  const [mentions, setMentions] = useState<Array<{ participantId: string; name: string }>>([]);
  const [picking, setPicking] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Message>>({});
  const input = useRef<HTMLInputElement>(null);
  const whileAway = useWhileAway(id, group ? undefined : role?.refId);
  const [awayOpen, setAwayOpen] = useState<boolean | null>(null);
  const cardOpen = awayOpen ?? whileAway.autoOpen;
  const { markShown } = whileAway;
  useEffect(() => {
    if (whileAway.data && cardOpen) markShown();
  }, [whileAway.data, cardOpen, markShown]);
  useEffect(() => {
    if (prefill) input.current?.focus();
  }, [prefill]);
  useUpdates((update) => {
    if (update.type !== 'message.updated') return;
    const message = (update.data as { message?: Message } | undefined)?.message;
    if (message?.conversationId === id)
      setOverrides((o) => ({ ...o, [message.messageId]: message }));
  });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [older, setOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const callEntry = useCallEntry(group ? undefined : role?.refId);
  const { start: startCall } = useCall();
  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [panel, setPanel] = useState<'none' | 'sticker' | 'plus'>('none');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [viewer, setViewer] = useState<number | null>(null);
  const [textShown, setTextShown] = useState<Record<string, boolean>>({});
  const [micDenied, setMicDenied] = useState(false);
  const albumInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => voicePlayer.stop(), []);
  const messages = chat.state.messages
    .filter((item) => item.conversationId === id)
    .map((item) => overrides[item.messageId] ?? item)
    .sort((a, b) => a.seq - b.seq);
  const pending = chat.state.outbox.filter((item) => item.conversationId === id);
  const images = messages.filter((m) => m.status === 'normal' && m.content?.type === 'image');
  const next = (messageId: string) => {
    const index = messages.findIndex((m) => m.messageId === messageId);
    return index >= 0 ? messages[index + 1] : undefined;
  };
  const myVoiceIds = useMemo(
    () =>
      new Set(
        chat.state.messages
          .filter((m) => m.conversationId === id && m.senderKind === 'user')
          .flatMap((m) => (m.content?.type === 'voice' ? [m.content.mediaId] : [])),
      ),
    [chat.state.messages, id],
  );
  useTranscriptUnavailableNotice(myVoiceIds);
  function patchUpload(localId: string, changes: Partial<Upload>) {
    setUploads((list) => list.map((u) => (u.localId === localId ? { ...u, ...changes } : u)));
  }
  function dropUpload(upload: Upload) {
    if (upload.url) URL.revokeObjectURL(upload.url);
    setUploads((list) => list.filter((u) => u.localId !== upload.localId));
  }
  async function runUpload(upload: Upload) {
    patchUpload(upload.localId, { failed: false, progress: 0 });
    try {
      const media = await uploadMedia(
        upload.kind === 'image' ? 'chat_image' : 'chat_voice',
        upload.blob,
        {
          durationMs: upload.durationMs,
          onProgress: (progress) => patchUpload(upload.localId, { progress }),
        },
      );
      const body: UserSendableContent =
        upload.kind === 'image'
          ? {
              type: 'image',
              mediaId: media.mediaId,
              width: media.width ?? upload.width,
              height: media.height ?? upload.height,
            }
          : {
              type: 'voice',
              mediaId: media.mediaId,
              durationMs: Math.round(upload.durationMs ?? 1000),
              transcript: null,
            };
      await chat.sendContent(id, body);
      dropUpload(upload);
    } catch (e) {
      if (e instanceof ApiFailure && e.status >= 400 && e.status < 500 && e.status !== 401) {
        showToast(upload.kind === 'image' ? '这张图片无法发送' : friendlyError(e));
        dropUpload(upload);
      } else patchUpload(upload.localId, { failed: true });
    }
  }
  async function pickImages(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].slice(0, 9);
    event.target.value = '';
    setPanel('none');
    const prepared: Upload[] = [];
    for (const file of files) {
      if (!(MEDIA_LIMITS.imageMimeTypes as readonly string[]).includes(file.type)) {
        showToast('这张图片无法发送');
        continue;
      }
      const image = await prepareImage(file);
      if (image.blob.size > MEDIA_LIMITS.imageMaxBytes) {
        showToast('这张图片无法发送');
        continue;
      }
      prepared.push({
        localId: crypto.randomUUID(),
        kind: 'image',
        blob: image.blob,
        url: URL.createObjectURL(image.blob),
        width: image.width,
        height: image.height,
        progress: 0,
        failed: false,
      });
    }
    setUploads((list) => [...list, ...prepared]);
    for (const upload of prepared) await runUpload(upload);
  }
  function sendVoice(result: RecordResult) {
    if (result.blob.size > MEDIA_LIMITS.voiceMaxBytes) {
      showToast('语音太长，无法发送');
      return;
    }
    const upload: Upload = {
      localId: crypto.randomUUID(),
      kind: 'voice',
      blob: result.blob,
      width: null,
      height: null,
      durationMs: result.durationMs,
      progress: 0,
      failed: false,
    };
    setUploads((list) => [...list, upload]);
    void runUpload(upload);
  }
  function bubble(message: Message) {
    const c = message.content;
    if (message.status !== 'normal' || !c)
      return <p className="message-bubble">{content(message)}</p>;
    switch (c.type) {
      case 'contact_card':
        return <ContactCardBubble content={c} />;
      case 'action_card':
        return (
          <ActionCardBubble
            message={message}
            onChosen={(chosen) => setOverrides((o) => ({ ...o, [chosen.messageId]: chosen }))}
          />
        );
      case 'image':
        return (
          <ImageBubble
            content={c}
            onOpen={() => setViewer(images.findIndex((m) => m.messageId === message.messageId))}
          />
        );
      case 'voice':
        return (
          <VoiceBubble message={message} next={next} showText={!!textShown[message.messageId]} />
        );
      case 'sticker':
        return <StickerBubble content={c} />;
      case 'link':
        return <LinkCardBubble content={c} />;
      case 'call_record':
        return (
          <CallRecordBubble
            content={c}
            name={role ? displayName(role.refId) : undefined}
            onRedial={!group && role && callEntry ? () => startCall(role.refId) : undefined}
          />
        );
      case 'text':
        return (
          <p className="message-bubble">
            <Linkified text={c.text} />
          </p>
        );
      default:
        return <p className="message-bubble">{content(message)}</p>;
    }
  }
  const quote =
    messages.find((item) => item.messageId === quoteId && item.status === 'normal') ?? null;
  const lastVisibleSeq = messages.at(-1)?.seq ?? 0;
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const typingNames = Object.entries(chat.typing)
    .filter(([key, expiry]) => key.startsWith(`${id}:`) && expiry > Date.now())
    .map(([key]) => {
      const participant = everyone.find((p) => p.participantId === key.slice(id.length + 1));
      return participant ? displayName(participant.refId) : '';
    });
  useEffect(() => {
    if (!visible || !atBottom || lastVisibleSeq < 1 || conversation.state.readSeq >= lastVisibleSeq)
      return;
    void api
      .call(ChatEndpoints.markRead, {
        params: { conversationId: id },
        body: { readSeq: lastVisibleSeq },
      })
      .catch(() => {});
  }, [id, lastVisibleSeq, conversation.state.readSeq, visible, atBottom]);
  function insertMention(participant: Participant) {
    const name = displayName(participant.refId);
    setText((value) => `${value.endsWith('@') ? value.slice(0, -1) : value}@${name} `);
    setMentions((list) =>
      list.some((m) => m.participantId === participant.participantId)
        ? list
        : [...list, { participantId: participant.participantId, name }],
    );
    setPicking(false);
    input.current?.focus();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const mentioned = group
        ? mentions.filter((m) => text.includes(`@${m.name}`)).map((m) => m.participantId)
        : [];
      await chat.send(id, text, quote?.messageId, mentioned);
      setText('');
      setMentions([]);
      setQuoteId(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSending(false);
    }
  }
  async function action(message: Message, operation: 'recall' | 'hide') {
    setError('');
    try {
      await api.call(
        operation === 'recall' ? ChatEndpoints.recallMessage : ChatEndpoints.hideMessage,
        { params: { conversationId: id, messageId: message.messageId } },
      );
    } catch (e) {
      setError(friendlyError(e));
    }
  }
  const senderOf = (message: Message) =>
    everyone.find((participant) => participant.participantId === message.senderParticipantId);
  return (
    <main className="conversation-page">
      <header className="conversation-header">
        <Link to="/chat" aria-label="返回微伴">
          ‹ 微伴
        </Link>
        <h1>
          <Name conversation={conversation} />
        </h1>
        <Link to={group ? `/chat/${id}/group` : `/chat/${id}/settings`}>聊天信息</Link>
      </header>
      <HomeScreenGuide
        received={messages.some(
          (message) =>
            message.senderKind === 'character' &&
            message.status === 'normal' &&
            message.content !== null,
        )}
      />
      {conversation.contentScope === 'adult' && <p className="hint">成人模式</p>}
      {!chat.online && <p className="offline">网络暂不可用，消息保存在本机，联网后继续发送</p>}
      {status.data && !status.data.available && (
        <p className="offline">
          {status.data.reason === 'insufficient_balance'
            ? '余额不足，角色暂时无法回复'
            : '模型服务暂时不可用，角色暂时无法回复'}{' '}
          <Link to={status.data.reason === 'insufficient_balance' ? '/wallet' : '/models'}>
            去查看
          </Link>
        </p>
      )}
      {typingNames.length > 0 && status.data?.available && (
        <p role="status">
          {group ? `${typingNames.filter(Boolean).join('、')} 正在输入…` : '对方正在输入…'}
        </p>
      )}
      {(error || chat.error) && <p role="alert">{error || chat.error}</p>}
      {whileAway.data && role && !group && (
        <WhileAwayCard
          data={whileAway.data}
          open={cardOpen}
          characterId={role.refId}
          onOpenChange={setAwayOpen}
          onAsk={(value) => {
            setText(value);
            input.current?.focus();
          }}
        />
      )}
      {older && messages.length > 0 && (
        <button
          disabled={loadingOlder}
          onClick={() => {
            setLoadingOlder(true);
            void chat
              .older(id, messages[0]!.seq)
              .then(setOlder)
              .catch((e) => setError(friendlyError(e)))
              .finally(() => setLoadingOlder(false));
          }}
        >
          {loadingOlder ? '正在读取…' : '加载更早消息'}
        </button>
      )}
      <VirtualList
        items={messages}
        itemKey={(item) => item.messageId}
        label="聊天消息"
        estimate={90}
        bottom
        onBottom={setAtBottom}
        render={(message) => {
          const sender = senderOf(message);
          const senderId = sender?.refId ?? role?.refId ?? '';
          return (
            <div
              className={`message-row ${message.senderKind === 'user' && message.status === 'normal' ? 'mine' : ''} ${message.senderKind === 'system' || message.status === 'recalled' ? 'system-message' : ''}`}
            >
              <time>
                {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
              <div className="message-body">
                {message.status === 'normal' && message.senderKind === 'user' && (
                  <UserAvatar profile={userProfile.data} />
                )}
                {message.status === 'normal' && message.senderKind === 'character' && (
                  <Link
                    to={`/characters/${senderId}${group && conversation.title ? `?group=${encodeURIComponent(conversation.title)}` : ''}`}
                    aria-label="查看资料"
                  >
                    <CharacterAvatar id={senderId} size={40} />
                  </Link>
                )}
                <div className="message-details">
                  {group && message.senderKind === 'character' && message.status === 'normal' && (
                    <small className="sender-name">{displayName(senderId)}</small>
                  )}
                  {message.quote && (
                    <small className="quote-preview">
                      引用：{message.quote.preview ?? '原消息已不可见'}
                    </small>
                  )}
                  {bubble(message)}
                  {!group && message.senderKind === 'user' && message.status === 'normal' && (
                    <small>
                      {conversation.peerReadSeq !== null && conversation.peerReadSeq >= message.seq
                        ? '已读'
                        : '已送达'}
                    </small>
                  )}
                  {message.status === 'normal' &&
                    message.senderKind !== 'system' &&
                    message.content &&
                    message.content.type !== 'action_card' &&
                    message.content.type !== 'call_record' && (
                      <details>
                        <summary aria-label="消息操作">•••</summary>
                        {message.content.type === 'text' && (
                          <button onClick={() => setQuoteId(message.messageId)}>引用</button>
                        )}
                        {message.content.type === 'voice' && (
                          <button
                            onClick={() =>
                              setTextShown((v) => ({
                                ...v,
                                [message.messageId]: !v[message.messageId],
                              }))
                            }
                          >
                            {textShown[message.messageId] ? '隐藏文字' : '转文字'}
                          </button>
                        )}
                        {message.content.type === 'link' && (
                          <button
                            onClick={() => {
                              const url = (message.content as { url: string }).url;
                              void navigator.clipboard
                                ?.writeText(url)
                                .then(() => showToast('已复制'))
                                .catch(() => showToast('复制失败'));
                            }}
                          >
                            复制链接
                          </button>
                        )}
                        {['text', 'image', 'link', 'voice'].includes(message.content.type) && (
                          <button onClick={() => void addFavorite(message)}>收藏</button>
                        )}
                        {message.senderKind !== 'user' &&
                          (message.content.type === 'image' ||
                            message.content.type === 'sticker') && (
                            <button onClick={() => void addToStickers(message)}>添加到表情</button>
                          )}
                        <button onClick={() => void action(message, 'hide')}>删除</button>
                        {message.senderKind === 'user' && (
                          <button onClick={() => void action(message, 'recall')}>撤回</button>
                        )}
                      </details>
                    )}
                </div>
              </div>
            </div>
          );
        }}
      />
      {pending.map((item) => (
        <div className="pending-message" key={item.body.clientMsgId}>
          <UserAvatar profile={userProfile.data} />
          <div className="message-details">
            {item.body.content.type === 'image' ? (
              <ImageBubble content={item.body.content} />
            ) : item.body.content.type === 'sticker' ? (
              <StickerBubble content={item.body.content} />
            ) : (
              <p>
                {item.body.content.type === 'text'
                  ? item.body.content.text
                  : item.body.content.type === 'voice'
                    ? `[语音] ${Math.max(1, Math.round(item.body.content.durationMs / 1000))}″`
                    : item.body.content.type === 'link'
                      ? item.body.content.title
                      : '拍了拍'}
              </p>
            )}
            {item.state === 'failed' ? (
              <button
                onClick={() =>
                  void chat
                    .retry(id, item.body.clientMsgId)
                    .catch((e) => setError(friendlyError(e)))
                }
              >
                发送失败，点击重试
              </button>
            ) : (
              <span role="status">{item.state === 'sending' ? '发送中…' : '等待发送'}</span>
            )}
          </div>
        </div>
      ))}
      {uploads.map((upload) => (
        <div className="pending-message upload-message" key={upload.localId}>
          <UserAvatar profile={userProfile.data} />
          <div className="message-details">
            {upload.kind === 'image' && upload.url ? (
              <LocalImageBubble
                url={upload.url}
                width={upload.width}
                height={upload.height}
                progress={upload.progress}
                failed={upload.failed}
              />
            ) : (
              <p>
                [语音] {Math.max(1, Math.round((upload.durationMs ?? 0) / 1000))}″
                {!upload.failed && upload.progress < 100 && <span role="status"> 发送中…</span>}
              </p>
            )}
            {upload.failed && (
              <details className="upload-failed">
                <summary aria-label="发送失败">
                  <span className="send-failed">!</span>
                </summary>
                <button onClick={() => void runUpload(upload)}>重新发送</button>
                <button onClick={() => dropUpload(upload)}>删除</button>
              </details>
            )}
          </div>
        </div>
      ))}
      {viewer !== null && (
        <ImageViewer
          images={images}
          index={viewer}
          onClose={() => setViewer(null)}
          onDelete={(m) => void action(m, 'hide')}
        />
      )}
      {micDenied && (
        <Dialog
          title="需要麦克风权限才能发语音"
          actions={[{ label: '知道了', primary: true, onClick: () => setMicDenied(false) }]}
        >
          <p className="hint">请在浏览器地址栏左侧的网站设置里允许麦克风</p>
        </Dialog>
      )}
      {quote && (
        <div className="quote-preview">
          引用：{content(quote)} <button onClick={() => setQuoteId(null)}>取消引用</button>
        </div>
      )}
      {picking && (
        <div className="mention-sheet" role="dialog" aria-label="选择提醒的人">
          <header>
            <strong>选择提醒的人</strong>
            <button className="text-button" onClick={() => setPicking(false)}>
              关闭
            </button>
          </header>
          <div className="rows">
            {members.map((member) => (
              <button
                key={member.participantId}
                className="role-row"
                onClick={() => insertMention(member)}
              >
                <CharacterAvatar id={member.refId} size={40} />
                {displayName(member.refId)}
              </button>
            ))}
          </div>
        </div>
      )}
      <form className="message-composer" onSubmit={(event) => void submit(event)}>
        <button
          type="button"
          className="icon-button"
          aria-label={mode === 'text' ? '切换到按住说话' : '切换到键盘'}
          onClick={() => {
            setMode((m) => (m === 'text' ? 'voice' : 'text'));
            setPanel('none');
          }}
        >
          {mode === 'text' ? <Microphone size={24} /> : <Keyboard size={24} />}
        </button>
        {mode === 'voice' ? (
          <HoldToTalk onRecorded={sendVoice} onPermissionDenied={() => setMicDenied(true)} />
        ) : (
          <label>
            消息
            <input
              ref={input}
              value={text}
              maxLength={4000}
              onChange={(event) => {
                const value = event.target.value;
                setText(value);
                if (cardOpen && whileAway.data) setAwayOpen(false);
                if (group && value.endsWith('@') && value.length > text.length) {
                  if (members.length === 1) insertMention(members[0]!);
                  else if (members.length > 1) setPicking(true);
                }
              }}
              autoComplete="off"
            />
          </label>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label="表情"
          aria-pressed={panel === 'sticker'}
          onClick={() => setPanel((p) => (p === 'sticker' ? 'none' : 'sticker'))}
        >
          <Smiley size={24} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="更多功能"
          aria-pressed={panel === 'plus'}
          onClick={() => setPanel((p) => (p === 'plus' ? 'none' : 'plus'))}
        >
          <PlusCircle size={24} />
        </button>
        {mode === 'text' && (
          <button className="primary" disabled={sending || !text.trim()}>
            发送
          </button>
        )}
      </form>
      {panel === 'sticker' && (
        <StickerPanel
          onPick={(sticker) =>
            void chat
              .sendContent(id, { type: 'sticker', ...sticker })
              .catch((e) => setError(friendlyError(e)))
          }
        />
      )}
      {panel === 'plus' && (
        <div className="plus-panel">
          <button type="button" className="plus-cell" onClick={() => albumInput.current?.click()}>
            <ImageIcon size={28} />
            <small>相册</small>
          </button>
          <button type="button" className="plus-cell" onClick={() => cameraInput.current?.click()}>
            <Camera size={28} />
            <small>拍摄</small>
          </button>
          {!group && role && callEntry && (
            <button
              type="button"
              className="plus-cell"
              onClick={() => {
                setPanel('none');
                startCall(role.refId);
              }}
            >
              <Phone size={28} />
              <small>语音通话</small>
            </button>
          )}
        </div>
      )}
      <input
        ref={albumInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void pickImages(e)}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void pickImages(e)}
      />
    </main>
  );
}
