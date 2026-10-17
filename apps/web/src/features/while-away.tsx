import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase,
  CaretRight,
  CaretUp,
  ChatCircle,
  Coffee,
  Moon,
  ShoppingBag,
  Sparkle,
  Sun,
  type IconProps,
} from './old-icons.js';
import { TimelineEndpoints, type TimelineSummaryResponse } from '@weiban/contracts';
import { api } from '../data/client.js';

/** 时间线事件类型 → 图标（l3-companion.md 2.2）；未知类型用太阳兜底。 */
const kindIcons: Record<string, ComponentType<IconProps>> = {
  work: Briefcase,
  social: ChatCircle,
  leisure: Coffee,
  errand: ShoppingBag,
  rest: Moon,
  unexpected: Sparkle,
};
export function KindIcon({ kind }: { kind: string }) {
  const Icon = kindIcons[kind] ?? Sun;
  return <Icon size={16} aria-hidden />;
}

const lastActiveKey = (id: string) => `weiban:last-active:${id}`;
const shownKey = (id: string) => `weiban:while-away-shown:${id}`;
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 浏览器不允许本地存储时，摘要卡只是可能重复出现，不影响聊天。
  }
}

/**
 * 记录用户离开该私聊的时刻（lastActiveAt），并在进入时读取上一次的值。
 * 服务器以 lastActiveAt 计算离线时长并决定是否返回摘要（P-18），客户端不自己判断门槛。
 */
export function useWhileAway(conversationId: string, characterId: string | undefined) {
  const [data, setData] = useState<TimelineSummaryResponse | null>(null);
  const [lastActiveAt] = useState(() => read(lastActiveKey(conversationId)));
  const [autoOpen] = useState(
    () => !!lastActiveAt && read(shownKey(conversationId)) !== lastActiveAt,
  );
  useEffect(() => {
    const leave = () => write(lastActiveKey(conversationId), new Date().toISOString());
    const visibility = () => {
      if (document.visibilityState === 'hidden') leave();
    };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      leave();
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [conversationId]);
  useEffect(() => {
    // 每次进入私聊都调用一次（服务器据此记录「上次进入」，T-066 交接）；本机没有记录时传当前时刻。
    if (!characterId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2000);
    void api
      .call(TimelineEndpoints.getSummary, {
        params: { conversationId },
        query: { characterId, lastActiveAt: lastActiveAt ?? new Date().toISOString() },
        signal: controller.signal,
        networkOnly: true,
      })
      .then((result) => {
        if (result.summary) setData(result);
      })
      .catch(() => {
        // 失败或超时：不显示卡片，不重试，不提示（l3-companion.md 2.1）。
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [conversationId, characterId, lastActiveAt]);
  const markShown = useCallback(() => {
    if (lastActiveAt) write(shownKey(conversationId), lastActiveAt);
  }, [conversationId, lastActiveAt]);
  return { data, autoOpen, markShown };
}

function title(offlineSeconds: number): string {
  const end = new Date();
  const start = new Date(end.getTime() - offlineSeconds * 1000);
  const days = Math.round(
    (new Date(end.toDateString()).getTime() - new Date(start.toDateString()).getTime()) / 86400000,
  );
  return days >= 1 ? `你不在的这 ${days} 天，TA……` : '你不在的这段时间，TA……';
}

/** 「你不在时」摘要卡：悬浮在消息列表顶部，不插入消息流（while-away-timeline.md 第 2 节）。 */
export function WhileAwayCard({
  data,
  open,
  characterId,
  onOpenChange,
  onAsk,
}: {
  data: TimelineSummaryResponse;
  open: boolean;
  characterId: string;
  onOpenChange(open: boolean): void;
  onAsk(text: string): void;
}) {
  return (
    <div className="while-away-anchor">
      {open ? (
        <section className="while-away-card" aria-label="你不在时">
          <header>
            <strong>{title(data.offlineSeconds)}</strong>
            <button className="icon-button" aria-label="收起" onClick={() => onOpenChange(false)}>
              <CaretUp size={20} />
            </button>
          </header>
          {data.summary && <p className="while-away-summary">{data.summary}</p>}
          {data.events.length > 0 && (
            <ul className="while-away-events">
              {[...data.events].reverse().map((event) => (
                <li key={event.id}>
                  <Link to={`/characters/${characterId}/timeline`}>
                    <KindIcon kind={event.kind} />
                    <span>{event.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <button
            className="text-button while-away-ask"
            onClick={() => {
              const first = [...data.events].reverse()[0]?.summary ?? data.summary ?? '';
              onOpenChange(false);
              onAsk(`${first}是怎么回事？`);
            }}
          >
            问问 TA <CaretRight size={14} aria-hidden />
          </button>
        </section>
      ) : (
        <button className="while-away-pill" onClick={() => onOpenChange(true)}>
          <Sun size={16} aria-hidden /> TA 的动态
        </button>
      )}
    </div>
  );
}
