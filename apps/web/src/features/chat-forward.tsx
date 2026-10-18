import { useState } from 'react';
import {
  FORWARD_LIMITS,
  type Contact,
  type Conversation,
  type ForwardMessagesRequest,
  type ForwardMessagesResponse,
  type ForwardedRecordContent,
  type ForwardSnapshotContent,
  type Message,
} from '@weiban/contracts';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterAvatar } from './character-avatar.js';
import { Sheet, CheckCircle, MenuGroup, MenuRow } from './shell-kit.js';
import {
  ImageBubble,
  ImageViewer,
  StickerBubble,
  LinkCardBubble,
  Linkified,
  VoiceBubble,
} from './media.js';
import { friendlyError } from '../data/use-remote.js';
import { SearchField } from './search-field.js';

export function forwardPreview(c: ForwardSnapshotContent): string {
  switch (c.type) {
    case 'text':
      return c.text;
    case 'image':
      return '[图片]';
    case 'voice':
      return `[语音]${c.transcript ?? ''}`;
    case 'sticker':
      return `[表情]${c.description ?? ''}`;
    case 'link':
      return `[链接]${c.title}`;
    case 'contact_card':
      return `[名片]${c.name}`;
    case 'letter':
      return c.body;
    case 'daily_question':
      return `${c.question}：${c.answer}`;
  }
}

/** Full-screen record reader uses the persisted snapshot only; never fetches the original chat. */
export function ForwardedRecordBubble({
  content,
  message,
}: {
  content: ForwardedRecordContent;
  message: Message;
}) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<number | null>(null);
  const images = content.items.flatMap((i) => (i.content.type === 'image' ? [i.content] : []));
  return (
    <>
      <button type="button" className="wx-forward-card" onClick={() => setOpen(true)}>
        <strong>{content.title}</strong>
        {content.items.slice(0, 4).map((i, n) => (
          <span key={n}>
            {i.senderName}：{forwardPreview(i.content)}
          </span>
        ))}
        <small>聊天记录 · {content.items.length} 条</small>
      </button>
      {open && (
        <Sheet title={content.title} onClose={() => setOpen(false)} closeLabel="返回" fullScreen>
          <div className="wx-forward-record">
            {content.items.map((i, n) => (
              <article key={n}>
                <header>
                  <strong>{i.senderName}</strong>
                  <time dateTime={i.createdAt}>
                    {new Date(i.createdAt).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </header>
                {i.content.type === 'image' ? (
                  <ImageBubble
                    content={i.content}
                    onOpen={() => setImage(images.findIndex((c) => c === i.content))}
                  />
                ) : i.content.type === 'sticker' ? (
                  <StickerBubble content={i.content} />
                ) : i.content.type === 'link' ? (
                  <LinkCardBubble content={i.content} />
                ) : i.content.type === 'voice' ? (
                  <VoiceBubble
                    message={{
                      ...message,
                      messageId: `${message.messageId}:${n}`,
                      senderKind: i.senderKind,
                      content: i.content,
                    }}
                    next={() => undefined}
                    showText
                  />
                ) : (
                  <p>
                    <Linkified text={forwardPreview(i.content)} />
                  </p>
                )}
              </article>
            ))}
          </div>
        </Sheet>
      )}
      {image !== null && (
        <ImageViewer
          images={images.map((c, n) => ({
            ...message,
            messageId: `${message.messageId}:image:${n}`,
            content: c,
          }))}
          index={image}
          onClose={() => setImage(null)}
        />
      )}
    </>
  );
}

export function ForwardPicker({
  messages,
  conversations,
  contacts,
  onClose,
  onComplete,
  onSend,
}: {
  messages: Message[];
  conversations: Conversation[];
  contacts: Contact[];
  onClose(): void;
  onComplete(): void;
  onSend(body: ForwardMessagesRequest): Promise<ForwardMessagesResponse>;
}) {
  const [mode, setMode] = useState<'individual' | 'merged' | null>(
    messages.length === 1 ? 'individual' : null,
  );
  const [tab, setTab] = useState<'recent' | 'contacts'>('recent');
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<ForwardMessagesResponse['results']>([]);
  const activeContacts = contacts.filter((c) => c.status === 'active' && c.conversationId);
  const ids = [
    ...activeContacts.map((c) => c.characterId),
    ...conversations.flatMap((c) =>
      c.participants.filter((p) => p.kind === 'character').map((p) => p.refId),
    ),
  ];
  const names = useCharacterNames(ids);
  const nameOf = (id: string) =>
    activeContacts.find((c) => c.characterId === id)?.remark ?? names[id] ?? '角色';
  const recent = conversations
    .filter((c) => c.lastMessage && !c.state.hidden)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((c) => {
      const role = c.participants.find((p) => p.kind === 'character');
      return {
        id: c.conversationId,
        name: c.type === 'group' ? (c.title ?? '群聊') : nameOf(role?.refId ?? ''),
        characterId: c.type === 'direct' ? role?.refId : undefined,
      };
    });
  const directory = activeContacts
    .map((c) => ({
      id: c.conversationId!,
      name: nameOf(c.characterId),
      characterId: c.characterId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const list = (tab === 'recent' ? recent : directory).filter((c) =>
    c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  function toggle(id: string) {
    if (attempted || busy) return;
    if (!selected.includes(id) && selected.length >= FORWARD_LIMITS.targets) {
      setError('一次最多选择 10 个聊天');
      return;
    }
    setSelected((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }
  async function send() {
    if (!mode || !selected.length || busy) return;
    setBusy(true);
    setAttempted(true);
    setError('');
    try {
      const response = await onSend({
        clientRequestId: requestId,
        mode,
        messageIds: messages.map((m) => m.messageId),
        targetConversationIds: selected,
      });
      setResults(response.results);
      if (response.results.length && response.results.every((r) => r.ok)) onComplete();
      else setError('部分聊天未发送成功，可以重试；已发送的不会重复。');
    } catch (e) {
      setError(`${friendlyError(e)}；请重试，已送达的不会重复。`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={mode ? '选择聊天' : '转发消息'}
      onClose={() => {
        if (!busy) onClose();
      }}
      closeLabel="取消"
      action={
        mode ? (
          <button
            type="button"
            className="sheet-text-button"
            disabled={!selected.length || busy}
            onClick={() => void send()}
          >
            {busy
              ? '发送中…'
              : attempted
                ? '重试发送'
                : `发送${selected.length ? `(${selected.length})` : ''}`}
          </button>
        ) : undefined
      }
    >
      {!mode ? (
        <MenuGroup>
          <MenuRow label="逐条转发" onClick={() => setMode('individual')} />
          <MenuRow label="合并转发" onClick={() => setMode('merged')} />
        </MenuGroup>
      ) : (
        <div className="wx-forward-picker">
          <p className="wx-forward-summary">
            {mode === 'merged' ? '合并聊天记录' : '逐条转发'} · {messages.length} 条
            {attempted ? ' · 已锁定本次内容与接收人' : ''}
          </p>
          <SearchField
            aria-label="搜索接收聊天"
            type="search"
            placeholder="搜索"
            value={search}
            onClear={() => setSearch('')}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="wx-forward-tabs">
            <button type="button" aria-pressed={tab === 'recent'} onClick={() => setTab('recent')}>
              最近聊天
            </button>
            <button
              type="button"
              aria-pressed={tab === 'contacts'}
              onClick={() => setTab('contacts')}
            >
              从通讯录选择
            </button>
          </div>
          {error && (
            <p role="alert" className="wx-forward-error">
              {error}
            </p>
          )}
          {results.map((r) => (
            <p key={r.conversationId} className={r.ok ? '' : 'wx-forward-error'}>
              {[...recent, ...directory].find((c) => c.id === r.conversationId)?.name ?? '聊天'}：
              {r.ok ? '已发送' : r.message}
            </p>
          ))}
          <div className="wx-forward-targets">
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={attempted || busy}
                aria-pressed={selected.includes(c.id)}
                onClick={() => toggle(c.id)}
              >
                <CheckCircle checked={selected.includes(c.id)} />
                {c.characterId ? (
                  <CharacterAvatar id={c.characterId} size={40} />
                ) : (
                  <span className="wx-forward-group">群</span>
                )}
                <span>{c.name}</span>
              </button>
            ))}
            {!list.length && <p>没有可选的聊天{tab === 'recent' ? '，可从通讯录选择' : ''}</p>}
          </div>
        </div>
      )}
    </Sheet>
  );
}
