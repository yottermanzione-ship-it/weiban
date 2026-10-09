import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Camera, ChatCircle, Megaphone } from '@phosphor-icons/react';
import {
  CompanionEndpoints,
  DailyEventEndpoints,
  TimelineEndpoints,
  type DailyEvent,
  type TimelineEntry,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { CharacterName } from './chat.js';
import { KindIcon } from './while-away.js';

/** 页面内部统一的条目形状：优先来自时间线列表接口（契约 3.0），服务器未提供时退回日常事件接口。 */
interface Item {
  id: string;
  date: string;
  time: string;
  summary: string;
  kind: string;
  source: 'daily_event' | 'moments_post' | 'character_interaction' | 'public_update' | 'other';
  withCharacterIds: string[];
  ref: TimelineEntry['ref'];
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromEntry(entry: TimelineEntry): Item {
  const at = new Date(entry.occurredAt);
  const known = ['daily_event', 'moments_post', 'character_interaction', 'public_update'];
  return {
    id: entry.entryId,
    date: localDate(at),
    time: at.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    summary: entry.summary,
    kind: entry.kind ?? '',
    source: known.includes(entry.source) ? (entry.source as Item['source']) : 'other',
    withCharacterIds: entry.withCharacterIds,
    ref: entry.ref,
  };
}
function fromDailyEvent(event: DailyEvent): Item {
  return {
    id: event.eventId,
    date: event.eventDate,
    time: event.eventTime ?? '',
    summary: event.summary,
    kind: '',
    source: event.source === 'public_feed' ? 'public_update' : 'daily_event',
    withCharacterIds: event.withCharacterId ? [event.withCharacterId] : [],
    ref: null,
  };
}

async function fetchPage(
  characterId: string,
  cursor: string | undefined,
  legacy: boolean,
): Promise<{ items: Item[]; nextCursor: string | null; legacy: boolean }> {
  if (!legacy) {
    try {
      const page = await api.call(TimelineEndpoints.listTimeline, {
        params: { characterId },
        query: { limit: 20, cursor },
      });
      return { items: page.items.map(fromEntry), nextCursor: page.nextCursor, legacy: false };
    } catch (e) {
      if (!(e instanceof ApiFailure && e.status === 404) || cursor) throw e;
    }
  }
  const page = await api.call(DailyEventEndpoints.listByCharacter, {
    params: { characterId },
    query: { limit: 30, cursor },
  });
  return { items: page.items.map(fromDailyEvent), nextCursor: page.nextCursor, legacy: true };
}

function dayLabel(date: string): string {
  const today = new Date();
  if (date === localDate(today)) return '今天';
  if (date === localDate(new Date(today.getTime() - 86400000))) return '昨天';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const week = ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()];
  return `${m} 月 ${d} 日 星期${week}`;
}

function SourceIcon({ item }: { item: Item }) {
  if (item.source === 'moments_post') return <Camera size={16} aria-hidden />;
  if (item.source === 'character_interaction') return <ChatCircle size={16} aria-hidden />;
  if (item.source === 'public_update') return <Megaphone size={16} aria-hidden />;
  return <KindIcon kind={item.kind} />;
}

function TimelineItem({ item, onAsk }: { item: Item; onAsk?(text: string): void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="timeline-item">
      <span className="timeline-dot" aria-hidden />
      <div className="timeline-content">
        <small className="timeline-time">
          {item.time} <SourceIcon item={item} />
        </small>
        <p className={expanded ? '' : 'clamp-4'}>{item.summary}</p>
        {item.summary.length > 80 && !expanded && (
          <button className="text-button" onClick={() => setExpanded(true)}>
            展开
          </button>
        )}
        <div className="timeline-actions">
          {item.withCharacterIds.map((id) => (
            <Link key={id} to={`/characters/${id}`}>
              <CharacterName id={id} />
            </Link>
          ))}
          {item.source === 'public_update' && <span className="tag">公开资料</span>}
          {item.source === 'public_update' && item.ref?.kind === 'url' && (
            <a href={item.ref.id} target="_blank" rel="noreferrer noopener">
              来源
            </a>
          )}
          {onAsk && (
            <button className="text-button" onClick={() => onAsk(`${item.summary}是怎么回事？`)}>
              问问 TA ›
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** 时间线页「TA 的近况」（while-away-timeline.md 第 3 节、l3-companion.md 第 3 节）。 */
export function TimelinePage() {
  const { characterId = '' } = useParams();
  const navigate = useNavigate();
  const { state } = useChat();
  const contact = state.contacts.find((item) => item.characterId === characterId);
  const companion = useRemote(CompanionEndpoints.getForCharacter, { params: { characterId } });
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [legacy, setLegacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const done = cursor === null;
  const load = useCallback(async () => {
    if (busy.current || cursor === null) return;
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const page = await fetchPage(characterId, cursor, legacy);
      setItems((previous) => [...previous, ...page.items]);
      setCursor(page.nextCursor);
      setLegacy(page.legacy);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [characterId, cursor, legacy]);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || done || error) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [done, error, load]);
  const groups: Array<[string, Item[]]> = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last[0] === item.date) last[1].push(item);
    else groups.push([item.date, [item]]);
  }
  const ask = contact?.conversationId
    ? (text: string) => navigate(`/chat/${contact.conversationId}`, { state: { prefill: text } })
    : undefined;
  return (
    <main>
      <Link to={`/characters/${characterId}`}>‹ 返回资料</Link>
      <h1 className="page-title">
        <CharacterName id={characterId} fallback={contact?.remark} /> 的近况
      </h1>
      {companion.data?.dailyLife === false && (
        <p className="inline-tip">
          你关闭了 TA 的日常，不会有新的近况{' '}
          {contact?.conversationId && (
            <Link to={`/chat/${contact.conversationId}/settings`}>去开启</Link>
          )}
        </p>
      )}
      {items.length === 0 && !error && !done && (
        <div className="stack" role="status" aria-label="正在读取">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      )}
      {items.length === 0 && !loading && error && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={() => void load()}>重试</button>
        </div>
      )}
      {items.length === 0 && !loading && !error && done && (
        <p className="empty">TA 的近况会出现在这里</p>
      )}
      {groups.map(([date, list]) => (
        <section key={date}>
          <h2 className="group-label">{dayLabel(date)}</h2>
          <ul className="timeline">
            {list.map((item) => (
              <TimelineItem key={item.id} item={item} onAsk={ask} />
            ))}
          </ul>
        </section>
      ))}
      {items.length > 0 && error && (
        <button className="text-button" onClick={() => void load()}>
          加载失败，点击重试
        </button>
      )}
      {items.length > 0 && done && <p className="hint center">只保留最近 90 天</p>}
      {!done && <div ref={sentinel} className="timeline-sentinel" aria-hidden />}
      {items.length > 0 && loading && <p role="status">正在读取…</p>}
    </main>
  );
}

/** 资料页「TA 的近况」行：右侧显示最近一条事件文字。 */
export function RecentRow({ characterId }: { characterId: string }) {
  const [latest, setLatest] = useState('');
  useEffect(() => {
    let active = true;
    void fetchPage(characterId, undefined, false)
      .then((page) => {
        if (active) setLatest(page.items[0]?.summary ?? '');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [characterId]);
  return (
    <Link className="panel row-link" to={`/characters/${characterId}/timeline`}>
      <span>TA 的近况</span>
      <small className="row-value">{latest}</small>
    </Link>
  );
}
