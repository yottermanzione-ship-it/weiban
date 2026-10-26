/*
 * 聊天记录向上分页（T-20261025）：
 * 普通上滑只滚动，不再自动请求历史；到顶显示「加载更多消息」，用户点了才取上一批。
 * 加载中按钮位置换成转圈 + 文字并拒绝重复点击；失败停在可点击重试；到最早一条显示「没有更多消息」。
 * 这里只做状态与这一行的渲染，插入更早消息后的位置保持由 VirtualList 的锚点负责。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type HistoryPagerState = 'idle' | 'loading' | 'failed' | 'done';

/**
 * @param load 取上一批；返回是否还有更早的记录。只需在点击时调用。
 */
export function useHistoryPager(load: () => Promise<boolean>) {
  const [state, setState] = useState<HistoryPagerState>('idle');
  const busy = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    // StrictMode 开发时会把 effect 清理后重跑一次，重新挂载要恢复标记。
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const loadMore = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setState('loading');
    void latest
      .current()
      .then((more) => {
        if (mounted.current) setState(more ? 'idle' : 'done');
      })
      .catch(() => {
        if (mounted.current) setState('failed');
      })
      .finally(() => {
        busy.current = false;
      });
  }, []);
  return { state, loadMore };
}

export function HistoryLoadRow({ state, onLoad }: { state: HistoryPagerState; onLoad(): void }) {
  if (state === 'loading')
    return (
      <div className="wx-older">
        <span className="wx-older-status" role="status">
          <span className="wx-older-spinner" aria-hidden />
          正在加载…
        </span>
      </div>
    );
  if (state === 'done')
    return (
      <div className="wx-older">
        <span className="wx-older-status">没有更多消息</span>
      </div>
    );
  return (
    <div className="wx-older">
      <button type="button" className="text-button wx-older-button" onClick={onLoad}>
        {state === 'failed' ? '加载失败，点击重试' : '加载更多消息'}
      </button>
    </div>
  );
}
