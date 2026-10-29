import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const ROOT_TABS = new Set(['/chat', '/contacts', '/discover', '/me']);
type Point = { left: number; top: number };
const origin = (): Point => ({ left: 0, top: 0 });

/** Window scrolling belongs to the rendered page, never to the next tab. Internal virtual lists own their own position. */
export function useRouteViewportScroll(renderedPath: string): void {
  const location = useLocation();
  const navigation = useNavigationType();
  const positions = useRef(new Map<string, Point>());
  const current = useRef(location.pathname);
  const latest = useRef({ path: location.pathname, renderedPath });
  latest.current = { path: location.pathname, renderedPath };
  useLayoutEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    window.scrollTo({ ...origin(), behavior: 'instant' });
    const remember = () => {
      const { path, renderedPath: shown } = latest.current;
      // Parent CSS/body height can clamp the old offset during navigation. Do not save that clamp as the old page's position.
      if (current.current !== path || shown !== path) return;
      const cache = positions.current;
      cache.delete(path);
      cache.set(path, { left: window.scrollX, top: window.scrollY });
      if (cache.size > 48) {
        const oldest = [...cache.keys()].find((key) => !ROOT_TABS.has(key));
        if (oldest) cache.delete(oldest);
      }
    };
    // Capture before React navigation mutates the old page, including a click during inertial scrolling.
    window.addEventListener('scroll', remember, { passive: true });
    document.addEventListener('click', remember, true);
    window.addEventListener('popstate', remember);
    return () => {
      window.removeEventListener('scroll', remember);
      document.removeEventListener('click', remember, true);
      window.removeEventListener('popstate', remember);
      history.scrollRestoration = previous;
    };
  }, []);
  useLayoutEffect(() => {
    // RouteMotion keeps the outgoing DOM for one commit. Restore only after the destination really mounts.
    if (renderedPath !== location.pathname || current.current === location.pathname) return;
    const path = location.pathname;
    const point =
      path === '/chat'
        ? origin()
        : ROOT_TABS.has(path) || navigation === 'POP'
          ? (positions.current.get(path) ?? origin())
          : origin();
    current.current = path;
    window.scrollTo({ ...point, behavior: 'instant' });
  }, [location.pathname, renderedPath, navigation]);
}
