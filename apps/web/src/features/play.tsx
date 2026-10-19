import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CheckCircle,
  Circle,
  EnvelopeSimple,
  EnvelopeSimpleOpen,
  Lock,
  PencilSimple,
  Plus,
  Timer,
} from './old-icons.js';
import {
  DailyQuestionEndpoints,
  FocusEndpoints,
  LetterEndpoints,
  LibraryEndpoints,
  PLAY_LIMITS,
  ReminderEndpoints,
  WishlistEndpoints,
  type DailyQuestionToday,
  type FocusSession,
  type Letter,
  type Message,
  type Reminder,
  type ReminderRepeat,
  type WishlistItem,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterAvatar } from './character-avatar.js';
import { openShare } from './share.js';
import { EmptyState, NavBar, Sheet } from './shell-kit.js';
import { Dialog, showToast } from './toast.js';

/*
 * 五个玩法（PLAY-03～PLAY-07；设计 play.md；契约 http/play.ts）。
 * 共同原则：不打卡、不惩罚、不催（SAFE-08）——任何页面都没有连续天数、完成率、累计时长、排行、「失败」。
 * 数据变化靠 data.changed(daily_question / wishlist / letters / focus / reminders) 重新拉。
 */

const chars = (text: string) => Array.from(text).length;
const code = (e: unknown) => (e instanceof ApiFailure ? e.code : '');
function dateText(value: string) {
  return new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
  });
}
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function useSection(section: string, refresh: () => void) {
  useUpdates((update) => {
    if (
      update.type === 'data.changed' &&
      (update.data as { section?: string } | undefined)?.section === section
    )
      refresh();
  });
}
function Header({ title, right, back }: { title: ReactNode; right?: ReactNode; back?: string }) {
  return <NavBar title={title} right={right} fallback={back ?? '/miniapps'} />;
}
/** 已通过的好友角色（玩法只和通讯录里的 TA 一起）。 */
function useFriends() {
  const { state } = useChat();
  const friends = state.contacts.filter((c) => c.status === 'active' && c.conversationId);
  const names = useCharacterNames(friends.map((c) => c.characterId));
  const nameOf = (id: string) =>
    state.contacts.find((c) => c.characterId === id)?.remark || names[id] || 'TA';
  return { friends, nameOf, initialized: state.initialized };
}
function CharacterPicker({
  value,
  onChange,
  label = '和谁一起',
  disabled = false,
}: {
  value: string | null;
  onChange(id: string): void;
  label?: string;
  disabled?: boolean;
}) {
  const { friends, nameOf, initialized } = useFriends();
  if (!initialized)
    return (
      <p className="hint" role="status">
        正在读取好友…
      </p>
    );
  if (friends.length === 0)
    return (
      <p className="hint">
        先添加一个 TA 吧 <Link to="/contacts/add">去添加</Link>
      </p>
    );
  return (
    <div role="radiogroup" aria-label={label} className="chip-row">
      {friends.map((f) => (
        <button
          key={f.characterId}
          role="radio"
          disabled={disabled}
          aria-checked={value === f.characterId}
          className={value === f.characterId ? 'play-pick selected' : 'play-pick'}
          onClick={() => onChange(f.characterId)}
        >
          <CharacterAvatar id={f.characterId} size={40} />
          <small>{nameOf(f.characterId)}</small>
        </button>
      ))}
    </div>
  );
}

// ---------- 服务页宫格（SVC-01） ----------

export function useLettersBadge() {
  const badge = useRemote(LetterEndpoints.getBadge, { networkOnly: true });
  useSection('letters', badge.refresh);
  return badge.data?.unreadCount ?? 0;
}
export function PlayServiceCards() {
  const unread = useLettersBadge();
  return (
    <>
      <Link to="/play/daily" className="service-card">
        每日一问<span>每天一题，和 TA 一起答</span>
      </Link>
      <Link to="/play/wishlists" className="service-card">
        心愿清单<span>想和 TA 一起做的事</span>
      </Link>
      <Link to="/play/letters" className="service-card">
        信箱
        {unread > 0 && <span className="red-dot" aria-label="有未读来信" />}
        <span>写一封慢慢寄到的信</span>
      </Link>
      <Link to="/play/focus" className="service-card">
        陪你专注<span>TA 安静陪你一会儿</span>
      </Link>
      <Link to="/play/reminders" className="service-card">
        TA 的提醒<span>到点让 TA 来叫你</span>
      </Link>
    </>
  );
}

// ---------- 每日一问（PLAY-03） ----------

export function DailyQuestionPage() {
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [today, setToday] = useState<DailyQuestionToday | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const requestId = useRef(crypto.randomUUID());
  const { nameOf, friends } = useFriends();
  useSection('daily_question', () => setRevision((v) => v + 1));
  useEffect(() => {
    let active = true;
    setState('loading');
    setToday(null);
    setError('');
    void api
      .call(DailyQuestionEndpoints.getToday, {
        query: { characterId: characterId ?? undefined },
        networkOnly: true,
      })
      .then((value) => {
        if (!active) return;
        setToday(value);
        setState('ready');
      })
      .catch((e) => {
        if (!active) return;
        setState(code(e) === 'not_found' ? 'empty' : 'error');
        setError(friendlyError(e));
      });
    return () => {
      active = false;
    };
  }, [characterId, revision]);
  const over = chars(answer) > PLAY_LIMITS.dailyAnswerMaxChars;
  async function submit() {
    if (pending || !today || !answer.trim() || over) return;
    setPending(true);
    setError('');
    try {
      setToday(
        await api.call(DailyQuestionEndpoints.answer, {
          body: {
            clientRequestId: requestId.current,
            characterId: today.characterId,
            questionId: today.questionId,
            answer: answer.trim(),
          },
        }),
      );
      setAnswer('');
    } catch (e) {
      if (code(e) === 'already_answered') setRevision((v) => v + 1);
      else setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  const answered = today?.answer;
  const selected = characterId ?? today?.characterId ?? null;
  const name = selected ? nameOf(selected) : 'TA';
  const conversationId = friends.find((f) => f.characterId === today?.characterId)?.conversationId;
  return (
    <main>
      <Header title="每日一问" right={<Link to="/play/daily/history">历史</Link>} />
      {state === 'loading' && (
        <>
          <div className="skeleton-card" role="status" aria-label="正在读取" />
          <p className="page-note hint center">正在准备今天的问题…</p>
        </>
      )}
      {state === 'error' && (
        <div className="empty">
          <p role="alert">{error || '加载失败'}</p>
          <button className="text-button" onClick={() => setRevision((v) => v + 1)}>
            重试
          </button>
        </div>
      )}
      {state === 'empty' && <p className="empty">今天还没有适合你们的问题，明天再来看看吧</p>}
      {state === 'ready' && today && (
        <>
          {!answered && (
            <>
              <h2 className="section-label">和谁一起答</h2>
              <CharacterPicker
                value={selected}
                disabled={pending}
                onChange={(id) => {
                  setAnswer('');
                  requestId.current = crypto.randomUUID();
                  setCharacterId(id);
                }}
                label="和谁一起答"
              />
            </>
          )}
          <section className="panel stack play-card" key={today.questionId}>
            <small className="hint">{dateText(today.date)} · 今天的问题</small>
            <strong className="play-question">{today.question}</strong>
            <div className="stack">
              <span className="section-label">我的回答</span>
              {answered ? (
                <p>{answered.userAnswer}</p>
              ) : (
                <>
                  <textarea
                    disabled={pending}
                    aria-label="我的回答"
                    placeholder="输入你的回答…"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                  />
                  <small className={over ? 'char-count error' : 'char-count hint'}>
                    {chars(answer)}/{PLAY_LIMITS.dailyAnswerMaxChars}
                  </small>
                </>
              )}
            </div>
            <div className="stack">
              <span className="section-label">{name} 的回答</span>
              {!answered ? (
                <p className="hint">
                  <Lock size={16} aria-hidden="true" /> 你答完就能看到 TA 的答案
                </p>
              ) : answered.characterAnswerStatus === 'ready' ? (
                <p className="play-reveal">{answered.characterAnswer}</p>
              ) : answered.characterAnswerStatus === 'waiting_balance' ? (
                <p className="hint">
                  积分不足，TA 暂时没法回答 <Link to="/wallet">查看积分</Link>
                </p>
              ) : (
                <p className="hint" role="status">
                  TA 正在想…
                </p>
              )}
            </div>
          </section>
          {error && <p role="alert">{error}</p>}
          {answered ? (
            conversationId && (
              <Link className="text-button" to={`/chat/${conversationId}`}>
                去和 {name} 聊聊 ›
              </Link>
            )
          ) : (
            <div className="page-bottom">
              <button
                className="primary full"
                disabled={pending || !answer.trim() || over}
                onClick={() => void submit()}
              >
                {pending ? '正在提交…' : '回答'}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export function DailyHistoryPage() {
  const [params] = useSearchParams();
  const focusId = params.get('answer');
  const { nameOf } = useFriends();
  const [items, setItems] = useState<
    Array<{
      answerId: string;
      date: string;
      characterId: string;
      question: string;
      userAnswer: string;
      characterAnswer: string | null;
    }>
  >([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(focusId);
  const load = useCallback(async (after?: string) => {
    setLoading(true);
    setError('');
    try {
      const page = await api.call(DailyQuestionEndpoints.listHistory, {
        query: { cursor: after },
        networkOnly: true,
      });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <main>
      <Header title="答过的问题" back="/play/daily" />
      {loading && items.length === 0 && (
        <p className="empty" role="status">
          正在读取答题记录…
        </p>
      )}
      {error && (
        <p role="alert">
          {error} <button onClick={() => void load()}>重试</button>
        </p>
      )}
      {!loading && !error && items.length === 0 && <p className="empty">还没有答过的问题</p>}
      <div className="panel rows">
        {items.map((item) => (
          <div key={item.answerId} className="stack">
            <button
              className="row-button"
              aria-expanded={open === item.answerId}
              onClick={() => setOpen(open === item.answerId ? null : item.answerId)}
            >
              <span className="overview-name">
                {item.question}
                <small className="hint">
                  {dateText(item.date)} · 和 {nameOf(item.characterId)}
                </small>
              </span>
            </button>
            {open === item.answerId && (
              <div className="stack pad">
                <span className="section-label">我的回答</span>
                <p>{item.userAnswer}</p>
                <span className="section-label">{nameOf(item.characterId)} 的回答</span>
                <p>{item.characterAnswer ?? '积分不足，TA 暂时没法回答'}</p>
              </div>
            )}
          </div>
        ))}
      </div>
      {cursor && (
        <button disabled={loading} onClick={() => void load(cursor)}>
          加载更多
        </button>
      )}
    </main>
  );
}

/** 私聊里的每日一问卡片（C 4.2 QuestionAnswerCard），点击回到历史里这一题。 */
export function DailyQuestionBubble({
  content,
}: {
  content: Extract<Message['content'], { type: 'daily_question' }>;
}) {
  return (
    <Link
      className="action-card play-chat-card"
      to={`/play/daily/history?answer=${content.answerId}`}
    >
      <small className="hint">每日一问 · {dateText(content.date)}</small>
      <strong>{content.question}</strong>
      <p>{content.answer}</p>
    </Link>
  );
}

// ---------- 心愿清单（PLAY-04） ----------

export function WishlistsPage() {
  const list = useRemote(WishlistEndpoints.listSummaries, { networkOnly: true });
  useSection('wishlist', list.refresh);
  const { friends, nameOf, initialized } = useFriends();
  const summaries = new Map(list.data?.items.map((s) => [s.characterId, s]) ?? []);
  return (
    <main>
      <Header title="心愿清单" />
      {list.error && (
        <p className="notice-bar" role="alert">
          {list.error}{' '}
          <button className="text-button" onClick={list.refresh}>
            重试
          </button>
        </p>
      )}
      {(list.loading || !initialized) && !list.data && (
        <p className="empty" role="status">
          正在读取心愿…
        </p>
      )}
      {initialized && friends.length === 0 && (
        <EmptyState
          title="还没有一起许愿的朋友"
          desc="先添加一个 TA，再列下想一起做的事"
          action={
            <Link className="text-button" to="/contacts/add">
              添加朋友
            </Link>
          }
        />
      )}
      <div className="panel rows">
        {[...friends]
          .sort(
            (a, b) =>
              (summaries.get(b.characterId)?.total ?? 0) -
              (summaries.get(a.characterId)?.total ?? 0),
          )
          .map((f) => {
            const s = summaries.get(f.characterId);
            return (
              <Link
                key={f.characterId}
                to={`/play/wishlists/${f.characterId}`}
                className="role-row"
              >
                <CharacterAvatar id={f.characterId} size={40} />
                <span className="overview-name">
                  {nameOf(f.characterId)}
                  <small className="hint">
                    {s && s.total > 0 ? `${s.total} 件心愿 · 完成 ${s.completed} 件` : '还没有心愿'}
                  </small>
                </span>
              </Link>
            );
          })}
      </div>
    </main>
  );
}

export function WishlistPage() {
  const { characterId = '' } = useParams();
  return <CharacterWishlist key={characterId} characterId={characterId} />;
}
function CharacterWishlist({ characterId }: { characterId: string }) {
  const { nameOf } = useFriends();
  const list = useRemote(WishlistEndpoints.listItems, {
    params: { characterId },
    networkOnly: true,
  });
  useSection('wishlist', list.refresh);
  const [items, setItems] = useState<WishlistItem[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<WishlistItem | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (list.data) setItems(list.data.items);
  }, [list.data]);
  const all = items ?? [];
  const limit = list.data?.limit ?? PLAY_LIMITS.wishlistItemsPerCharacter;
  const full = all.length >= limit;
  const open = all.filter((i) => !i.completedAt);
  const done = all.filter((i) => i.completedAt);
  const replace = (item: WishlistItem) =>
    setItems((prev) => (prev ?? []).map((i) => (i.itemId === item.itemId ? item : i)));
  async function add() {
    const value = text.trim();
    if (pending || !value || chars(value) > PLAY_LIMITS.wishlistItemMaxChars) return;
    setPending(true);
    try {
      const item = await api.call(WishlistEndpoints.addItem, {
        params: { characterId },
        body: { clientRequestId: crypto.randomUUID(), text: value },
      });
      setItems((prev) => [...(prev ?? []), item]);
      setText('');
      setAdding(false);
    } catch (e) {
      showToast(code(e) === 'limit_reached' ? `最多 ${limit} 件心愿` : friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  async function update(
    item: WishlistItem,
    body: { text?: string; dueDate?: string | null; completed?: boolean },
  ) {
    try {
      const next = await api.call(WishlistEndpoints.updateItem, {
        params: { itemId: item.itemId },
        body,
      });
      replace(next);
      if (body.completed && !item.completedAt)
        showToast(next.cardIssued ? '完成啦，获得一张瞬间卡' : '完成啦');
      return next;
    } catch (e) {
      showToast(friendlyError(e));
      return null;
    }
  }
  async function remove(item: WishlistItem) {
    try {
      await api.call(WishlistEndpoints.deleteItem, { params: { itemId: item.itemId } });
      setItems((prev) => (prev ?? []).filter((i) => i.itemId !== item.itemId));
      setEditing(null);
    } catch (e) {
      showToast(friendlyError(e));
    }
  }
  const row = (item: WishlistItem) => (
    <div key={item.itemId} className="play-wish">
      <button
        className="icon-button"
        aria-label={item.completedAt ? '取消完成' : '完成'}
        onClick={() => void update(item, { completed: !item.completedAt })}
      >
        {item.completedAt ? <CheckCircle size={24} weight="fill" /> : <Circle size={24} />}
      </button>
      <button className="row-button" onClick={() => setEditing(item)}>
        <span className="overview-name">
          {item.text}
          {item.dueDate && <span className="tag">{dateText(item.dueDate)} · 约定</span>}
          {item.proposedByCharacter && <small className="hint">TA 提议</small>}
        </span>
      </button>
    </div>
  );
  return (
    <main>
      <Header title={`和 ${nameOf(characterId)} 的心愿清单`} back="/play/wishlists" />
      <p className="hint">想和 TA 一起做的事</p>
      {list.error && (
        <div className="empty">
          <p role="alert">{list.error}</p>
          <button className="text-button" onClick={list.refresh}>
            重试
          </button>
        </div>
      )}
      {list.loading && !items && (
        <p className="empty" role="status">
          正在读取心愿…
        </p>
      )}
      {items && all.length === 0 && !adding && (
        <div className="empty">
          <p>和 TA 一起列下想做的事吧</p>
          <button className="primary" onClick={() => setAdding(true)}>
            添加第一件
          </button>
        </div>
      )}
      {open.length > 0 && <div className="panel">{open.map(row)}</div>}
      {items &&
        (all.length > 0 || adding) &&
        (adding ? (
          <form
            className="message-composer stacked-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <label>
              想一起做的事
              <input
                autoFocus
                disabled={pending}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <small
              className={
                chars(text) > PLAY_LIMITS.wishlistItemMaxChars
                  ? 'char-count error'
                  : 'char-count hint'
              }
            >
              {chars(text)}/{PLAY_LIMITS.wishlistItemMaxChars}
            </small>
            <button
              className="text-button"
              disabled={pending || !text.trim() || chars(text) > PLAY_LIMITS.wishlistItemMaxChars}
              aria-busy={pending}
            >
              {pending ? '正在添加…' : '添加'}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => {
                setAdding(false);
                setText('');
              }}
            >
              取消
            </button>
          </form>
        ) : (
          <button className="text-button" disabled={full} onClick={() => setAdding(true)}>
            <Plus size={16} /> 添加一件想一起做的事
          </button>
        ))}
      {full && <p className="hint">最多 {limit} 件心愿</p>}
      {done.length > 0 && (
        <>
          <button
            className="row-button"
            aria-expanded={showDone}
            onClick={() => setShowDone(!showDone)}
          >
            已完成 {done.length} {showDone ? '⌃' : '⌄'}
          </button>
          {showDone && <div className="panel">{done.map(row)}</div>}
        </>
      )}
      {editing && (
        <WishSheet
          key={editing.itemId}
          item={editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const next = await update(editing, body);
            if (next) setEditing(null);
          }}
          onDelete={() => void remove(editing)}
        />
      )}
    </main>
  );
}

function WishSheet({
  item,
  onClose,
  onSave,
  onDelete,
}: {
  item: WishlistItem;
  onClose(): void;
  onSave(body: { text?: string; dueDate?: string | null }): Promise<void>;
  onDelete(): void;
}) {
  const [text, setText] = useState(item.text);
  const [date, setDate] = useState(item.dueDate ?? '');
  const [saving, setSaving] = useState(false);
  const tooLong = chars(text.trim()) > PLAY_LIMITS.wishlistItemMaxChars;
  async function save(body: { text?: string; dueDate?: string | null }) {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(body);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Sheet
      title="编辑心愿"
      closeLabel="取消"
      closeDisabled={saving}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <div className="stack">
        <label>
          心愿
          <input disabled={saving} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label>
          定个日期
          <input
            type="date"
            disabled={saving}
            value={date}
            min={todayLocal()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {date && <small className="hint">定了日期，TA 到时会来问你</small>}
        {item.dueDate && (
          <button
            className="text-button"
            disabled={saving}
            onClick={() => void save({ dueDate: null })}
          >
            取消日期
          </button>
        )}
        <div className="button-row">
          <button
            className="primary full"
            disabled={saving || !text.trim() || tooLong}
            aria-busy={saving}
            onClick={() =>
              void save({
                ...(text.trim() !== item.text ? { text: text.trim() } : {}),
                ...(date !== (item.dueDate ?? '') ? { dueDate: date || null } : {}),
              })
            }
          >
            {saving ? '正在保存…' : '保存'}
          </button>
        </div>
        <button className="danger" disabled={saving} onClick={onDelete}>
          删除
        </button>
      </div>
    </Sheet>
  );
}

/** 聊天信息页「和 TA 的相处」› 心愿清单（与服务页同一张清单）。 */
export function WishlistRow({ characterId }: { characterId: string }) {
  return <Link to={`/play/wishlists/${characterId}`}>心愿清单</Link>;
}

// ---------- 慢信（PLAY-05） ----------

export function LettersPage() {
  const navigate = useNavigate();
  const [box, setBox] = useState<'received' | 'sent' | 'drafts'>('received');
  const unread = useLettersBadge();
  const { nameOf } = useFriends();
  const [items, setItems] = useState<Letter[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [picking, setPicking] = useState(false);
  useSection('letters', () => setRevision((v) => v + 1));
  const load = useCallback(
    async (after?: string) => {
      setLoading(true);
      setError('');
      try {
        const page = await api.call(LetterEndpoints.listLetters, {
          query: { box, cursor: after },
          networkOnly: true,
        });
        setItems((prev) => (after ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    },
    [box],
  );
  useEffect(() => {
    void load();
  }, [load, revision]);
  const firstLine = (body: string | null) => (body ?? '').split(/\n/)[0]?.slice(0, 40) ?? '';
  return (
    <main>
      <Header
        title="信箱"
        back="/services"
        right={
          <button className="icon-button" aria-label="写信" onClick={() => setPicking(true)}>
            <PencilSimple size={24} />
          </button>
        }
      />
      <div className="play-tabs" role="tablist">
        {(
          [
            ['received', '收到的'],
            ['sent', '寄出的'],
            ['drafts', '草稿'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={box === key} onClick={() => setBox(key)}>
            {label}
            {key === 'received' && unread > 0 && <span className="red-dot" aria-label="有未读" />}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert">
          {error} <button onClick={() => void load()}>重试</button>
        </p>
      )}
      {loading && items.length === 0 && (
        <p className="page-note" role="status">
          正在读取信件…
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="empty">
          {box === 'received' ? '还没有收到信' : box === 'sent' ? '还没有寄出过信' : '没有草稿'}
        </p>
      )}
      {items.length > 0 && (
        <div className="panel">
          {items.map((l) => {
          const inTransit = l.status === 'in_transit';
          const unreadLetter = l.direction === 'from_character' && !inTransit && !l.readAt;
          return (
            <button
              key={l.letterId}
              className="play-letter-row"
              onClick={() =>
                box === 'drafts'
                  ? navigate(`/play/letters/new?characterId=${l.characterId}`)
                  : !inTransit && navigate(`/play/letters/${l.letterId}`)
              }
            >
              {unreadLetter ? (
                <EnvelopeSimple size={32} weight="fill" aria-hidden="true" />
              ) : (
                <EnvelopeSimpleOpen size={32} aria-hidden="true" />
              )}
              <span className="overview-name">
                <strong>
                  {nameOf(l.characterId)}
                  {unreadLetter && <span className="red-dot" aria-label="未读" />}
                </strong>
                {inTransit ? (
                  <small className="hint">
                    信件在路上
                    {l.expectedDeliveryDate === todayLocal() ? ' · 预计今天送到' : ''}
                  </small>
                ) : (
                  <small className="hint">「{firstLine(l.body)}」</small>
                )}
                <small className="hint">
                  {box === 'received' && l.deliveredAt && `${dateText(l.deliveredAt)} 送达`}
                  {box === 'sent' && l.sentAt && `${dateText(l.sentAt)} 寄出`}
                  {box === 'drafts' && `${dateText(l.updatedAt)} 保存`}
                </small>
              </span>
            </button>
          );
        })}
        </div>
      )}
      {cursor && (
        <button disabled={loading} onClick={() => void load(cursor)}>
          加载更多
        </button>
      )}
      {picking && (
        <Sheet title="写给谁" closeLabel="取消" onClose={() => setPicking(false)} half>
          <div className="stack">
            <CharacterPicker
              value={null}
              label="写给谁"
              onChange={(id) => navigate(`/play/letters/new?characterId=${id}`)}
            />
          </div>
        </Sheet>
      )}
    </main>
  );
}

export function WriteLetterPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const characterId = params.get('characterId');
  const { nameOf, friends } = useFriends();
  const [body, setBody] = useState('');
  const [original, setOriginal] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [repliedToday, setRepliedToday] = useState(false);
  const [draftLoading, setDraftLoading] = useState(!!characterId);
  const [draftError, setDraftError] = useState('');
  const [draftRevision, setDraftRevision] = useState(0);
  const requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!characterId) return;
    let active = true;
    setDraftLoading(true);
    setDraftError('');
    void api
      .call(LetterEndpoints.listLetters, {
        query: { box: 'drafts', characterId },
        networkOnly: true,
      })
      .then((page) => {
        const draft = page.items[0]?.body ?? '';
        if (active && draft) {
          setBody((current) => current || draft);
          setOriginal(draft);
        }
      })
      .catch((error) => {
        if (active) setDraftError(friendlyError(error));
      })
      .finally(() => {
        if (active) setDraftLoading(false);
      });
    void api
      .call(LetterEndpoints.listLetters, {
        query: { box: 'received', characterId },
        networkOnly: true,
      })
      .then((page) => {
        const today = todayLocal();
        if (active)
          setRepliedToday(
            page.items.some(
              (l) => l.inReplyToLetterId && l.deliveredAt && l.deliveredAt.slice(0, 10) === today,
            ),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [characterId, draftRevision]);
  if (!characterId)
    return (
      <main>
        <Header title="写信" />
        <CharacterPicker
          value={null}
          label="写给谁"
          onChange={(id) => navigate(`/play/letters/new?characterId=${id}`, { replace: true })}
        />
      </main>
    );
  const name = nameOf(characterId);
  const over = chars(body) > PLAY_LIMITS.letterMaxChars;
  async function send() {
    if (pending || draftLoading || !characterId || !body.trim() || over) return;
    setPending(true);
    setError('');
    try {
      const result = await api.call(LetterEndpoints.sendLetter, {
        body: { clientRequestId: requestId.current, characterId, body: body.trim() },
      });
      showToast(
        result.replyDelayReason === 'already_replied_today'
          ? '已寄出，TA 今天已回过信，这封的回信会晚一些到'
          : result.replyDelayReason === 'outside_active_window'
            ? '已寄出，回信会在你通常活跃的时段送达'
            : result.replyDelayed
              ? '已寄出，这封的回信会晚一些到'
              : '已寄出',
      );
      const conversationId = friends.find((f) => f.characterId === characterId)?.conversationId;
      navigate(conversationId ? `/chat/${conversationId}` : '/play/letters', { replace: true });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  async function saveDraft() {
    if (!characterId || pending) return;
    setPending(true);
    setError('');
    try {
      await api.call(LetterEndpoints.saveDraft, {
        params: { characterId },
        body: { body: body.slice(0, PLAY_LIMITS.letterMaxChars) },
      });
      showToast('已保存草稿');
      navigate(-1);
    } catch (e) {
      setError(friendlyError(e));
      setLeaving(false);
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="play-letter-page">
      <header className="page-header">
        <button
          className="text-button"
          disabled={pending}
          onClick={() => (body.trim() && body !== original ? setLeaving(true) : navigate(-1))}
        >
          取消
        </button>
        <h1>给 {name} 的信</h1>
        <button
          className="text-button primary-text"
          disabled={pending || draftLoading || !body.trim() || over}
          onClick={() => void send()}
        >
          {pending ? (leaving ? '正在保存…' : '正在寄出…') : '寄出'}
        </button>
      </header>
      {draftLoading && (
        <p className="page-note" role="status">
          正在恢复草稿…
        </p>
      )}
      {draftError && (
        <div className="page-note">
          <p role="alert">{draftError}</p>
          <button
            className="text-button"
            disabled={draftLoading}
            onClick={() => setDraftRevision((v) => v + 1)}
          >
            重试读取草稿
          </button>
        </div>
      )}
      <div className="play-paper">
        <p>{name}：</p>
        <textarea
          aria-label="信的正文"
          autoFocus
          disabled={pending || draftLoading}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <small className={over ? 'char-count error' : 'char-count hint'}>
          {chars(body)}/{PLAY_LIMITS.letterMaxChars}
        </small>
      </div>
      {error && <p role="alert">{error}</p>}
      <p className="hint">
        {repliedToday
          ? 'TA 今天已经回过一封信了，这封的回信会晚一些到'
          : `回信会在 ${PLAY_LIMITS.letterReplyDelayMinHours}–${PLAY_LIMITS.letterReplyDelayMaxHours} 小时后寄到`}
      </p>
      {leaving && (
        <Sheet
          title="离开写信页"
          closeLabel="继续写"
          closeDisabled={pending}
          onClose={() => {
            if (!pending) setLeaving(false);
          }}
        >
          <div className="stack">
            <p>要保存这封信的草稿吗？</p>
            <button
              className="primary"
              disabled={pending}
              aria-busy={pending}
              onClick={() => void saveDraft()}
            >
              {pending ? '正在保存…' : '保存草稿'}
            </button>
            <button disabled={pending} onClick={() => navigate(-1)}>
              不保存
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}

export function LetterPage() {
  const { letterId = '' } = useParams();
  const navigate = useNavigate();
  const { friends, nameOf } = useFriends();
  const letter = useRemote(LetterEndpoints.getLetter, { params: { letterId }, networkOnly: true });
  const l = letter.data;
  const conversationId = l
    ? friends.find((f) => f.characterId === l.characterId)?.conversationId
    : undefined;
  async function favorite() {
    if (!l?.messageId || !conversationId) return;
    try {
      await api.call(LibraryEndpoints.addFavorites, {
        body: { items: [{ kind: 'message', conversationId, messageId: l.messageId }] },
      });
      showToast('已收藏');
    } catch (e) {
      showToast(friendlyError(e));
    }
  }
  return (
    <main className="play-letter-page">
      <Header title="" back="/play/letters" />
      {letter.error && <p className="empty">{letter.error}</p>}
      {letter.loading && !l && <div className="skeleton-card" role="status" />}
      {l && (
        <article className="play-paper">
          <h2>
            {l.direction === 'from_character'
              ? `${nameOf(l.characterId)} 寄给你的信`
              : `你寄给 ${nameOf(l.characterId)} 的信`}
          </h2>
          <small className="hint">
            {l.deliveredAt ? dateText(l.deliveredAt) : l.sentAt ? dateText(l.sentAt) : ''}
          </small>
          {l.status === 'in_transit' || l.body === null ? (
            <p className="hint">信件在路上</p>
          ) : (
            <p className="play-letter-body">{l.body}</p>
          )}
        </article>
      )}
      {l && l.status !== 'in_transit' && (
        <div className="button-row play-letter-actions">
          <button disabled={!l.messageId || !conversationId} onClick={() => void favorite()}>
            收藏
          </button>
          <button
            disabled={!l.messageId || !conversationId}
            onClick={() =>
              conversationId &&
              l.messageId &&
              openShare(navigate, {
                kind: 'messages',
                conversationId,
                messageIds: [l.messageId],
              })
            }
          >
            生成分享图
          </button>
          <button onClick={() => navigate(`/play/letters/new?characterId=${l.characterId}`)}>
            回信
          </button>
        </div>
      )}
    </main>
  );
}

/** 私聊里的信件卡片（C 4.2 LetterCard）。 */
export function LetterBubble({
  content,
  characterId,
}: {
  content: Extract<Message['content'], { type: 'letter' }>;
  characterId: string;
}) {
  const { nameOf } = useFriends();
  const name = nameOf(characterId);
  return (
    <Link className="action-card play-chat-card" to={`/play/letters/${content.letterId}`}>
      <span className="role-row">
        <EnvelopeSimple size={24} aria-hidden="true" />
        <strong>
          {content.direction === 'to_character'
            ? `你给 ${name} 寄了一封信`
            : `${name} 给你寄来了一封信`}
        </strong>
      </span>
      <small className="hint clamp-2">{content.body}</small>
    </Link>
  );
}

// ---------- 陪你专注（PLAY-06） ----------

export function useActiveFocus() {
  const focus = useRemote(FocusEndpoints.getActive, { networkOnly: true });
  useSection('focus', focus.refresh);
  return {
    session: focus.data?.session ?? null,
    refresh: focus.refresh,
    loading: focus.loading,
    error: focus.error,
  };
}

function remainingText(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** 收起后顶部的 FocusCapsule（专注页以外显示）。 */
export function FocusCapsule() {
  const location = useLocation();
  const { session } = useActiveFocus();
  const running = !!session && session.result === 'in_progress';
  const now = useNow(running);
  if (!running || location.pathname.startsWith('/play/focus')) return null;
  const left = new Date(session.endsAt).getTime() - now;
  if (left <= 0) return null;
  return (
    <Link to="/play/focus" className="play-capsule" aria-label="正在专注">
      <Timer size={16} aria-hidden="true" /> 专注中 {remainingText(left)}
    </Link>
  );
}

export function FocusPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { session, refresh, loading, error: loadError } = useActiveFocus();
  const [characterId, setCharacterId] = useState<string | null>(params.get('characterId'));
  const [preset, setPreset] = useState<number | 'custom'>(25);
  const [custom, setCustom] = useState(30);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [finished, setFinished] = useState<FocusSession | null>(null);
  const { nameOf, friends } = useFriends();
  const running =
    session && session.result === 'in_progress' && session.focusId !== finished?.focusId
      ? session
      : null;
  const now = useNow(!!running);
  const minutes = preset === 'custom' ? custom : preset;
  const validMinutes =
    Number.isInteger(minutes) &&
    minutes >= PLAY_LIMITS.focusMinMinutes &&
    minutes <= PLAY_LIMITS.focusMaxMinutes;
  async function start() {
    if (pending || !characterId || !validMinutes) return;
    setPending(true);
    setError('');
    try {
      await api.call(FocusEndpoints.start, {
        body: {
          clientRequestId: crypto.randomUUID(),
          characterId,
          minutes,
          note: note.trim() || null,
        },
      });
      setFinished(null);
      refresh();
    } catch (e) {
      if (code(e) === 'focus_in_progress') refresh();
      setError(code(e) === 'focus_in_progress' ? '已经有一次专注在进行中' : friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  async function end() {
    if (!running || pending) return;
    setConfirmEnd(false);
    setPending(true);
    try {
      setFinished(await api.call(FocusEndpoints.end, { params: { focusId: running.focusId } }));
      refresh();
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  const chatOf = (id: string) => friends.find((f) => f.characterId === id)?.conversationId;
  if (running) {
    const left = new Date(running.endsAt).getTime() - now;
    const name = nameOf(running.characterId);
    const done = left <= 0;
    return (
      <main className="play-focus">
        <header className="page-header">
          <span />
          <span />
          <button className="text-button" onClick={() => navigate(-1)}>
            收起
          </button>
        </header>
        <div className="play-focus-body">
          <CharacterAvatar id={running.characterId} size={64} />
          <p className="hint">
            {name} 在陪你{running.note ? ` · ${running.note}` : ''}
          </p>
          <p className="play-timer numeric" role="timer" aria-live="off">
            {remainingText(left)}
          </p>
          {done && <p>专注结束</p>}
        </div>
        {done ? (
          chatOf(running.characterId) && (
            <Link className="button primary" to={`/chat/${chatOf(running.characterId)}`}>
              去和 {name} 聊聊
            </Link>
          )
        ) : (
          <button disabled={pending} aria-busy={pending} onClick={() => setConfirmEnd(true)}>
            {pending ? '正在结束…' : '提前结束'}
          </button>
        )}
        {confirmEnd && (
          <Dialog
            title="结束这次专注？"
            actions={[
              { label: '取消', onClick: () => setConfirmEnd(false) },
              { label: '结束', primary: true, onClick: () => void end() },
            ]}
          />
        )}
      </main>
    );
  }
  if (finished) {
    const name = nameOf(finished.characterId);
    return (
      <main className="play-focus">
        <Header title="专注已结束" back="/miniapps" />
        <div className="play-focus-body">
          <CharacterAvatar id={finished.characterId} size={64} />
          <p>这次专注结束了</p>
        </div>
        {chatOf(finished.characterId) && (
          <Link className="button primary" to={`/chat/${chatOf(finished.characterId)}`}>
            去和 {name} 聊聊
          </Link>
        )}
      </main>
    );
  }
  if (loading || loadError)
    return (
      <main className="play-focus-setup">
        <Header title="陪你专注" />
        {loadError ? (
          <div className="empty">
            <p role="alert">{loadError}</p>
            <button className="text-button" disabled={loading} onClick={refresh}>
              {loading ? '正在重试…' : '重试'}
            </button>
          </div>
        ) : (
          <p className="page-note" role="status">
            正在读取专注状态…
          </p>
        )}
      </main>
    );
  return (
    <main className="play-focus-setup">
      <Header title={characterId ? `和 ${nameOf(characterId)} 一起专注` : '陪你专注'} />
      {!params.get('characterId') && (
        <>
          <h2 className="section-label">选一个 TA 陪你</h2>
          <CharacterPicker value={characterId} onChange={setCharacterId} label="选一个 TA 陪你" />
        </>
      )}
      <h2 className="section-label">时长</h2>
      <div className="chip-row" role="radiogroup" aria-label="时长">
        {([25, 45, 60, 90, 'custom'] as const).map((value) => (
          <button
            key={value}
            role="radio"
            aria-checked={preset === value}
            className={preset === value ? 'chip selected' : 'chip'}
            onClick={() => setPreset(value)}
          >
            {value === 'custom' ? '自定义' : `${value} 分钟`}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <label>
          分钟（{PLAY_LIMITS.focusMinMinutes}–{PLAY_LIMITS.focusMaxMinutes}）
          <input
            type="number"
            min={PLAY_LIMITS.focusMinMinutes}
            max={PLAY_LIMITS.focusMaxMinutes}
            value={custom}
            onChange={(e) => setCustom(Number(e.target.value))}
          />
        </label>
      )}
      <label className="stack play-focus-note">
        做什么（选填）
        <input
          value={note}
          maxLength={PLAY_LIMITS.focusNoteMaxChars}
          onChange={(e) => setNote(e.target.value)}
        />
        <small className="hint">TA 可能会记住这件事</small>
      </label>
      {error && <p role="alert">{error}</p>}
      <button
        className="primary"
        disabled={pending || !characterId || !validMinutes}
        aria-busy={pending}
        onClick={() => void start()}
      >
        {pending ? '正在开始…' : '开始专注'}
      </button>
    </main>
  );
}

// ---------- TA 的提醒（PLAY-07） ----------

const weekdayNames = ['一', '二', '三', '四', '五', '六', '日'];
function repeatText(repeat: ReminderRepeat) {
  switch (repeat.kind) {
    case 'once':
      return dateText(repeat.date);
    case 'daily':
      return '每天';
    case 'workdays':
      return '工作日';
    case 'weekly':
      return `每周${repeat.weekdays.map((d) => weekdayNames[d - 1]).join('、')}`;
  }
}

export function RemindersPage() {
  const navigate = useNavigate();
  const list = useRemote(ReminderEndpoints.listReminders, { networkOnly: true });
  useSection('reminders', list.refresh);
  const { nameOf } = useFriends();
  const [items, setItems] = useState<Reminder[] | null>(null);
  useEffect(() => {
    if (list.data) setItems(list.data.items);
  }, [list.data]);
  const limit = list.data?.limit ?? PLAY_LIMITS.remindersPerUser;
  const all = [...(items ?? [])].sort((a, b) => a.time.localeCompare(b.time));
  const full = all.length >= limit;
  async function toggle(r: Reminder) {
    setItems((prev) =>
      (prev ?? []).map((x) => (x.reminderId === r.reminderId ? { ...x, enabled: !r.enabled } : x)),
    );
    try {
      const next = await api.call(ReminderEndpoints.updateReminder, {
        params: { reminderId: r.reminderId },
        body: { enabled: !r.enabled },
      });
      setItems((prev) => (prev ?? []).map((x) => (x.reminderId === next.reminderId ? next : x)));
    } catch (e) {
      setItems((prev) => (prev ?? []).map((x) => (x.reminderId === r.reminderId ? r : x)));
      showToast(friendlyError(e));
    }
  }
  return (
    <main>
      <Header
        title="TA 的提醒"
        right={
          <button
            className="icon-button"
            aria-label="新建提醒"
            aria-disabled={full}
            onClick={() =>
              full ? showToast(`最多 ${limit} 条提醒`) : navigate('/play/reminders/new')
            }
          >
            <Plus size={24} />
          </button>
        }
      />
      {list.error && (
        <div className="empty">
          <p role="alert">{list.error}</p>
          <button onClick={list.refresh}>重试</button>
        </div>
      )}
      {list.loading && !items && (
        <p className="empty" role="status">
          正在读取提醒…
        </p>
      )}
      {items && all.length === 0 && (
        <div className="empty">
          <p>设一个提醒，让 TA 来叫你</p>
          <Link className="button primary" to="/play/reminders/new">
            新建提醒
          </Link>
        </div>
      )}
      {all.length > 0 && (
        <div className="panel">
          {all.map((r) => (
            <div key={r.reminderId} className="play-reminder">
              <Link to={`/play/reminders/${r.reminderId}`} className="overview-name">
                <span>
                  <strong className="numeric">{r.time}</strong> {r.text}
                  {r.health && <span className="tag">健康</span>}
                </span>
                <small className="hint role-row">
                  <CharacterAvatar id={r.characterId} size={20} /> {nameOf(r.characterId)} 提醒 ·{' '}
                  {repeatText(r.repeat)}
                  {r.pausedByContactRemoval && ' · 已暂停'}
                </small>
              </Link>
              <input
                type="checkbox"
                role="switch"
                aria-label={r.enabled ? '关闭提醒' : '打开提醒'}
                checked={r.enabled}
                onChange={() => void toggle(r)}
              />
            </div>
          ))}
        </div>
      )}
      {all.length > 0 && (
        <p className="hint">
          {all.length} / {limit}
        </p>
      )}
    </main>
  );
}

const quickTexts = ['喝水', '早点睡', '带伞', '吃药', '交作业'];

export function ReminderEditPage() {
  const { reminderId } = useParams();
  const navigate = useNavigate();
  const editing = !!reminderId && reminderId !== 'new';
  const list = useRemote(ReminderEndpoints.listReminders, { networkOnly: true });
  const existing = editing ? list.data?.items.find((r) => r.reminderId === reminderId) : undefined;
  if (editing && list.loading && !list.data)
    return (
      <main>
        <Header title="编辑提醒" />
        <p className="empty" role="status">
          正在读取提醒…
        </p>
      </main>
    );
  if (editing && list.error && !list.data)
    return (
      <main>
        <Header title="编辑提醒" />
        <div className="empty">
          <p role="alert">{list.error}</p>
          <button onClick={list.refresh}>重试</button>
        </div>
      </main>
    );
  if (editing && list.data && !existing)
    return (
      <main>
        <Header title="编辑提醒" />
        <p className="empty">这条提醒不存在了</p>
      </main>
    );
  return (
    <ReminderForm
      key={existing?.reminderId ?? 'new'}
      reminder={existing}
      onDone={() => navigate('/play/reminders', { replace: true })}
    />
  );
}

function ReminderForm({ reminder, onDone }: { reminder?: Reminder; onDone(): void }) {
  const { nameOf } = useFriends();
  const [text, setText] = useState(reminder?.text ?? '');
  const [time, setTime] = useState(reminder?.time ?? '22:30');
  const [kind, setKind] = useState<ReminderRepeat['kind']>(reminder?.repeat.kind ?? 'daily');
  const [date, setDate] = useState(
    reminder?.repeat.kind === 'once' ? reminder.repeat.date : todayLocal(),
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    reminder?.repeat.kind === 'weekly' ? reminder.repeat.weekdays : [1],
  );
  const [query] = useSearchParams();
  const [characterId, setCharacterId] = useState<string | null>(
    reminder?.characterId ?? query.get('characterId'),
  );
  const [health, setHealth] = useState(reminder?.health ?? false);
  const [bypass, setBypass] = useState(reminder?.bypassDoNotDisturb ?? false);
  const [medicineHint, setMedicineHint] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const length = chars(text.trim());
  const repeat: ReminderRepeat =
    kind === 'once'
      ? { kind, date }
      : kind === 'weekly'
        ? { kind, weekdays: [...weekdays].sort() }
        : { kind, weekdays: [] };
  const valid =
    length > 0 &&
    length <= PLAY_LIMITS.reminderTextMaxChars &&
    !!characterId &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(time) &&
    (kind !== 'weekly' || weekdays.length > 0) &&
    (kind !== 'once' || !!date);
  async function save() {
    if (pending || !valid || !characterId) return;
    setPending(true);
    setError('');
    try {
      const common = {
        text: text.trim(),
        time,
        repeat,
        health,
        bypassDoNotDisturb: bypass,
        enabled: reminder?.enabled ?? true,
      };
      if (reminder)
        await api.call(ReminderEndpoints.updateReminder, {
          params: { reminderId: reminder.reminderId },
          body: common,
        });
      else
        await api.call(ReminderEndpoints.createReminder, {
          body: { ...common, characterId, clientRequestId: crypto.randomUUID() },
        });
      showToast('已保存');
      onDone();
    } catch (e) {
      setError(
        code(e) === 'limit_reached'
          ? `最多 ${PLAY_LIMITS.remindersPerUser} 条提醒`
          : friendlyError(e),
      );
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    if (!reminder) return;
    try {
      await api.call(ReminderEndpoints.deleteReminder, {
        params: { reminderId: reminder.reminderId },
      });
      showToast('已删除');
      onDone();
    } catch (e) {
      setError(friendlyError(e));
    }
  }
  return (
    <main>
      <Header title={reminder ? '编辑提醒' : '新建提醒'} />
      <div className="panel stack">
        <label>
          提醒什么
          <input value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <small
          className={
            length > PLAY_LIMITS.reminderTextMaxChars ? 'char-count error' : 'char-count hint'
          }
        >
          {length}/{PLAY_LIMITS.reminderTextMaxChars}
        </small>
        <div className="chip-row">
          {quickTexts.map((q) => (
            <button
              key={q}
              type="button"
              className="chip"
              onClick={() => {
                setText(q);
                setMedicineHint(q === '吃药');
              }}
            >
              {q}
            </button>
          ))}
        </div>
      </div>
      <div className="panel stack">
        <label>
          时间
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label>
          重复
          <select value={kind} onChange={(e) => setKind(e.target.value as ReminderRepeat['kind'])}>
            <option value="once">不重复</option>
            <option value="daily">每天</option>
            <option value="workdays">工作日</option>
            <option value="weekly">自定义</option>
          </select>
        </label>
        {kind === 'once' && (
          <label>
            日期
            <input
              type="date"
              value={date}
              min={todayLocal()}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        )}
        {kind === 'weekly' && (
          <div className="chip-row reminder-weekdays" role="group" aria-label="选星期">
            {weekdayNames.map((n, i) => {
              const d = i + 1;
              const on = weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  className={on ? 'chip selected' : 'chip'}
                  onClick={() =>
                    setWeekdays(on ? weekdays.filter((x) => x !== d) : [...weekdays, d])
                  }
                >
                  周{n}
                </button>
              );
            })}
          </div>
        )}
        <span>谁来提醒</span>
        {reminder ? (
          <span className="role-row">
            <CharacterAvatar id={reminder.characterId} size={24} />
            {nameOf(reminder.characterId)}
          </span>
        ) : (
          <CharacterPicker value={characterId} onChange={setCharacterId} label="谁来提醒" />
        )}
      </div>
      <div className="panel stack">
        <label className="switch-row">
          <span>
            归类为「健康」
            <br />
            <small className="hint">推送不显示内容，也不能生成分享图</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="归类为健康"
            checked={health}
            onChange={(e) => setHealth(e.target.checked)}
          />
        </label>
        {medicineHint && !health && <small className="hint">吃药类提醒建议归类为健康</small>}
        <label className="switch-row">
          <span>
            免打扰时段也提醒
            <br />
            <small className="hint">默认会避开 服务 › 主动消息与免打扰 里的时段</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="免打扰时段也提醒"
            checked={bypass}
            onChange={(e) => setBypass(e.target.checked)}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <button
        className="primary reminder-save"
        disabled={pending || !valid}
        onClick={() => void save()}
      >
        {pending ? '正在保存…' : '保存'}
      </button>
      {reminder && (
        <button className="danger full" onClick={() => setConfirmDelete(true)}>
          删除提醒
        </button>
      )}
      {confirmDelete && (
        <Dialog
          title="删除这条提醒？"
          actions={[
            { label: '取消', onClick: () => setConfirmDelete(false) },
            { label: '删除', primary: true, onClick: () => void remove() },
          ]}
        />
      )}
    </main>
  );
}
