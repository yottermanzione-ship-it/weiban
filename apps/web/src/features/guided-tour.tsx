import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './guided-tour.css';

export interface GuidedTourStep {
  id: string;
  target: string;
  title: string;
  description: string;
  kind: 'action' | 'read';
  nextLabel?: string;
}
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}
const focusables = 'button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]';

/** Highlights the actual control, not a copied button. No business action or account data is owned here. */
export function GuidedTour({
  step,
  chapter,
  index,
  total,
  onNext,
  onBack,
  onPause,
  onTargetAction,
  backLabel,
}: {
  step: GuidedTourStep;
  chapter: string;
  index: number;
  total: number;
  onNext(): void;
  onBack(): void;
  onPause(): void;
  onTargetAction?(stepId: string): void;
  backLabel?: string;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [cardHeight, setCardHeight] = useState(230);
  const actions = useRef({ onPause, onTargetAction });
  actions.current = { onPause, onTargetAction };
  useLayoutEffect(() => {
    let frame = 0;
    let actionTimer = 0;
    let observed: Element | null = null;
    let focused: Element | null = null;
    const previousFocus = document.activeElement;
    const resize = new ResizeObserver(() => schedule());
    function measure() {
      const target = document.querySelector<HTMLElement>(step.target);
      if (!target || !target.getClientRects().length) {
        setBounds(null);
        return;
      }
      if (observed !== target) {
        if (observed) resize.unobserve(observed);
        observed = target;
        resize.observe(target);
        target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
      const rect = target.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const x = Math.max(6, rect.left - 6);
      const y = Math.max(6, rect.top - 6);
      const next: Bounds = {
        x,
        y,
        width: Math.max(0, Math.min(rect.right + 6, viewportWidth - 6) - x),
        height: Math.max(0, Math.min(rect.bottom + 6, viewportHeight - 6) - y),
        viewportWidth,
        viewportHeight,
      };
      setBounds((old) =>
        old &&
        Object.keys(next).every((key) => old[key as keyof Bounds] === next[key as keyof Bounds])
          ? old
          : next,
      );
      if (card.current) setCardHeight(card.current.getBoundingClientRect().height);
      if (focused !== target) {
        focused = target;
        const first =
          step.kind === 'action'
            ? target.matches(focusables)
              ? target
              : target.querySelector<HTMLElement>(focusables)
            : card.current?.querySelector<HTMLElement>('[data-tour-next]');
        first?.focus({ preventScroll: true });
      }
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    function allowed(node: EventTarget | null) {
      if (!(node instanceof Node)) return false;
      if (card.current?.contains(node)) return true;
      return step.kind === 'action' && !!document.querySelector(step.target)?.contains(node);
    }
    function guard(event: Event) {
      if (!allowed(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else if (
        event.type === 'click' &&
        step.kind === 'action' &&
        event.target instanceof Node &&
        document.querySelector(step.target)?.contains(event.target)
      ) {
        // Arm only after an actual click. The owner waits for real navigation/panel state.
        window.clearTimeout(actionTimer);
        actionTimer = window.setTimeout(() => actions.current.onTargetAction?.(step.id), 0);
      }
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        actions.current.onPause();
        return;
      }
      if (event.key !== 'Tab') return;
      const target = document.querySelector<HTMLElement>(step.target);
      const candidates: HTMLElement[] = [];
      if (target && step.kind === 'action') {
        if (target.matches(focusables)) candidates.push(target);
        candidates.push(...target.querySelectorAll<HTMLElement>(focusables));
      }
      if (card.current) candidates.push(...card.current.querySelectorAll<HTMLElement>(focusables));
      const visible = candidates.filter(
        (item) => item.getClientRects().length && !item.hasAttribute('disabled'),
      );
      if (!visible.length) return;
      event.preventDefault();
      const current = visible.indexOf(document.activeElement as HTMLElement);
      visible[(current + (event.shiftKey ? -1 : 1) + visible.length) % visible.length]?.focus({
        preventScroll: true,
      });
    }
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });
    if (card.current) resize.observe(card.current);
    document.addEventListener('click', guard, true);
    document.addEventListener('pointerdown', guard, true);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(actionTimer);
      resize.disconnect();
      mutations.disconnect();
      document.removeEventListener('click', guard, true);
      document.removeEventListener('pointerdown', guard, true);
      document.removeEventListener('keydown', keydown, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [step.id, step.target, step.kind]);
  const vw = bounds?.viewportWidth ?? window.innerWidth;
  const vh = bounds?.viewportHeight ?? window.innerHeight;
  const width = Math.min(340, vw - 28);
  const left = Math.min(
    vw - width - 14,
    Math.max(14, bounds ? bounds.x + bounds.width / 2 - width / 2 : (vw - width) / 2),
  );
  const below = bounds ? bounds.y + bounds.height + 16 : 60;
  const above = bounds ? bounds.y - cardHeight - 16 : 60;
  const top = Math.max(
    14,
    Math.min(
      vh - cardHeight - 14,
      below + cardHeight <= vh - 14 ? below : above >= 14 ? above : vh - cardHeight - 14,
    ),
  );
  const x = bounds?.x ?? 0,
    y = bounds?.y ?? 0,
    w = bounds?.width ?? 0,
    h = bounds?.height ?? 0;
  return createPortal(
    <div className="guided-tour-layer" data-tour-step={step.id}>
      <div className="guided-tour-shade" style={{ left: 0, top: 0, width: vw, height: y }} />
      <div className="guided-tour-shade" style={{ left: 0, top: y, width: x, height: h }} />
      <div
        className="guided-tour-shade"
        style={{ left: x + w, top: y, width: Math.max(0, vw - x - w), height: h }}
      />
      <div
        className="guided-tour-shade"
        style={{ left: 0, top: y + h, width: vw, height: Math.max(0, vh - y - h) }}
      />
      {bounds && (
        <div
          className="guided-tour-ring"
          aria-hidden
          style={{ left: x, top: y, width: w, height: h }}
        />
      )}
      <div
        ref={card}
        className="guided-tour-card"
        role="dialog"
        aria-labelledby="guided-tour-title"
        aria-describedby="guided-tour-description"
        style={{ left, top, width }}
      >
        <div className="guided-tour-eyebrow">
          <span>{chapter}</span>
          <span>
            {index + 1} / {total}
          </span>
        </div>
        <h2 id="guided-tour-title">{step.title}</h2>
        <p id="guided-tour-description">{step.description}</p>
        <div className="guided-tour-dots" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <i key={i} className={i <= index ? 'active' : ''} />
          ))}
        </div>
        <p className="guided-tour-instruction" role="status">
          {!bounds
            ? '正在寻找当前控件，你也可以先退出。'
            : step.kind === 'action'
              ? '请点击亮起的真实控件继续'
              : '这一步只作说明，不会替你改变设置'}
        </p>
        <div className="guided-tour-actions">
          <button type="button" onClick={onBack} disabled={!backLabel && index === 0}>
            {backLabel ?? '上一步'}
          </button>
          <button type="button" onClick={onPause} aria-label="稍后再学，退出引导">
            稍后再学
          </button>
          {step.kind === 'read' && (
            <button
              type="button"
              className="guided-tour-next"
              data-tour-next
              disabled={!bounds}
              onClick={onNext}
            >
              {step.nextLabel ?? '知道了，继续'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
