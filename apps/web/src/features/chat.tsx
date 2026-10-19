import { ChatHeading } from './chat-heading.js';
/*
 * 私聊 / 群聊页（docs/refactor/06-old-ui-spec.md 4.4）：返回键 + 未读药丸、一句一个气泡（每条带头像和尖角）、
 * 时间条（间隔 > 5 分钟）、气泡长按深色菜单、输入栏（语音 / 输入框 / 表情 / ＋ 或发送）、按住说话、
 * 「+」面板 4×2 翻页、表情面板、多选工具栏。聊天里不出现积分数（6.1）。
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DailyQuestionBubble, LetterBubble } from './play.js';
import {
  ChatActionEndpoints,
  ChatEndpoints,
  IdentityEndpoints,
  CharacterEndpoints,
  ModelAccessEndpoints,
  MediaExtraEndpoints,
  LibraryEndpoints,
  MEDIA_LIMITS,
  SHARE_IMAGE_MAX_ITEMS,
  type Conversation,
  type UserSendableContent,
  type Message,
  type Participant,
} from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useCharacterProfile } from '../data/character-profile.js';
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
  canAddToStickers,
  callRecordText,
  saveImage,
  useTranscriptUnavailableNotice,
  voicePlayer,
  type RecordResult,
} from './media.js';
import { useCall, useCallEntry } from './call.js';
import { copyText } from './copy-text.js';
import { Dialog, showToast } from './toast.js';
import { prepareImage, uploadMedia } from '../data/upload.js';
import { ApiFailure } from '@weiban/client-core';
import { SHARE_REJECT_TEXT, openShare } from './share.js';
import { familiarityNames } from './growth.js';
import { ScenarioSheet, presetNames, useCurrentPreset } from './scenario.js';
import { ChatAvatarLink } from './chat-avatar-link.js';
import { ForwardPicker, ForwardedRecordBubble } from './chat-forward.js';
import { OldIcon } from './old-icons.js';
import {
  BackArrow,
  CheckCircle,
  Sheet,
  MenuGroup,
  MenuRow,
  showComingSoon,
  useLongPress,
} from './shell-kit.js';

function BubblePress({
  children,
  onPress,
}: {
  children: ReactNode;
  onPress(target: Element, x: number): void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const handlers = useLongPress(({ x }) => {
    if (element.current) onPress(element.current, x);
  });
  return (
    <div ref={element} className="wx-msg-bubble" {...handlers}>
      {children}
    </div>
  );
}
import { dividerTime, needsDivider } from './time-format.js';
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
  const profile = useCharacterProfile(id);
  return (
    <>
      {fallback ||
        profile.data?.name ||
        (profile.loading
          ? '正在读取角色…'
          : profile.errorCode === 'not_found'
            ? '角色已删除或不可见'
            : '角色资料暂不可用')}
    </>
  );
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

function systemText(code: string, params: Record<string, string | number | boolean>): string {
  const p = (key: string) => String(params[key] ?? '');
  switch (code) {
    case 'focus_started':
      return `开始和 ${p('characterName') || 'TA'} 专注 ${p('minutes')} 分钟`;
    case 'letter_sent':
      return `已给 ${p('characterName') || 'TA'} 寄出一封信`;
    case 'wishlist_item_completed':
      return `完成了心愿「${p('title')}」${params.cardIssued ? ' · 已获得瞬间卡' : ''}`;
    case 'contact_accepted':
      return '已通过好友申请，现在可以开始聊天了';
    case 'scenario_mode_changed':
      if (params.reason === 'adult_mode_unavailable') return '私密预设已不可用，已回到日常聊天';
      return `已切换到 ${presetNames[p('mode')] ?? '日常聊天'}`;
    case 'scenario_mode_switched':
      if (params.reason === 'member_not_eligible') return '有新成员加入，群聊已回到日常聊天';
      return `已切换到 ${presetNames[p('mode')] ?? '日常聊天'}`;
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
    case 'card_obtained': {
      const serial = `No.${p('serialNo').padStart(3, '0')}`;
      switch (params.kind) {
        case 'anniversary':
          return `今天是你们认识的第 ${p('daysKnown')} 天 · 获得纪念卡 ${serial} ›`;
        case 'familiarity':
          return `获得好感度卡 ${serial} ›`;
        case 'holiday':
          return `${p('holidayName')}快乐 · 获得节日卡 ${serial} ›`;
        default:
          return `获得瞬间卡 ${serial}「${p('title')}」 ›`;
      }
    }
    case 'familiarity_level_up':
      return `你和 ${p('characterName')} 的好感度升到了 L${p('level')} ${p('levelName') || familiarityNames[Number(params.level) - 1] || ''}`;
    case 'pet_adopted':
      return `你和 ${p('characterName')} 一起领养了 ${p('petName')}`;
    case 'pet_renamed':
      return `${p('from')} 改名为 ${p('to')}`;
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
    case 'letter':
      return '[信件]';
    case 'daily_question':
      return `[每日一问] ${message.content.question}`;
    case 'forwarded_record':
      return `[聊天记录] ${message.content.title}`;
    default:
      return '当前版本不支持此消息';
  }
}

/** 名片消息（C 4.2，旧版「白卡气泡」4.4.5）：点开是资料页，添加时带推荐人。 */
function ContactCardBubble({
  content: card,
}: {
  content: Extract<Message['content'], { type: 'contact_card' }>;
}) {
  return (
    <Link
      className="wx-card"
      to={`/characters/${card.characterId}?ref=${card.recommenderCharacterId}`}
    >
      <span className="wx-card-person">
        <CharacterAvatar id={card.characterId} size={40} />
        <strong>{card.name}</strong>
      </span>
      <small className="wx-card-source">个人名片</small>
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
  const navigateTo = useNavigate();
  if (message.content?.type !== 'action_card') return null;
  const chosen = message.actionChoice?.actionId;
  return (
    <div className="wx-card action-card">
      <p className="wx-card-text">{message.content.text}</p>
      {chosen && message.content.cardKind === 'wishlist_proposal' ? (
        <div className="wx-wish-result" role="status">
          {chosen === 'add' ? '已加入' : '未加入'}
        </div>
      ) : (
        <div className="wx-card-actions">
          {message.content.actions.map((action) => (
            <button
              key={action.actionId}
              type="button"
              className={action.style === 'primary' ? 'primary' : ''}
              disabled={pending || !!chosen}
              aria-pressed={chosen === action.actionId}
              onClick={() => {
                setPending(true);
                setError('');
                void api
                  .call(ChatActionEndpoints.chooseMessageAction, {
                    params: {
                      conversationId: message.conversationId,
                      messageId: message.messageId,
                    },
                    body: { actionId: action.actionId },
                  })
                  .then((chosen) => {
                    onChosen(chosen);
                    // 角色提议一起领养（T-082）：「去看看」进入领养流程，角色已预选。
                    if (
                      message.content?.type === 'action_card' &&
                      message.content.cardKind === 'pet_proposal' &&
                      action.actionId === 'go'
                    )
                      navigateTo(`/pets/adopt?characterId=${message.content.ref?.id ?? ''}`);
                  })
                  .catch((e) => setError(friendlyError(e)))
                  .finally(() => setPending(false));
              }}
            >
              {chosen === action.actionId ? `已选择：${action.label}` : action.label}
            </button>
          ))}
        </div>
      )}
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
  // 手动「不显示该聊天」只是从列表隐藏，照常能打开；群解散时服务器发 conversation.removed，本地会话直接消失。
  if (!conversation)
    return (
      <main className="wx-chat">
        <header className="wx-chat-head">
          <Link className="wx-back" to="/chat" aria-label="返回微伴">
            <BackArrow />
          </Link>
          <ChatHeading name="聊天" active={false} group={false} typing={false} />
          <span />
        </header>
        <p role="status" className="empty">
          {!chat.state.initialized ? '正在打开聊天…' : '会话不存在、已解散或已被删除'}
        </p>
      </main>
    );
  return <ConversationView key={conversationId} conversation={conversation} />;
}

type Row =
  | { kind: 'older'; key: string }
  | { kind: 'message'; key: string; message: Message; divider: string | null }
  | { kind: 'pending'; key: string; index: number }
  | { kind: 'upload'; key: string; upload: Upload };

interface BubbleMenuItem {
  label: string;
  icon: string;
  onClick(): void;
}

/**
 * 气泡长按菜单（规格 3.8）：浅色块，两行每行 3 格；
 * 默认在气泡上方 6，空间不够时在下方 4；三角跟着手指横向位置。
 */
function BubbleMenu({
  anchor,
  x,
  items,
  onClose,
}: {
  anchor: DOMRect;
  x: number;
  items: BubbleMenuItem[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; arrow: number; below: boolean }>({
    left: -9999,
    top: -9999,
    arrow: 0,
    below: false,
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const center = Math.max(anchor.left, Math.min(anchor.right, x));
    const left = Math.max(8, Math.min(center - w / 2, window.innerWidth - w - 8));
    const aboveTop = anchor.top - h - 6 - 7;
    const below = aboveTop < 64;
    const top = below ? anchor.bottom + 4 + 7 : aboveTop;
    setPlace({ left, top, arrow: Math.max(12, Math.min(w - 12, center - left)), below });
  }, [anchor, x]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const rows: BubbleMenuItem[][] = [];
  for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3));
  return (
    <div className="pop-scrim" onClick={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={ref}
        className={`bubble-menu ${place.below ? 'below' : ''}`}
        role="menu"
        style={{ left: place.left, top: place.top }}
        onClick={(event) => event.stopPropagation()}
      >
        {rows.map((row, index) => (
          <div className="bubble-menu-row" key={index}>
            {row.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  item.onClick();
                }}
              >
                {item.icon === 'smile-plus' ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
                    <circle
                      cx="10"
                      cy="10"
                      r="7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    />
                    <circle cx="7.5" cy="8.5" r=".9" />
                    <circle cx="12.5" cy="8.5" r=".9" />
                    <path
                      d="M7 12q3 3 6 0M19 15v7m-3.5-3.5h7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <OldIcon name={item.icon} size={22} />
                )}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ))}
        <i className="bubble-menu-arrow" style={{ left: place.arrow }} aria-hidden />
      </div>
    </div>
  );
}

/** 返回键 + 其他会话未读药丸（规格 3.2）。 */
function BackWithUnread({ excludeId }: { excludeId: string }) {
  const { state } = useChat();
  const navigate = useNavigate();
  const unread = state.conversations
    .filter((c) => c.conversationId !== excludeId && !c.state.muted && !c.state.hidden)
    .reduce((total, c) => total + c.unreadCount, 0);
  return (
    <button
      type="button"
      className="wx-back"
      aria-label={unread ? `返回微伴，${unread} 条未读` : '返回微伴'}
      onClick={() => {
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (idx > 0) navigate(-1);
        else navigate('/chat', { replace: true });
      }}
    >
      <BackArrow />
      {unread > 0 && <span className="wx-back-pill">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
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
  const me = conversation.participants.find((p) => p.kind === 'user');
  const memberNames = useCharacterNames(
    group ? everyone.filter((p) => p.kind === 'character').map((p) => p.refId) : [],
  );
  const roleProfile = useRemote(
    CharacterEndpoints.getProfile,
    { params: { characterId: role?.refId ?? '' } },
    !!role,
  );
  const displayName = (characterId: string) =>
    chat.state.contacts.find((c) => c.characterId === characterId)?.remark ||
    memberNames[characterId] ||
    (characterId === role?.refId ? roleProfile.data?.name : null) ||
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
  const input = useRef<HTMLTextAreaElement>(null);
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
  const navigate = useNavigate();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [forwarding, setForwarding] = useState(false);
  const [params, setParams] = useSearchParams();
  const targetSeq = Number(params.get('seq')) || 0;
  const [scrollTarget, setScrollTarget] = useState<{ key: string; nonce: number } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const [plusPage, setPlusPage] = useState(0);
  const [menu, setMenu] = useState<{
    message: Message;
    anchor: DOMRect;
    x: number;
  } | null>(null);
  const roleId = role?.refId;
  const presetTarget = useMemo(
    () =>
      group
        ? ({ kind: 'group', conversationId: id } as const)
        : roleId
          ? ({ kind: 'character', characterId: roleId } as const)
          : null,
    [group, id, roleId],
  );
  const preset = useCurrentPreset(presetTarget);
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
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const { older: loadOlder } = chat;
  // 搜索结果 / 收藏定位（search.md 第 4 节）：向前补读直到目标消息出现，停在距顶部 1/3 处并闪一下。
  useEffect(() => {
    if (!targetSeq) return;
    let active = true;
    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    void (async () => {
      for (let attempt = 0; attempt < 60 && active; attempt++) {
        const list = messagesRef.current;
        const hit = list.find((m) => m.seq === targetSeq);
        if (hit) {
          setScrollTarget({ key: hit.messageId, nonce: Date.now() });
          setFlash(hit.messageId);
          window.setTimeout(() => setFlash(null), 1200);
          break;
        }
        const oldest = list[0]?.seq;
        if (oldest === undefined || oldest <= targetSeq) {
          if (attempt > 10) {
            showToast('这条消息已删除');
            break;
          }
          await wait(300);
          continue;
        }
        try {
          const more = await loadOlder(id, oldest);
          await wait(60);
          if (!more && !messagesRef.current.some((m) => m.seq === targetSeq)) {
            showToast('这条消息已删除');
            break;
          }
        } catch {
          await wait(500);
        }
      }
      if (active)
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete('seq');
            return next;
          },
          { replace: true },
        );
    })();
    return () => {
      active = false;
    };
  }, [targetSeq, id, loadOlder, setParams]);
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
  const mentionedMe = (message: Message) =>
    group &&
    message.content?.type === 'text' &&
    !!me &&
    (message.content.mentions ?? []).includes(me.participantId);
  /** 气泡（文字类带尖角；图片、表情不带气泡底；卡片类统一白卡）。 */
  /** 引用在微信里是气泡内的一条浅色引文，不是气泡下面另起一块 */
  function quoteLine(message: Message) {
    const original = messages.find((item) => item.messageId === message.quote?.messageId);
    const who = original
      ? original.senderKind === 'user'
        ? (userProfile.data?.nickname ?? '我')
        : displayName(senderOf(original)?.refId ?? role?.refId ?? '')
      : '引用消息';
    return (
      <span className="wx-quote-inline">
        {who}：{message.quote?.preview ?? '原消息已不可见'}
      </span>
    );
  }
  function bubble(message: Message) {
    const c = message.content;
    const mine = message.senderKind === 'user';
    const textBubble = (children: ReactNode, extra = '') => (
      <div
        className={`wx-bubble ${mine ? 'mine' : ''} ${mentionedMe(message) ? 'mention' : ''} ${extra}`}
      >
        {message.quote && quoteLine(message)}
        <span className="wx-bubble-text">{children}</span>
      </div>
    );
    if (message.status !== 'normal' || !c) return textBubble(content(message));
    switch (c.type) {
      case 'contact_card':
        return <ContactCardBubble content={c} />;
      case 'forwarded_record':
        return <ForwardedRecordBubble content={c} message={message} />;
      case 'letter':
        return (
          <div className="wx-card-wrap">
            <LetterBubble content={c} characterId={role?.refId ?? ''} />
          </div>
        );
      case 'daily_question':
        return (
          <div className="wx-card-wrap">
            <DailyQuestionBubble content={c} />
          </div>
        );
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
            mine={mine}
            name={role ? displayName(role.refId) : undefined}
            onRedial={!group && role && callEntry ? () => startCall(role.refId) : undefined}
          />
        );
      case 'text':
        return textBubble(<Linkified text={c.text} />);
      default:
        return textBubble(content(message));
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
    setMode('text');
    input.current?.focus();
  }
  async function submit(event?: FormEvent) {
    event?.preventDefault();
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
      // 发送后保持键盘不收起，可以连续打字（4.4.8）。
      input.current?.focus();
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
  const selectable = (message: Message) =>
    message.status === 'normal' && message.senderKind !== 'system' && !!message.content;
  const chosen = messages.filter((m) => selected.has(m.messageId));
  const shareBlocked =
    chosen.length > SHARE_IMAGE_MAX_ITEMS
      ? `最多选择 ${SHARE_IMAGE_MAX_ITEMS} 条`
      : chosen.some((m) => m.scope === 'adult' || m.labels?.includes('health'))
        ? SHARE_REJECT_TEXT
        : '';
  function toggle(message: Message) {
    if (!selectable(message)) return;
    setSelected((set) => {
      const next = new Set(set);
      if (next.has(message.messageId)) next.delete(message.messageId);
      else next.add(message.messageId);
      return next;
    });
  }
  function startSelect(message: Message) {
    setSelecting(true);
    setSelected(new Set([message.messageId]));
    setPanel('none');
  }
  function endSelect() {
    setSelecting(false);
    setSelected(new Set());
  }
  async function favoriteChosen() {
    if (chosen.length === 0) return;
    const items = chosen.slice(0, SHARE_IMAGE_MAX_ITEMS);
    try {
      await api.call(LibraryEndpoints.addFavorites, {
        body: {
          items: items.map((m) => ({
            kind: 'message' as const,
            conversationId: id,
            messageId: m.messageId,
          })),
        },
      });
      showToast(items.length > 1 ? `已收藏 ${items.length} 条` : '已收藏', 2000, 'success');
      endSelect();
    } catch (e) {
      showToast(friendlyError(e));
    }
  }
  const senderOf = (message: Message) =>
    everyone.find((participant) => participant.participantId === message.senderParticipantId);
  function copy(value: string) {
    void copyText(value);
  }
  /** 气泡长按菜单项目（4.4.7）。 */
  function menuItems(message: Message): BubbleMenuItem[] {
    const c = message.content;
    if (!c) return [];
    const mine = message.senderKind === 'user';
    const canRecall = mine && Date.now() - new Date(message.createdAt).getTime() < 120_000;
    const fav = { label: '收藏', icon: 'wechat/star', onClick: () => void addFavorite(message) };
    const multi = { label: '多选', icon: 'wechat/check', onClick: () => startSelect(message) };
    const quoteItem = {
      label: '引用',
      icon: 'wechat/reply',
      onClick: () => setQuoteId(message.messageId),
    };
    const del = {
      label: '删除',
      icon: 'wechat/delete',
      onClick: () => void action(message, 'hide'),
    };
    const forward = {
      label: '转发',
      icon: 'wechat/share',
      onClick: () => startSelect(message),
    };
    const shareSlot = canRecall
      ? { label: '撤回', icon: 'wechat/undo', onClick: () => void action(message, 'recall') }
      : forward;
    const stickerItem = {
      label: '表情',
      icon: 'smile-plus',
      onClick: () => void addToStickers(message),
    };
    switch (c.type) {
      case 'text':
        return [
          { label: '复制', icon: 'wechat/copy', onClick: () => copy(c.text) },
          shareSlot,
          fav,
          quoteItem,
          multi,
          del,
        ];
      case 'image':
        return [
          { label: '保存', icon: 'drawn/save', onClick: () => void saveImage(c.mediaId) },
          shareSlot,
          fav,
          canAddToStickers(message) ? stickerItem : quoteItem,
          multi,
          del,
        ];
      case 'voice':
        return [
          {
            label: textShown[message.messageId] ? '收起文字' : '转文字',
            icon: 'drawn/voice_to_text',
            onClick: () =>
              setTextShown((v) => ({ ...v, [message.messageId]: !v[message.messageId] })),
          },
          canRecall
            ? shareSlot
            : {
                label: '复制',
                icon: 'wechat/copy',
                onClick: () => {
                  if (c.transcript) copy(c.transcript);
                  else
                    void api
                      .call(MediaExtraEndpoints.getTranscript, { params: { mediaId: c.mediaId } })
                      .then((result) => {
                        if (result.status === 'ready' && result.text) copy(result.text);
                        else showToast('暂时没有可复制的语音文字');
                      })
                      .catch((e) => showToast(friendlyError(e)));
                },
              },
          fav,
          quoteItem,
          multi,
          del,
        ];
      case 'sticker':
        return [
          { label: '保存', icon: 'drawn/save', onClick: () => void saveImage(c.mediaId) },
          shareSlot,
          fav,
          canAddToStickers(message) ? stickerItem : quoteItem,
          multi,
          del,
        ];
      case 'link':
        return [
          { label: '复制', icon: 'wechat/link', onClick: () => copy(c.url) },
          shareSlot,
          fav,
          quoteItem,
          multi,
          del,
        ];
      default:
        return [
          { label: '复制', icon: 'wechat/copy', onClick: () => copy(content(message)) },
          shareSlot,
          fav,
          quoteItem,
          multi,
          del,
        ];
    }
  }

  function openMenu(message: Message, target: Element, x: number) {
    if (selecting || !selectable(message)) return;
    if (message.content?.type === 'action_card' || message.content?.type === 'call_record') return;
    const bubbleEl = target.closest('.wx-msg-bubble') ?? target;
    setMenu({ message, anchor: bubbleEl.getBoundingClientRect(), x });
  }

  const rows: Row[] = [];
  if (older && messages.length > 0) rows.push({ kind: 'older', key: '__older__' });
  let previousAt: string | undefined;
  for (const message of messages) {
    const divider = needsDivider(previousAt, message.createdAt)
      ? dividerTime(message.createdAt)
      : null;
    previousAt = message.createdAt;
    rows.push({ kind: 'message', key: message.messageId, message, divider });
  }
  pending.forEach((item, index) =>
    rows.push({ kind: 'pending', key: `pending:${item.body.clientMsgId}`, index }),
  );
  for (const upload of uploads)
    rows.push({ kind: 'upload', key: `upload:${upload.localId}`, upload });
  const lastMine = [...messages]
    .reverse()
    .find((m) => m.senderKind === 'user' && m.status === 'normal');
  const myAvatar = <UserAvatar profile={userProfile.data} size={40} radius={4} />;

  const olderRequest = useRef(false);
  function fetchOlder() {
    if (!older || olderRequest.current || !messages.length) return;
    olderRequest.current = true;
    setLoadingOlder(true);
    void chat
      .older(id, messages[0]!.seq)
      .then(setOlder)
      .catch((e) => setError(friendlyError(e)))
      .finally(() => {
        olderRequest.current = false;
        setLoadingOlder(false);
      });
  }
  function renderRow(row: Row) {
    if (row.kind === 'older')
      return (
        <div className="wx-older">
          <button
            type="button"
            className="text-button"
            disabled={loadingOlder}
            onClick={fetchOlder}
          >
            {loadingOlder ? '正在读取…' : '查看更早的消息'}
          </button>
        </div>
      );
    if (row.kind === 'pending') {
      const item = pending[row.index];
      if (!item) return null;
      const c = item.body.content;
      if (c.type === 'nudge') {
        const target = conversation.participants.find(
          (p) => p.participantId === c.targetParticipantId,
        );
        return (
          <div className="wx-system">
            你拍了拍{target?.kind === 'character' ? displayName(target.refId) : '自己'}
            {item.state === 'failed' && (
              <button
                className="text-button"
                onClick={() =>
                  void chat
                    .retry(id, item.body.clientMsgId)
                    .catch((e) => setError(friendlyError(e)))
                }
              >
                发送失败，重试
              </button>
            )}
          </div>
        );
      }
      return (
        <div className="wx-msg-row mine">
          {myAvatar}
          <div className="wx-msg-main">
            <div className="wx-msg-line">
              {item.state === 'failed' ? (
                <button
                  type="button"
                  className="wx-send-failed"
                  aria-label="发送失败，点击重发"
                  onClick={() =>
                    void chat
                      .retry(id, item.body.clientMsgId)
                      .catch((e) => setError(friendlyError(e)))
                  }
                >
                  !
                </button>
              ) : item.state === 'pending' && item.failures > 0 ? (
                <span className="wx-sending" role="status" aria-label="网络异常，等待重试" />
              ) : null}
              <div className="wx-msg-bubble">
                {c.type === 'image' ? (
                  <ImageBubble content={c} />
                ) : c.type === 'sticker' ? (
                  <StickerBubble content={c} />
                ) : (
                  <div className="wx-bubble mine">
                    <span className="wx-bubble-text">
                      {c.type === 'text'
                        ? c.text
                        : c.type === 'voice'
                          ? `[语音] ${Math.max(1, Math.round(c.durationMs / 1000))}''`
                          : c.type === 'link'
                            ? c.title
                            : '拍了拍'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }
    if (row.kind === 'upload') {
      const upload = row.upload;
      return (
        <div className="wx-msg-row mine">
          {myAvatar}
          <div className="wx-msg-main">
            <div className="wx-msg-line">
              {upload.failed ? (
                <UploadFailed
                  onRetry={() => void runUpload(upload)}
                  onDrop={() => dropUpload(upload)}
                />
              ) : null}
              <div className="wx-msg-bubble">
                {upload.kind === 'image' && upload.url ? (
                  <LocalImageBubble
                    url={upload.url}
                    width={upload.width}
                    height={upload.height}
                    progress={upload.progress}
                    failed={upload.failed}
                  />
                ) : (
                  <div className="wx-bubble mine">
                    <span className="wx-bubble-text">
                      [语音] {Math.max(1, Math.round((upload.durationMs ?? 0) / 1000))}&apos;&apos;
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }
    const message = row.message;
    const divider = row.divider && <div className="wx-time">{row.divider}</div>;
    if (message.status === 'normal' && message.content?.type === 'nudge') {
      const targetId = message.content.targetParticipantId;
      const target = conversation.participants.find((p) => p.participantId === targetId);
      const sender = senderOf(message);
      const senderName = message.senderKind === 'user' ? '你' : displayName(sender?.refId ?? '');
      const targetName =
        target?.kind === 'user' ? '你' : target ? displayName(target.refId) : '对方';
      return (
        <>
          {divider}
          <div className="wx-system">
            {senderName}拍了拍{targetName}
          </div>
        </>
      );
    }
    const system = message.senderKind === 'system' || message.status === 'recalled';
    if (system) {
      const c = message.content;
      const characterId =
        c?.type === 'system' && c.code === 'card_obtained'
          ? String(c.params.characterId ?? role?.refId ?? '')
          : '';
      return (
        <>
          {divider}
          <div className="wx-system">
            {characterId && c?.type === 'system' ? (
              <Link
                className="text-link"
                to={`/characters/${characterId}/cards?card=${String(c.params.cardId ?? '')}`}
              >
                {content(message)}
              </Link>
            ) : message.status === 'recalled' ? (
              message.senderKind === 'user' ? (
                '你撤回了一条消息'
              ) : (
                `${displayName(senderOf(message)?.refId ?? role?.refId ?? '')} 撤回了一条消息`
              )
            ) : (
              content(message)
            )}
          </div>
        </>
      );
    }
    const mine = message.senderKind === 'user';
    const sender = senderOf(message);
    const senderId = sender?.refId ?? role?.refId ?? '';
    const isSelected = selected.has(message.messageId);
    return (
      <>
        {divider}
        <div
          className={`wx-msg-row ${mine ? 'mine' : ''} ${selecting ? 'selecting' : ''}`}
          role={selecting ? 'checkbox' : undefined}
          aria-checked={selecting ? isSelected : undefined}
          aria-label={
            selecting
              ? `选择消息：${Array.from(content(message)).slice(0, 80).join('')}`
              : undefined
          }
          aria-disabled={selecting && !selectable(message) ? true : undefined}
          tabIndex={selecting && selectable(message) ? 0 : undefined}
          onKeyDown={(event) => {
            if (!selecting || event.target !== event.currentTarget) return;
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault();
            toggle(message);
          }}
          onClickCapture={(event) => {
            if (!selecting) return;
            event.preventDefault();
            event.stopPropagation();
            toggle(message);
          }}
        >
          {selecting && (
            <span className="wx-select">
              <CheckCircle checked={isSelected} disabled={!selectable(message)} />
            </span>
          )}
          {mine ? (
            myAvatar
          ) : (
            <ChatAvatarLink
              to={`/characters/${senderId}${group && conversation.title ? `?group=${encodeURIComponent(conversation.title)}` : ''}`}
              onNudge={() => {
                if (sender)
                  void chat
                    .sendContent(id, { type: 'nudge', targetParticipantId: sender.participantId })
                    .catch((e) => setError(friendlyError(e)));
              }}
            >
              <CharacterAvatar id={senderId} size={40} radius={4} />
            </ChatAvatarLink>
          )}
          <div className="wx-msg-main">
            {group && !mine && (
              <button
                type="button"
                className="wx-sender"
                onClick={() => sender && insertMention(sender)}
              >
                {displayName(senderId)}
              </button>
            )}
            <div className="wx-msg-line">
              <BubblePress onPress={(target, x) => openMenu(message, target, x)}>
                {bubble(message)}
              </BubblePress>
            </div>
            {message.quote && (message.content?.type ?? 'text') !== 'text' && (
              <div className="wx-quote">
                <span>
                  {(() => {
                    const original = messages.find(
                      (item) => item.messageId === message.quote?.messageId,
                    );
                    return original
                      ? original.senderKind === 'user'
                        ? (userProfile.data?.nickname ?? '我')
                        : displayName(senderOf(original)?.refId ?? role?.refId ?? '')
                      : '引用消息';
                  })()}
                  ：{message.quote.preview ?? '原消息已不可见'}
                </span>
              </div>
            )}
            {!group && mine && message.messageId === lastMine?.messageId && (
              <small className="wx-read">
                {conversation.peerReadSeq !== null && conversation.peerReadSeq >= message.seq
                  ? '已读'
                  : '已送达'}
              </small>
            )}
          </div>
        </div>
      </>
    );
  }

  const typing = !group && typingNames.length > 0 && status.data?.available;
  const plusCells: PlusCell[] = group
    ? [
        { label: '照片', icon: 'wechat/album', onClick: () => albumInput.current?.click() },
        { label: '拍摄', icon: 'wechat/camera', onClick: () => cameraInput.current?.click() },
        { label: '语音通话', icon: 'wechat/voice_call', onClick: showComingSoon },
        { label: '位置', icon: 'wechat/location', onClick: showComingSoon },
        { label: '红包', icon: 'wechat/red_packet', onClick: showComingSoon },
        { label: '转账', icon: 'wechat/transfer', onClick: showComingSoon },
        { label: '名片', icon: 'wechat/person', onClick: () => showComingSoon() },
        { label: '收藏', icon: 'wechat/star', onClick: showComingSoon },
      ]
    : [
        { label: '相册', icon: 'wechat/album', onClick: () => albumInput.current?.click() },
        { label: '拍摄', icon: 'wechat/camera', onClick: () => cameraInput.current?.click() },
        {
          label: '情景预设',
          icon: 'drawn/scenario_sparkle',
          dot: !!preset.mode && preset.mode !== 'auto',
          onClick: () => setPresetOpen(true),
        },
        ...(role
          ? [
              {
                label: '写信',
                icon: 'drawn/letter',
                onClick: () => navigate(`/play/letters/new?characterId=${role.refId}`),
              },
              {
                label: '陪我专注',
                icon: 'drawn/hourglass',
                onClick: () => navigate(`/play/focus?characterId=${role.refId}`),
              },
              {
                label: '心愿',
                icon: 'wechat/star',
                onClick: () => navigate(`/play/wishlists/${role.refId}`),
              },
              {
                label: '提醒',
                icon: 'wechat/bell',
                onClick: () => navigate(`/play/reminders/new?characterId=${role.refId}`),
              },
            ]
          : []),
        {
          label: '语音通话',
          icon: 'wechat/voice_call',
          onClick: () => {
            if (role && callEntry) {
              setPanel('none');
              startCall(role.refId);
            } else showToast('语音通话需先开通语音服务并配置域名，暂未开放', 3000, 'info');
          },
        },
        { label: '位置', icon: 'wechat/location', onClick: showComingSoon },
        { label: '红包', icon: 'wechat/red_packet', onClick: showComingSoon },
        { label: '转账', icon: 'wechat/transfer', onClick: showComingSoon },
        { label: '名片', icon: 'wechat/person', onClick: showComingSoon },
        { label: '音乐', icon: 'wechat/discover_listen', onClick: showComingSoon },
      ];

  // 打开表情/加号面板后列表变矮，重新贴到底，避免最后一条被输入栏挡住
  const lastRowKey = rows.length ? rows[rows.length - 1]!.key : null;
  useEffect(() => {
    if (panel === 'none' || !lastRowKey) return;
    setScrollTarget({ key: lastRowKey, nonce: Date.now() });
  }, [panel, lastRowKey]);

  return (
    <main className={`wx-chat ${panel !== 'none' ? 'with-panel' : ''}`}>
      <header className="wx-chat-head">
        {selecting ? (
          <button type="button" className="wx-head-text" onClick={endSelect}>
            取消
          </button>
        ) : (
          <BackWithUnread excludeId={id} />
        )}
        <ChatHeading
          name={selecting ? `已选择 ${chosen.length} 条` : <Name conversation={conversation} />}
          characterId={selecting ? undefined : role?.refId}
          active={
            !selecting &&
            !!role &&
            chat.state.contacts.some((c) => c.characterId === role.refId && c.status === 'active')
          }
          group={group}
          typing={!selecting && !!typing}
        />
        {selecting ? (
          <span />
        ) : (
          <Link
            to={group ? `/chat/${id}/group` : `/chat/${id}/settings`}
            aria-label="聊天信息"
            className="nav-bar-icon wx-more"
          >
            <OldIcon name="wechat/more" size={24} />
          </Link>
        )}
      </header>
      <HomeScreenGuide
        received={messages.some(
          (message) =>
            message.senderKind === 'character' &&
            message.status === 'normal' &&
            message.content !== null,
        )}
      />
      {!chat.online && <p className="notice-bar">网络暂不可用，消息保存在本机，联网后继续发送</p>}
      {status.data && !status.data.available && (
        <p className="notice-bar">
          {status.data.reason === 'insufficient_balance'
            ? '积分不足，角色暂时无法回复'
            : '模型服务暂时不可用，角色暂时无法回复'}
          <Link to={status.data.reason === 'insufficient_balance' ? '/wallet/recharge' : '/models'}>
            {status.data.reason === 'insufficient_balance' ? '去充值 ›' : '去看看 ›'}
          </Link>
        </p>
      )}
      {group && typingNames.length > 0 && status.data?.available && (
        <p
          className="wx-typing"
          role="status"
        >{`${typingNames.filter(Boolean).join('、')} 正在输入...`}</p>
      )}
      {(error || chat.error) && (
        <p role="alert" className="notice-bar">
          {error || chat.error}
        </p>
      )}
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
      <div className="wx-chat-body" onClick={() => panel !== 'none' && setPanel('none')}>
        <VirtualList
          items={rows}
          itemKey={(row) => row.key}
          label="聊天消息"
          estimate={64}
          bottom
          onBottom={setAtBottom}
          onStart={fetchOlder}
          anchorItem={(row) => row.kind === 'message'}
          scrollTo={scrollTarget}
          rowClassName={(row) =>
            row.kind === 'message' && row.message.messageId === flash ? 'flash-row' : undefined
          }
          render={renderRow}
        />
      </div>
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
      {picking && (
        <Sheet title="选择提醒的人" onClose={() => setPicking(false)} closeLabel="取消">
          <MenuGroup>
            {members.map((member) => (
              <MenuRow
                key={member.participantId}
                chevron={false}
                onClick={() => insertMention(member)}
                label={
                  <>
                    <CharacterAvatar id={member.refId} size={40} />
                    {displayName(member.refId)}
                  </>
                }
              />
            ))}
          </MenuGroup>
        </Sheet>
      )}
      {selecting ? (
        <div className="wx-select-bar">
          {shareBlocked && <small className="wx-select-hint">{shareBlocked}</small>}
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => {
              if (chosen.length > 50) {
                showToast('一次最多转发 50 条消息');
                return;
              }
              if (chosen.some((m) => m.content?.type === 'forwarded_record')) {
                showToast('聊天记录暂不支持再次转发，请选择原消息');
                return;
              }
              setForwarding(true);
            }}
          >
            <OldIcon name="wechat/share" size={24} />
            转发
          </button>
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => void favoriteChosen()}
          >
            <OldIcon name="wechat/star" size={24} />
            收藏
          </button>
          <button
            type="button"
            disabled={chosen.length === 0 || !!shareBlocked}
            onClick={() =>
              openShare(navigate, {
                kind: 'messages',
                conversationId: id,
                messageIds: chosen.map((m) => m.messageId),
              })
            }
          >
            <OldIcon name="wechat/share" size={24} />
            分享图
          </button>
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => {
              const list = chosen;
              endSelect();
              void Promise.all(list.map((m) => action(m, 'hide')));
            }}
          >
            <OldIcon name="wechat/delete" size={24} />
            删除
          </button>
        </div>
      ) : (
        <form className="wx-input-bar" onSubmit={(event) => void submit(event)}>
          <button
            type="button"
            className="wx-input-icon"
            aria-label={mode === 'text' ? '切换到按住说话' : '切换到键盘'}
            onClick={() => {
              setMode((m) => (m === 'text' ? 'voice' : 'text'));
              setPanel('none');
            }}
          >
            {mode === 'text' ? (
              <OldIcon name="color/chat_voice_mode" size={30} />
            ) : (
              <OldIcon name="wechat/keyboard" size={28} />
            )}
          </button>
          {mode === 'voice' ? (
            <HoldToTalk onRecorded={sendVoice} onPermissionDenied={() => setMicDenied(true)} />
          ) : (
            <textarea
              ref={input}
              className="wx-input"
              aria-label="消息"
              rows={1}
              value={text}
              maxLength={4000}
              placeholder={group ? '输入消息，@成员' : '输入消息'}
              onFocus={() => setPanel('none')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
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
          )}
          <button
            type="button"
            className="wx-input-icon"
            aria-label={panel === 'sticker' ? '切换到键盘' : '表情'}
            aria-pressed={panel === 'sticker'}
            onClick={() => {
              if (panel === 'sticker') {
                setPanel('none');
                input.current?.focus();
              } else {
                setMode('text');
                setPanel('sticker');
              }
            }}
          >
            <OldIcon name={panel === 'sticker' ? 'wechat/keyboard' : 'wechat/smile'} size={28} />
          </button>
          {mode === 'text' && text.trim() ? (
            <button className="wx-send" type="submit" disabled={sending}>
              发送
            </button>
          ) : (
            <button
              type="button"
              className="wx-input-icon"
              aria-label={panel === 'plus' ? '切换到键盘' : '更多功能'}
              aria-pressed={panel === 'plus'}
              onClick={() => {
                if (panel === 'plus') {
                  setPanel('none');
                  if (mode === 'text') input.current?.focus();
                } else setPanel('plus');
              }}
            >
              <OldIcon
                name={panel === 'plus' ? 'wechat/keyboard' : 'wechat/add_circle'}
                size={28}
              />
            </button>
          )}
        </form>
      )}
      {quote && !selecting && (
        <div className="wx-quote-bar">
          <span>
            <b>
              {quote.senderKind === 'user'
                ? (userProfile.data?.nickname ?? '我')
                : displayName(senderOf(quote)?.refId ?? role?.refId ?? '')}
            </b>
            <span>
              {Array.from(content(quote)).length > 30
                ? `${Array.from(content(quote)).slice(0, 30).join('')}...`
                : content(quote)}
            </span>
          </span>
          <button type="button" aria-label="取消引用" onClick={() => setQuoteId(null)}>
            <OldIcon name="wechat/close" size={18} />
          </button>
        </div>
      )}
      {panel === 'sticker' && !selecting && (
        <StickerPanel
          onPick={(sticker) =>
            void chat
              .sendContent(id, { type: 'sticker', ...sticker })
              .catch((e) => setError(friendlyError(e)))
          }
        />
      )}
      {panel === 'plus' && !selecting && (
        <PlusPanel page={plusPage} onPage={setPlusPage} cells={plusCells} />
      )}
      {menu && (
        <BubbleMenu
          anchor={menu.anchor}
          x={menu.x}
          items={menuItems(menu.message)}
          onClose={() => setMenu(null)}
        />
      )}
      {presetOpen && presetTarget && (
        <ScenarioSheet
          target={presetTarget}
          current={preset.mode}
          onClose={() => setPresetOpen(false)}
          onChanged={() => {
            preset.refresh();
            setPanel('none');
          }}
        />
      )}
      {forwarding && (
        <ForwardPicker
          messages={chosen}
          conversations={chat.state.conversations}
          contacts={chat.state.contacts}
          onClose={() => setForwarding(false)}
          onComplete={() => {
            setForwarding(false);
            endSelect();
            showToast('已转发', 2000, 'success');
          }}
          onSend={(body) =>
            api.call(ChatEndpoints.forwardMessages, { params: { conversationId: id }, body })
          }
        />
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

function UploadFailed({ onRetry, onDrop }: { onRetry(): void; onDrop(): void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="wx-send-failed"
        aria-label="发送失败"
        onClick={() => setOpen(true)}
      >
        !
      </button>
      {open && (
        <Dialog
          actions={[
            {
              label: '删除',
              onClick: () => {
                setOpen(false);
                onDrop();
              },
            },
            {
              label: '重发',
              primary: true,
              onClick: () => {
                setOpen(false);
                onRetry();
              },
            },
          ]}
        >
          <p>重发该消息？</p>
        </Dialog>
      )}
    </>
  );
}

interface PlusCell {
  label: string;
  icon: string;
  dot?: boolean;
  onClick(): void;
}

/** 聊天「+」面板（4.4.10）：每页 4 列 × 2 行，白方块 58 圆角 14，多于 8 个左右翻页 + 圆点。 */
function PlusPanel({
  cells,
  page,
  onPage,
}: {
  cells: PlusCell[];
  page: number;
  onPage(page: number): void;
}) {
  const pages: PlusCell[][] = [];
  for (let i = 0; i < cells.length; i += 8) pages.push(cells.slice(i, i + 8));
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <div className="wx-plus">
      <div
        ref={scroller}
        className="wx-plus-pages"
        onScroll={(event) => {
          const el = event.currentTarget;
          const next = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (next !== page) onPage(next);
        }}
      >
        {pages.map((list, index) => (
          <div className="wx-plus-page" key={index}>
            {list.map(({ label, icon, dot, onClick }) => (
              <button key={label} type="button" className="wx-plus-cell" onClick={onClick}>
                <span className="wx-plus-square">
                  <OldIcon name={icon} size={28} />
                  {dot && <span className="wx-plus-dot" aria-label="现在开着别的预设" />}
                </span>
                <small>{label}</small>
              </button>
            ))}
          </div>
        ))}
      </div>
      {pages.length > 1 && (
        <div className="wx-plus-dots">
          {pages.map((_, index) => (
            <button
              key={index}
              type="button"
              aria-label={`第 ${index + 1} 页`}
              aria-current={index === page}
              onClick={() =>
                scroller.current?.scrollTo({
                  left: index * scroller.current.clientWidth,
                  behavior: 'smooth',
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
