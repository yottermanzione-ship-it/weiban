import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
/**
 * 可视区上下各多挂这么多像素：快速滑动时刚滚过的行不会被立刻销毁，
 * 再滑回来时行还在、头像和图片元素还在，不用重新下载（媒体响应是 no-store，一重下就闪）。
 */
const OVERSCAN = 1200;
/** 可变高度消息和固定高度会话共用；只挂载可视行及邻近行。 */
export function VirtualList<T>({
  items,
  itemKey,
  render,
  estimate = 64,
  label,
  bottom = false,
  onBottom,
  onStart,
  anchorItem,
  scrollTo,
  rowClassName,
}: {
  items: T[];
  itemKey(item: T): string;
  render(item: T): ReactNode;
  estimate?: number;
  label: string;
  bottom?: boolean;
  onBottom?(value: boolean): void;
  onStart?(): void;
  anchorItem?(item: T): boolean;
  /** 定位到某一行（距顶部 1/3 处，search.md 第 4 节）；nonce 变化时执行一次。 */
  scrollTo?: { key: string; nonce: number } | null;
  rowClassName?(item: T): string | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const previous = useRef({ first: '', height: 0, revision: -1 });
  const stick = useRef(bottom);
  const anchor = useRef<{ key: string; offset: number } | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [revision, setRevision] = useState(0);
  /**
   * 行元素缓存：滚动只让 VirtualList 自己重渲染，父组件传来的 render 闭包不变，
   * 这时把上次渲染出的元素原样交回去 —— 引用相同，React 直接跳过整棵子树，
   * 滚动时行里的头像 / 图片不会再重渲染。父组件自己重渲染或 items 换了就整块清掉重算，
   * 免得闭包里的回调过期。
   */
  const rendered = useRef(
    new Map<string, { item: T; className: string | undefined; node: ReactNode }>(),
  );
  const renderer = useRef(render);
  const source = useRef(items);
  if (renderer.current !== render || source.current !== items) {
    renderer.current = render;
    source.current = items;
    rendered.current.clear();
  }
  let total = 0;
  const rows = items.map((item) => {
    const key = itemKey(item);
    const top = total;
    const height = heights.current.get(key) ?? estimate;
    total += height;
    return { item, key, top, height };
  });
  const first = rows[0]?.key ?? '';
  const anchorTop = rows.find((row) => row.key === anchor.current?.key)?.top;
  const targetTop = scrollTo ? rows.find((row) => row.key === scrollTo.key)?.top : undefined;
  const handled = useRef(0);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !scrollTo || targetTop === undefined || handled.current === scrollTo.nonce)
      return;
    handled.current = scrollTo.nonce;
    stick.current = false;
    const offset = -Math.round(element.clientHeight / 3);
    anchor.current = { key: scrollTo.key, offset };
    element.scrollTop = Math.max(0, targetTop + offset);
    onBottom?.(false);
    setViewport({ top: element.scrollTop, height: element.clientHeight });
  }, [scrollTo, targetTop, onBottom]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    if (
      previous.current.first === first &&
      previous.current.height === total &&
      previous.current.revision === revision
    )
      return;
    if (previous.current.first && previous.current.first !== first && anchorTop !== undefined)
      stick.current = false;
    const desired =
      bottom && stick.current
        ? Math.max(0, element.scrollHeight - element.clientHeight)
        : anchorTop !== undefined && anchor.current
          ? anchorTop + anchor.current.offset
          : element.scrollTop;
    // Writing even the same scrollTop cancels Safari momentum; compensate only actual layout shifts.
    if (Math.abs(element.scrollTop - desired) > 1) element.scrollTop = desired;
    onBottom?.(stick.current);
    previous.current = { first, height: total, revision };
    setViewport({ top: element.scrollTop, height: element.clientHeight });
  }, [first, total, bottom, revision, anchorTop, onBottom]);
  useLayoutEffect(() => {
    const element = root.current;
    const track = element?.firstElementChild;
    if (!element || !track) return;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const row = entry.target as HTMLElement;
        const key = row.dataset.rowKey;
        if (!key) {
          // 列表本身高度变了（键盘弹出、旋转屏幕）：只更新视口，不重测行。
          const height = element.clientHeight;
          setViewport((value) =>
            value.height === height ? value : { top: element.scrollTop, height },
          );
          continue;
        }
        const height = Math.ceil(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
        if (height > 0 && heights.current.get(key) !== height) {
          heights.current.set(key, height);
          changed = true;
        }
      }
      if (changed) setRevision((value) => value + 1);
    });
    for (const row of track.querySelectorAll('[data-row-key]')) observer.observe(row);
    observer.observe(element);
    // 行随滚动挂载 / 卸载：新行接上观察，卸载的行断开，不必每次滚动重建观察器。
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        // 先断开再观察：React 在中间插行时会把节点挪一次，别让移走的行丢掉观察。
        for (const node of record.removedNodes)
          if (node instanceof Element) observer.unobserve(node);
        for (const node of record.addedNodes)
          if (node instanceof Element && node.matches('[data-row-key]')) observer.observe(node);
      }
    });
    mutations.observe(track, { childList: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, []);
  const visible = rows.filter(
    (row) =>
      row.top + row.height >= viewport.top - OVERSCAN &&
      row.top <= viewport.top + viewport.height + OVERSCAN,
  );
  // 缓存只保留当前窗口里的行：有界，不会随滚动一直涨。
  if (rendered.current.size > visible.length) {
    const keep = new Set(visible.map((row) => row.key));
    for (const key of rendered.current.keys()) if (!keep.has(key)) rendered.current.delete(key);
  }
  const mounted = visible.map((row) => {
    const className = rowClassName?.(row.item);
    const cached = rendered.current.get(row.key);
    if (cached && cached.item === row.item && cached.className === className)
      return { row, cached };
    const entry = { item: row.item, className, node: render(row.item) };
    rendered.current.set(row.key, entry);
    return { row, cached: entry };
  });
  return (
    <div
      ref={root}
      className="virtual-list"
      role="list"
      aria-label={label}
      onScroll={(event) => {
        const element = event.currentTarget;
        stick.current =
          bottom && element.scrollHeight - element.scrollTop - element.clientHeight < 96;
        const row = rows.find(
          (row) =>
            row.top + row.height > element.scrollTop && (!anchorItem || anchorItem(row.item)),
        );
        if (row) anchor.current = { key: row.key, offset: element.scrollTop - row.top };
        if (element.scrollTop <= 48) onStart?.();
        onBottom?.(stick.current);
        setViewport({ top: element.scrollTop, height: element.clientHeight });
      }}
    >
      <div style={{ height: total, position: 'relative' }}>
        {mounted.map(({ row, cached }) => (
          <div
            key={row.key}
            role="listitem"
            data-row-key={row.key}
            className={cached.className}
            style={{ position: 'absolute', top: row.top, left: 0, right: 0 }}
          >
            {cached.node}
          </div>
        ))}
      </div>
    </div>
  );
}
