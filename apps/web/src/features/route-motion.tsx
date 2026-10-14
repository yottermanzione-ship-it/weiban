import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/** Keep a DOM-only outgoing picture, avoiding duplicate page requests/subscriptions. */
export function RouteMotion({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigation = useNavigationType();
  const content = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const previous = useRef<{ path: string; picture: HTMLElement; scrolls: number[] } | null>(null);
  useLayoutEffect(() => {
    const node = content.current;
    const host = frame.current;
    if (!node || !host) return;
    const old = previous.current;
    const path = location.pathname;
    const roots = ['/chat', '/contacts', '/discover', '/me'];
    let timer = 0;
    if (
      old &&
      old.path !== path &&
      !(roots.includes(old.path) && roots.includes(path)) &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      const returning = navigation === 'POP';
      old.picture.inert = true;
      old.picture.setAttribute('aria-hidden', 'true');
      old.picture.className = `route-picture ${returning ? 'route-exit-right' : 'route-exit-left'}`;
      host.append(old.picture);
      old.picture.querySelectorAll('*').forEach((element, index) => {
        if (old.scrolls[index]) element.scrollTop = old.scrolls[index]!;
      });
      node.classList.add(returning ? 'route-enter-left' : 'route-enter-right');
      timer = window.setTimeout(() => {
        old.picture.remove();
        node.classList.remove('route-enter-left', 'route-enter-right');
      }, 240);
    }
    const capture = () => {
      previous.current = {
        path,
        picture: node.cloneNode(true) as HTMLElement,
        scrolls: Array.from(node.querySelectorAll('*'), (element) => element.scrollTop),
      };
    };
    capture();
    const observer = new MutationObserver(capture);
    observer.observe(node, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      old?.picture.remove();
      node.classList.remove('route-enter-left', 'route-enter-right');
    };
  }, [location.pathname, navigation]);
  return (
    <div className="route-frame" ref={frame}>
      <div className="route-content" ref={content}>
        {children}
      </div>
    </div>
  );
}
