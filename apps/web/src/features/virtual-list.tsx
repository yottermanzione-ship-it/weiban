import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
/** 可变高度消息和固定高度会话共用；只挂载可视行及邻近行。 */
export function VirtualList<T>({
  items,
  itemKey,
  render,
  estimate = 64,
  label,
  bottom = false,
  onBottom,
}: {
  items: T[];
  itemKey(item: T): string;
  render(item: T): ReactNode;
  estimate?: number;
  label: string;
  bottom?: boolean;
  onBottom?(value: boolean): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const previous = useRef({ first: '', height: 0 });
  const stick = useRef(bottom);
  const anchor = useRef<{ key: string; offset: number } | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [revision, setRevision] = useState(0);
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
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    if (previous.current.first && previous.current.first !== first && anchorTop !== undefined)
      stick.current = false;
    if (bottom && stick.current) element.scrollTop = element.scrollHeight;
    else if (anchorTop !== undefined && anchor.current)
      element.scrollTop = anchorTop + anchor.current.offset;
    onBottom?.(stick.current);
    previous.current = { first, height: total };
    setViewport({ top: element.scrollTop, height: element.clientHeight });
  }, [first, total, bottom, revision, anchorTop, onBottom]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const row = entry.target as HTMLElement;
        const key = row.dataset.rowKey;
        if (!key) {
          setViewport({ top: element.scrollTop, height: element.clientHeight });
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
    observer.observe(element);
    for (const row of element.querySelectorAll('[data-row-key]')) observer.observe(row);
    return () => observer.disconnect();
  }, [viewport.top, viewport.height, items, revision]);
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
        const row = rows.find((row) => row.top + row.height > element.scrollTop);
        if (row) anchor.current = { key: row.key, offset: element.scrollTop - row.top };
        onBottom?.(stick.current);
        setViewport({ top: element.scrollTop, height: element.clientHeight });
      }}
    >
      <div style={{ height: total, position: 'relative' }}>
        {rows
          .filter(
            (row) =>
              row.top + row.height >= viewport.top - 500 &&
              row.top <= viewport.top + viewport.height + 500,
          )
          .map((row) => (
            <div
              key={row.key}
              role="listitem"
              data-row-key={row.key}
              style={{ position: 'absolute', top: row.top, left: 0, right: 0 }}
            >
              {render(row.item)}
            </div>
          ))}
      </div>
    </div>
  );
}
