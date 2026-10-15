import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

/** Delay only an ordinary pointer click; Enter and modified links keep their normal behavior. */
export function ChatAvatarLink({
  to,
  onNudge,
  children,
}: {
  to: string;
  onNudge(): void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const timer = useRef(0);
  const last = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Link
      className="wx-avatar-link"
      to={to}
      aria-label="查看资料"
      onDoubleClick={(event) => event.preventDefault()}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.detail === 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        )
          return;
        event.preventDefault();
        const now = Date.now();
        window.clearTimeout(timer.current);
        if (last.current && now - last.current < 320) {
          last.current = 0;
          onNudge();
        } else {
          last.current = now;
          timer.current = window.setTimeout(() => {
            last.current = 0;
            navigate(to);
          }, 320);
        }
      }}
    >
      {children}
    </Link>
  );
}
