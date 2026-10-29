import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { useRouteViewportScroll } from './route-scroll.js';

/** Capture only on a pathname change; the outgoing page is inert DOM, never a second React tree. */
export function RouteMotion({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigation = useNavigationType();
  const content = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const outgoing = useRef<HTMLElement | null>(null);
  const timer = useRef(0);
  const [rendered, setRendered] = useState({ path: location.pathname, children });
  useRouteViewportScroll(rendered.path);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      outgoing.current?.remove();
    },
    [],
  );
  useLayoutEffect(() => {
    const node = content.current;
    const host = frame.current;
    if (!node || !host) return;
    if (rendered.path === location.pathname) {
      if (rendered.children !== children) setRendered({ path: location.pathname, children });
      return;
    }
    window.clearTimeout(timer.current);
    outgoing.current?.remove();
    node.classList.remove('route-enter-left', 'route-enter-right');
    const roots = ['/chat', '/contacts', '/discover', '/me'];
    if (
      !(roots.includes(rendered.path) && roots.includes(location.pathname)) &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      // The old route stays rendered until this layout effect; clone once before replacing it.
      const picture = node.cloneNode(true) as HTMLElement;
      const oldElements = node.querySelectorAll('*');
      const returning = navigation === 'POP';
      picture.inert = true;
      picture.setAttribute('aria-hidden', 'true');
      picture.className = `route-picture ${returning ? 'route-exit-right' : 'route-exit-left'}`;
      host.append(picture);
      picture.querySelectorAll('*').forEach((element, index) => {
        const scrollTop = oldElements[index]?.scrollTop ?? 0;
        if (scrollTop) element.scrollTop = scrollTop;
      });
      outgoing.current = picture;
      node.classList.add(returning ? 'route-enter-left' : 'route-enter-right');
      timer.current = window.setTimeout(() => {
        picture.remove();
        outgoing.current = null;
        node.classList.remove('route-enter-left', 'route-enter-right');
      }, 240);
    }
    setRendered({ path: location.pathname, children });
  }, [location.pathname, navigation, children, rendered]);
  return (
    <div className="route-frame" ref={frame}>
      <div className="route-content" ref={content}>
        {rendered.path === location.pathname ? children : rendered.children}
      </div>
    </div>
  );
}
