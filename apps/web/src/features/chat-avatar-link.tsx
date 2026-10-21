import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLongPress } from './shell-kit.js';

/** 两次点击间隔不超过这么久算双击（拍一拍）。 */
const DOUBLE_TAP_MS = 320;

/**
 * 聊天里对方头像：单击进资料（延迟一下等第二次点击）、双击拍一拍、长按弹菜单（3.27 H1）。
 * 只延迟普通指针点击；Enter 与带修饰键的点击保持链接原本行为。
 */
export function ChatAvatarLink({
  to,
  onNudge,
  onMenu,
  children,
}: {
  to: string;
  onNudge(): void;
  /** 3.27（H1）：长按头像弹出菜单（拍一拍 / 查看资料 / @TA）。 */
  onMenu?(): void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const timer = useRef(0);
  const last = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const press = useLongPress(() => {
    window.clearTimeout(timer.current);
    last.current = 0;
    onMenu?.();
  });
  return (
    <Link
      className="wx-avatar-link"
      to={to}
      aria-label="查看资料（双击拍一拍）"
      {...(onMenu ? press : {})}
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
        if (last.current && now - last.current < DOUBLE_TAP_MS) {
          last.current = 0;
          onNudge();
        } else {
          last.current = now;
          timer.current = window.setTimeout(() => {
            last.current = 0;
            navigate(to);
          }, DOUBLE_TAP_MS);
        }
      }}
    >
      {children}
    </Link>
  );
}

/** 3.27（H1）：自己的头像双击 = 拍了拍自己（微信同款）；单击没有动作。 */
export function SelfNudgeAvatar({ onNudge, children }: { onNudge(): void; children: ReactNode }) {
  const last = useRef(0);
  return (
    <span
      className="wx-avatar-link"
      role="button"
      tabIndex={-1}
      aria-label="双击拍拍自己"
      onDoubleClick={(event) => event.preventDefault()}
      onClick={() => {
        const now = Date.now();
        if (last.current && now - last.current < DOUBLE_TAP_MS) {
          last.current = 0;
          onNudge();
        } else last.current = now;
      }}
    >
      {children}
    </span>
  );
}
