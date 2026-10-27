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
  onFar,
  jumpToBottom,
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
  /** 离底部超过一屏半（U5「回到最新」按钮用）；值变了才回调。 */
  onFar?(value: boolean): void;
  /** 回到底部并恢复跟随；nonce 变化时执行一次（U5「↓ N 条新消息」）。 */
  jumpToBottom?: number;
  onStart?(): void;
  anchorItem?(item: T): boolean;
  /** 定位到某一行（距顶部 1/3 处，search.md 第 4 节）；nonce 变化时执行一次。 */
  scrollTo?: { key: string; nonce: number } | null;
  rowClassName?(item: T): string | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const estimated = useRef(estimate);
  estimated.current = estimate;
  const previous = useRef({ first: '', height: 0, revision: -1 });
  const stick = useRef(bottom);
  const lastTop = useRef(0);
  /** 上一次由我们自己写进去的 scrollTop：浏览器随后补发的 scroll 事件不能把它当成用户滚动。 */
  const written = useRef<number | null>(null);
  /**
   * 锚点：用户正在看的那一行。除了「顶边到视口顶」的距离，还记这一行自己的 top 和底边距离：
   * 行被插到它上面（prepend）或它自己的内容变高变矮（时间条、图片）时，按底边钉住才不会有内容跳一下。
   */
  const anchor = useRef<{ key: string; top: number; offset: number; bottom: number } | null>(null);
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
  const anchorRow = anchor.current
    ? rows.find((row) => row.key === anchor.current?.key)
    : undefined;
  const anchorTop = anchorRow?.top;
  const anchorHeight = anchorRow?.height;
  const targetRow = scrollTo ? rows.find((row) => row.key === scrollTo.key) : undefined;
  const targetTop = targetRow?.top;
  const targetHeight = targetRow?.height;
  /** 写 scrollTop 并记下这次是我们写的：紧接着补发的 scroll 事件不能靠它换掉锚点行。 */
  const writeScroll = (element: HTMLDivElement, value: number) => {
    element.scrollTop = value;
    written.current = element.scrollTop;
  };
  const handled = useRef(0);
  const far = useRef(false);
  const jumped = useRef(jumpToBottom ?? 0);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !jumpToBottom || jumped.current === jumpToBottom) return;
    jumped.current = jumpToBottom;
    stick.current = true;
    anchor.current = null;
    writeScroll(element, Math.max(0, element.scrollHeight - element.clientHeight));
    lastTop.current = element.scrollTop;
    onBottom?.(true);
    if (far.current) {
      far.current = false;
      onFar?.(false);
    }
    setViewport({ top: element.scrollTop, height: element.clientHeight });
  }, [jumpToBottom, onBottom, onFar]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !scrollTo || targetTop === undefined || handled.current === scrollTo.nonce)
      return;
    handled.current = scrollTo.nonce;
    stick.current = false;
    const offset = -Math.round(element.clientHeight / 3);
    anchor.current = {
      key: scrollTo.key,
      top: targetTop,
      offset,
      bottom: offset - (targetHeight ?? 0),
    };
    writeScroll(element, Math.max(0, targetTop + offset));
    onBottom?.(false);
    setViewport({ top: element.scrollTop, height: element.clientHeight });
  }, [scrollTo, targetTop, targetHeight, onBottom]);
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
    /*
     * 锚点行的 top 变了 = 它上面被插进了更早的行（prepend）或上方行高被修正。
     * 这时改按「锚点行底边」钉住：顶边钉住只能保证那一行自己不动，它自己的高度一变
     * （例如首条消息的聊天时间条在插入更早消息后消失），下面的消息就整体窜一截；
     * 底边钉住在行高不变时与顶边钉住完全等价，行高变了则保证下面用户正在看的内容一动不动。
     * 用户真正滚动后，scroll 事件会重取锚点，回到顶边钉住。
     */
    const aboveChanged = anchorTop !== undefined && anchorTop !== anchor.current?.top;
    /*
     * 用户正在滑（最后一次 scroll 不是我们写的）：锚点是上一个 scroll 事件记的，惯性滑动中
     * 之后又滚过了一段。这时按锚点绝对位置写回会把列表拽回去并打断惯性——总经理 10-28 反馈
     * 「一划只能翻一页、猛地停住」，每次进页面行高都要重量一遍，所以每次切 tab 都会出现。
     * 改为：锚点上方没变就不动；上方变了只补那一段高度差，从当前位置算。
     */
    const userScrolling = written.current === null;
    let desired = element.scrollTop;
    if (bottom && stick.current) desired = Math.max(0, element.scrollHeight - element.clientHeight);
    else if (anchor.current && anchorTop !== undefined) {
      const edge = anchorTop + (anchorHeight ?? 0);
      if (!userScrolling)
        desired = aboveChanged ? edge + anchor.current.bottom : anchorTop + anchor.current.offset;
      else if (aboveChanged) {
        const was = anchor.current.top + anchor.current.offset - anchor.current.bottom;
        desired = element.scrollTop + edge - was;
        anchor.current = {
          key: anchor.current.key,
          top: anchorTop,
          offset: desired - anchorTop,
          bottom: desired - edge,
        };
      }
    }
    // Writing even the same scrollTop cancels Safari momentum; compensate only actual layout shifts.
    if (Math.abs(element.scrollTop - desired) > 1) writeScroll(element, desired);
    onBottom?.(stick.current);
    previous.current = { first, height: total, revision };
    setViewport({ top: element.scrollTop, height: element.clientHeight });
  }, [first, total, bottom, revision, anchorTop, anchorHeight, onBottom]);
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
        if (height <= 0) continue;
        // 排版用的是「量过的高度，没量过就按估算」：与它相同就不必重排（固定行高的会话行首次量到时常如此）。
        const laidOut = heights.current.get(key) ?? estimated.current;
        heights.current.set(key, height);
        if (laidOut !== height) changed = true;
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
  /**
   * 某个滚动位置下会挂哪些行（与上面的 visible 过滤条件逐字一致）。
   * 滚动时只要首尾行没换，就没必要让 React 重渲染整张列表：行都在绝对位置上没动。
   */
  const mountedRange = (top: number, height: number) => {
    let firstKey = '';
    let lastKey = '';
    for (const row of rows) {
      if (row.top + row.height < top - OVERSCAN) continue;
      if (!firstKey) firstKey = row.key;
      if (row.top > top + height + OVERSCAN) break;
      lastKey = row.key;
    }
    return { firstKey, lastKey };
  };
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
        const top = element.scrollTop;
        const height = element.clientHeight;
        /*
         * 底部跟随只在「确实停在底部」时成立：手指往上翻（哪怕只有 40 像素）就立刻停止跟随，
         * 之后新消息、图片撑高都不能把内容拉回底部（以前 96 像素内会一直重钉，上翻被追着拽回去）；
         * 用户自己回到底部附近再恢复跟随。
         */
        if (bottom) {
          if (top < lastTop.current - 1) stick.current = false;
          else if (element.scrollHeight - top - height < 96) stick.current = true;
        }
        lastTop.current = top;
        /*
         * 补偿写进去的位置会补发一次 scroll：这时用户没动，不能靠它把锚点换成「顶边那一行」。
         * 否则 prepend 之后紧接着的测量修正会钉住一条刚插进来、还没量过高度的行，
         * 它周围的估算误差就变成用户眼前消息的位移。
         */
        const fromWrite = written.current !== null && Math.abs(top - written.current) < 1;
        if (!fromWrite) {
          written.current = null;
          const row = rows.find(
            (row) => row.top + row.height > top && (!anchorItem || anchorItem(row.item)),
          );
          if (row)
            anchor.current = {
              key: row.key,
              top: row.top,
              offset: top - row.top,
              bottom: top - (row.top + row.height),
            };
        }
        if (top <= 48) onStart?.();
        if (onFar) {
          const isFar = element.scrollHeight - top - height > height * 1.5;
          if (isFar !== far.current) {
            far.current = isFar;
            onFar(isFar);
          }
        }
        onBottom?.(stick.current);
        /*
         * 挂着的行没换就不写状态：以前每个 scroll 事件都重建 rows（items.map）再重渲染一遍，
         * 几百行时这份主线程开销正好压在手指滚动上。位置/高度或窗口首尾行变了才更新。
         */
        const now = mountedRange(viewport.top, viewport.height);
        const next = mountedRange(top, height);
        if (
          height !== viewport.height ||
          next.firstKey !== now.firstKey ||
          next.lastKey !== now.lastKey
        )
          setViewport({ top, height });
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
