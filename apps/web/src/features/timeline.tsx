import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CompanionEndpoints, DailyEventEndpoints, type DailyEvent } from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { CharacterName } from './chat.js';

function dayLabel(date: string): string {
  const today = new Date();
  const format = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (date === format(today)) return '今天';
  const yesterday = new Date(today.getTime() - 86400000);
  if (date === format(yesterday)) return '昨天';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const value = new Date(y, m - 1, d);
  const week = ['日', '一', '二', '三', '四', '五', '六'][value.getDay()];
  return `${m} 月 ${d} 日 星期${week}`;
}

function TimelineItem({ event, onAsk }: { event: DailyEvent; onAsk?(text: string): void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="timeline-item">
      <span className="timeline-dot" aria-hidden />
      <div className="timeline-content">
        <small className="timeline-time">{event.eventTime ?? ''}</small>
        <p className={expanded ? '' : 'clamp-4'}>{event.summary}</p>
        {event.summary.length > 80 && !expanded && (
          <button className="text-button" onClick={() => setExpanded(true)}>
            展开
          </button>
        )}
        <div className="timeline-actions">
          {event.withCharacterId && (
            <Link to={`/characters/${event.withCharacterId}`}>
              和 <CharacterName id={event.withCharacterId} />
            </Link>
          )}
          {event.source === 'public_feed' && <span className="tag">公开资料</span>}
          {onAsk && (
            <button className="text-button" onClick={() => onAsk(`${event.summary}是怎么回事？`)}>
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
  const [items, setItems] = useState<DailyEvent[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sentinel = useRef<HTMLDivElement>(null);
  const done = cursor === null;
  const load = useCallback(async () => {
    if (loading || cursor === null) return;
    setLoading(true);
    setError('');
    try {
      const page = await api.call(DailyEventEndpoints.listByCharacter, {
        params: { characterId },
        query: { limit: 30, cursor: cursor ?? undefined },
      });
      setItems((previous) => [...previous, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [characterId, cursor, loading]);
  useEffect(() => {
    if (cursor === undefined && items.length === 0 && !error) void load();
  }, [cursor, items.length, error, load]);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || done || error) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [done, error, load]);
  const groups: Array<[string, DailyEvent[]]> = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last[0] === item.eventDate) last[1].push(item);
    else groups.push([item.eventDate, [item]]);
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
      {items.length === 0 && loading && (
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
      {groups.map(([date, events]) => (
        <section key={date} className="timeline-group">
          <h2 className="group-label">{dayLabel(date)}</h2>
          <ul className="timeline">
            {events.map((event) => (
              <TimelineItem key={event.eventId} event={event} onAsk={ask} />
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
  const latest = useRemote(DailyEventEndpoints.listByCharacter, {
    params: { characterId },
    query: { limit: 1 },
  });
  return (
    <Link className="panel row-link" to={`/characters/${characterId}/timeline`}>
      <span>TA 的近况</span>
      <small className="row-value">{latest.data?.items[0]?.summary ?? ''}</small>
    </Link>
  );
}
