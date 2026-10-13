/*
 * 旧版界面通用组件（docs/refactor/06-old-ui-spec.md 第 3 节）：顶栏、菜单行、分组、分组标题、开关行、
 * 底部弹层、操作列表、浅色长按菜单、⊕ 深色菜单、勾选圈、空状态、文字切换、「暂未开放」。
 * 只用设计令牌（app/old-ui.css），动画只用 transform / opacity。
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { OldIcon, OldImage, type IconProps } from './old-icons.js';
import { showToast } from './toast.js';

export type Tint =
  | 'pink'
  | 'red'
  | 'gold'
  | 'orange'
  | 'teal'
  | 'green'
  | 'lilac'
  | 'purple'
  | 'blue'
  | 'cyan'
  | 'indigo'
  | 'coral'
  | 'gray'
  | 'brand';

export type IconSource = ComponentType<IconProps> | string;

function Glyph({ icon, size }: { icon: IconSource; size: number }) {
  if (typeof icon === 'string')
    return /\.(png|webp)$/.test(icon) ? (
      <OldImage name={icon} size={size} />
    ) : (
      <OldIcon name={icon} size={size} />
    );
  const Icon = icon;
  return <Icon size={size} />;
}

/**
 * 彩色方块 + 白色图标（旧版「彩底白图」）。
 * sm = 24（菜单行，圆角 6）；md = 40（通讯录固定行，圆角 4）；lg = 48（小程序图标，圆角 12）。
 */
export function IconTile({
  icon,
  tint,
  size = 'sm',
}: {
  icon: IconSource;
  tint: Tint;
  size?: 'sm' | 'md' | 'lg' | 'row';
}) {
  const glyph = { sm: 17, md: 22, lg: 26, row: 26 }[size];
  return (
    <span className={`icon-tile tint-${tint} ${size}`} aria-hidden>
      <Glyph icon={icon} size={glyph} />
    </span>
  );
}

/** 返回：有历史退一步，否则去 fallback（直接打开链接时）。 */
export function useBack(fallback = '/chat') {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}

/** 返回箭头（back.svg 裁掉留白后的可见部分 9.4×17.7，规格 3.1）。 */
export function BackArrow() {
  return <OldIcon name="wechat/back_crop" width={9.4} height={17.7} className="back-arrow" />;
}

/** 顶栏（规格 3.1）：高 56，标题 17 / 500 居中，左返回、右图标按钮。 */
export function NavBar({
  title,
  subtitle,
  right,
  left,
  back = true,
  fallback,
  onBack,
  transparent = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  left?: ReactNode;
  back?: boolean;
  fallback?: string;
  onBack?: () => void;
  transparent?: boolean;
}) {
  const goBack = useBack(fallback);
  return (
    <header className={`nav-bar ${transparent ? 'transparent' : ''}`}>
      <span className="nav-bar-side">
        {left ??
          (back && (
            <button
              type="button"
              className="nav-bar-back"
              aria-label="返回"
              onClick={onBack ?? goBack}
            >
              <BackArrow />
            </button>
          ))}
      </span>
      <span className="nav-bar-title">
        {title != null && <h1>{title}</h1>}
        {subtitle}
      </span>
      <span className="nav-bar-side end">{right}</span>
    </header>
  );
}

/** 顶栏右侧图标按钮（26，最小 40×48）。 */
export function NavIcon({
  name,
  label,
  to,
  onClick,
  size = 26,
}: {
  name: string;
  label: string;
  to?: string;
  onClick?: () => void;
  size?: number;
}) {
  return to ? (
    <Link className="nav-bar-icon" to={to} aria-label={label}>
      <OldIcon name={name} size={size} />
    </Link>
  ) : (
    <button type="button" className="nav-bar-icon" aria-label={label} onClick={onClick}>
      <OldIcon name={name} size={size} />
    </button>
  );
}

/** 行尾箭头 chevron_right.svg 18。 */
export function Chevron() {
  return <OldIcon name="wechat/chevron_right" size={18} className="menu-caret" />;
}

/**
 * 菜单行（规格 3.3）。图标两种：
 * - 默认：透明底彩色线图（icon 按 tint 着色，或 image 原色）；
 * - tile：彩色方块 + 白图标。
 */
export function MenuRow({
  to,
  onClick,
  icon,
  tint = 'brand',
  iconColor,
  image,
  iconSize = 22,
  tile = false,
  label,
  subtitle,
  value,
  dot,
  badge,
  extra,
  right,
  danger = false,
  chevron = true,
  center = false,
  disabled = false,
}: {
  to?: string;
  onClick?: () => void;
  icon?: IconSource;
  tint?: Tint;
  iconColor?: string;
  image?: string;
  iconSize?: number;
  tile?: boolean;
  label: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  dot?: boolean;
  badge?: ReactNode;
  extra?: ReactNode;
  right?: ReactNode;
  danger?: boolean;
  chevron?: boolean;
  center?: boolean;
  disabled?: boolean;
}) {
  const body = (
    <>
      {image ? (
        <span className="menu-icon">
          <OldImage name={image} size={iconSize} />
        </span>
      ) : icon ? (
        tile ? (
          <IconTile icon={icon} tint={tint} />
        ) : (
          <span
            className={`menu-icon ink-${tint}`}
            style={iconColor ? { color: iconColor } : undefined}
          >
            <Glyph icon={icon} size={iconSize} />
          </span>
        )
      ) : null}
      <span className={`menu-text ${center ? 'center' : ''}`}>
        <span className="menu-label">
          {label}
          {badge}
          {dot && <span className="red-dot" aria-label="有新内容" />}
        </span>
        {subtitle != null && <small className="menu-subtitle">{subtitle}</small>}
      </span>
      {extra}
      {value != null && <span className="menu-value">{value}</span>}
      {right}
      {chevron && !center && <Chevron />}
    </>
  );
  const className = `menu-row ${subtitle != null ? 'two-line' : ''} ${danger ? 'danger' : ''}`;
  return to && !disabled ? (
    <Link className={className} to={to}>
      {body}
    </Link>
  ) : (
    <button type="button" className={className} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  );
}

/** 分组（规格 3.4）：通栏白卡，组间 8 灰缝。 */
export function MenuGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`menu-group ${className ?? ''}`}>{children}</div>;
}

/** 分组标题（规格 3.5）：高 35.7，文字贴底。 */
export function GroupHeader({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <h2 className="group-header">
      <span>{children}</span>
      {right && <small>{right}</small>}
    </h2>
  );
}

/** iOS 式胶囊开关（规格 3.6），51×31。 */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="ios-switch"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onChange(!checked);
      }}
    >
      <i />
    </button>
  );
}

/** 开关行（规格 3.6）。 */
export function SwitchRow({
  label,
  subtitle,
  checked,
  disabled,
  onChange,
}: {
  label: ReactNode;
  subtitle?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <div className={`switch-row ${subtitle ? 'with-subtitle' : ''}`}>
      <span className="switch-text">
        <span>{label}</span>
        {subtitle && <small>{subtitle}</small>}
      </span>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        label={typeof label === 'string' ? label : undefined}
      />
    </div>
  );
}

/** 勾选圈（规格 3.15）。 */
export function CheckCircle({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <span
      className={`check-circle ${checked ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
      aria-hidden
    >
      {checked && <OldIcon name="wechat/check" size={18} />}
    </span>
  );
}

/** 空状态（规格 3.16）。 */
export function EmptyState({
  icon = 'wechat/chat',
  title,
  desc,
  action,
}: {
  icon?: string;
  title: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <OldIcon name={icon} size={72} />
      <p className="empty-title">{title}</p>
      {desc && <p className="empty-desc">{desc}</p>}
      {action}
    </div>
  );
}

/** 一排文字切换（规格 5 表）：选中 15 / 500 + 下方 2 高绿色短线。 */
export function TextTabs<T extends string>({
  items,
  value,
  onChange,
  right,
}: {
  items: Array<{ value: T; label: string }>;
  value: T;
  onChange(value: T): void;
  right?: ReactNode;
}) {
  return (
    <div className="text-tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={item.value === value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
      {right && <span className="text-tabs-right">{right}</span>}
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [onClose]);
}

/**
 * 底部弹层（规格 5 表）：白底、顶部圆角 12、无把手；标题栏高 56：左「取消」/ 中标题 / 右操作。
 * 从底部升起（只动 transform）。点遮罩或 Esc 关闭。
 */
export function Sheet({
  title,
  onClose,
  children,
  closeLabel = '关闭',
  action,
  half = false,
}: {
  title?: ReactNode;
  onClose(): void;
  children: ReactNode;
  closeLabel?: string;
  action?: ReactNode;
  half?: boolean;
}) {
  useEscape(onClose);
  const closeIcon = closeLabel === '✕' || closeLabel === '关闭';
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className={`sheet-panel ${half ? 'half' : ''}`}
        role="dialog"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {title != null && (
          <header className="sheet-head">
            <span className="sheet-head-side">
              {!closeIcon && (
                <button type="button" className="sheet-text-button" onClick={onClose}>
                  {closeLabel}
                </button>
              )}
            </span>
            <strong>{title}</strong>
            <span className="sheet-head-side end">
              {action ??
                (closeIcon && (
                  <button
                    type="button"
                    className="nav-bar-icon"
                    aria-label="关闭"
                    onClick={onClose}
                  >
                    <OldIcon name="wechat/close" size={22} />
                  </button>
                ))}
            </span>
          </header>
        )}
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export interface ActionItem {
  label: ReactNode;
  danger?: boolean;
  onClick(): void;
}

/** 底部操作列表（规格 3.10）。 */
export function ActionSheet({
  items,
  onClose,
  title,
}: {
  items: ActionItem[];
  onClose(): void;
  title?: ReactNode;
}) {
  useEscape(onClose);
  return (
    <div className="sheet-scrim action-scrim" onClick={onClose}>
      <div className="action-sheet" role="menu" onClick={(event) => event.stopPropagation()}>
        <div className="action-group">
          {title && <p className="action-title">{title}</p>}
          {items.map((item, index) => (
            <button
              key={index}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : ''}
              onClick={() => {
                onClose();
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="action-group">
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

/** 浅色长按菜单（规格 3.7）：在手指位置弹出，宽 168，每项 52；不压暗背景。 */
export function LongPressMenu({
  at,
  items,
  onClose,
}: {
  at: { x: number; y: number };
  items: ActionItem[];
  onClose(): void;
}) {
  useEscape(onClose);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: Math.max(12, Math.min(at.x, window.innerWidth - w - 12)),
      top: Math.max(12, Math.min(at.y, window.innerHeight - h - 12)),
    });
  }, [at.x, at.y]);
  return (
    <div className="pop-scrim" onClick={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={ref}
        className="light-menu"
        role="menu"
        style={{ left: pos.left, top: pos.top }}
        onClick={(event) => event.stopPropagation()}
      >
        {items.map((item, index) => (
          <button
            key={index}
            type="button"
            role="menuitem"
            className={item.danger ? 'danger' : ''}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 右上角 ⊕ 深色菜单（规格 4.2）。 */
export function PopMenu({
  items,
  onClose,
}: {
  items: Array<{ label: string; icon: IconSource; onClick(): void }>;
  onClose(): void;
}) {
  useEscape(onClose);
  return (
    <div className="pop-scrim" onClick={onClose}>
      <div className="pop-menu" role="menu" onClick={(event) => event.stopPropagation()}>
        {items.map(({ label, icon, onClick }) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onClick();
            }}
          >
            <Glyph icon={icon} size={19} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

const LONG_PRESS_MS = 500;
const PRESS_SLOP = 10;

/**
 * 长按（按住 500ms 不动）或右键：回调带手指位置；长按后吞掉随之而来的点击。轻点照常触发点击（进入页面）。
 * 总经理 2026-10-14 反馈「轻点就弹菜单」：部分手机内置浏览器（如社交 App 内置网页）抬手时不发 pointerup，
 * 旧写法的计时器没被取消，轻点后 0.5 秒照样弹菜单。现改为：触屏用 touch 事件（抬手 touchend 一定会发），
 * 鼠标用 pointer 事件；抬手、移动超过 10 像素、点击、页面滚动、组件卸载都会取消计时；
 * 计时到点时再确认手指仍按着才弹。
 */
export function useLongPress(onLongPress: (at: { x: number; y: number }) => void) {
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const callback = useRef(onLongPress);
  useLayoutEffect(() => {
    callback.current = onLongPress;
  });
  useEffect(() => {
    const onScroll = () => {
      window.clearTimeout(timer.current);
      start.current = null;
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.clearTimeout(timer.current);
    };
  }, []);
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  const begin = (x: number, y: number) => {
    window.clearTimeout(timer.current);
    fired.current = false;
    start.current = { x, y };
    timer.current = window.setTimeout(() => {
      if (!start.current) return;
      start.current = null;
      fired.current = true;
      navigator.vibrate?.(10);
      callback.current({ x, y });
    }, LONG_PRESS_MS);
  };
  const moveTo = (x: number, y: number) => {
    if (start.current && Math.hypot(x - start.current.x, y - start.current.y) > PRESS_SLOP)
      cancel();
  };
  return {
    onTouchStart(event: ReactTouchEvent) {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) return cancel();
      begin(touch.clientX, touch.clientY);
    },
    onTouchMove(event: ReactTouchEvent) {
      const touch = event.touches[0];
      if (touch) moveTo(touch.clientX, touch.clientY);
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onPointerDown(event: ReactPointerEvent) {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      begin(event.clientX, event.clientY);
    },
    onPointerMove(event: ReactPointerEvent) {
      if (event.pointerType === 'mouse') moveTo(event.clientX, event.clientY);
    },
    onPointerUp(event: ReactPointerEvent) {
      if (event.pointerType === 'mouse') cancel();
    },
    onPointerLeave(event: ReactPointerEvent) {
      if (event.pointerType === 'mouse') cancel();
    },
    onPointerCancel: cancel,
    onContextMenu(event: ReactMouseEvent) {
      event.preventDefault();
      // 安卓长按会在计时器之后再发一次 contextmenu：已经弹过就不再弹
      if (fired.current) return;
      cancel();
      fired.current = true;
      callback.current({ x: event.clientX, y: event.clientY });
      window.setTimeout(() => (fired.current = false), 400);
    },
    onClickCapture(event: ReactMouseEvent) {
      if (fired.current) {
        event.preventDefault();
        event.stopPropagation();
        fired.current = false;
      } else cancel();
    },
  };
}

// ---------- 暂未开放 ----------

/**
 * 参照产品有、微伴暂时用不上的入口（总经理 2026-10-13 要求：都放上）。
 * 2026-10-14 裁定：入口正常显示、不加标记，点击才弹轻提示「暂未开放」，不跳页。新增入口只在这里登记。
 */
export const comingSoon = {
  channels: { name: '视频号', icon: 'wechat/finder', tint: 'orange' },
  live: { name: '直播', icon: 'color/color_live', tint: 'red' },
  scan: { name: '扫一扫', icon: 'wechat/discover_scan', tint: 'blue' },
  listen: { name: '听一听', icon: 'wechat/discover_listen', tint: 'orange' },
  topstories: { name: '看一看', icon: 'color/color_look', tint: 'gold' },
  shake: { name: '摇一摇', icon: 'color/color_shake', tint: 'blue' },
  games: { name: '游戏', icon: 'color/color_game', tint: 'purple' },
  shop: { name: '购物', icon: 'wechat/store', tint: 'orange' },
  qrcode: { name: '二维码名片', icon: 'wechat/qr_code.png', tint: 'gray' },
  cards: { name: '卡包', icon: 'wechat/card.png', tint: 'blue' },
  pay: { name: '收付款', icon: 'wechat/transfer', tint: 'green' },
  status: { name: '状态', icon: 'wechat/smile', tint: 'gold' },
  tags: { name: '标签', icon: 'wechat/tag', tint: 'blue' },
  official: { name: '公众号', icon: 'wechat/contacts_official', tint: 'blue' },
  teen: { name: '青少年模式', icon: 'wechat/info', tint: 'green' },
  care: { name: '关怀模式', icon: 'wechat/heart', tint: 'red' },
  plugins: { name: '插件', icon: 'wechat/grid', tint: 'purple' },
  topics: { name: '话题', icon: 'wechat/tag', tint: 'gray' },
  card: { name: '发送名片', icon: 'wechat/person', tint: 'blue' },
  chatOnly: { name: '仅聊天的朋友', icon: 'wechat/contacts_chat_only.webp', tint: 'orange' },
  services: { name: '服务号', icon: 'wechat/contacts_official', tint: 'cyan' },
  workContacts: { name: '企业微信联系人', icon: 'wechat/contacts_enterprise.webp', tint: 'blue' },
} as const satisfies Record<string, { name: string; icon: string; tint: Tint }>;
export type ComingSoonKey = keyof typeof comingSoon;
export const comingSoonPath = (key: ComingSoonKey) => `/coming-soon/${key}`;
/** 点了用不上的入口：只弹轻提示「暂未开放」（总经理 2026-10-14：入口本身不加标记）。 */
export function showComingSoon() {
  showToast('暂未开放', 2000, 'info');
}

/** 菜单里用不上的入口：外观和普通行一样，点了弹轻提示。 */
export function ComingSoonRow({
  id,
  withIcon = true,
  tile = false,
  chevron = true,
  iconSize,
}: {
  id: ComingSoonKey;
  withIcon?: boolean;
  tile?: boolean;
  chevron?: boolean;
  iconSize?: number;
}) {
  const item = comingSoon[id];
  const image = /\.(png|webp)$/.test(item.icon);
  return (
    <MenuRow
      onClick={showComingSoon}
      icon={withIcon && !image ? item.icon : undefined}
      image={withIcon && image ? item.icon : undefined}
      iconSize={iconSize}
      tile={tile}
      chevron={chevron}
      tint={item.tint}
      label={item.name}
    />
  );
}

/** 旧链接 /coming-soon/:feature 的落地页（外部链接、推送打开时仍可能进来）。 */
export function ComingSoonPage() {
  const { feature = '' } = useParams();
  const item = (comingSoon as Record<string, (typeof comingSoon)[ComingSoonKey]>)[feature];
  const back = useBack('/discover');
  const name = item?.name ?? '这个功能';
  return (
    <main className="coming-soon">
      <NavBar title={name} fallback="/discover" />
      <EmptyState
        icon={item && !/\.(png|webp)$/.test(item.icon) ? item.icon : 'wechat/info'}
        title={`${name}暂未开放`}
        desc="微伴还在长大，这个功能以后再见。先去和 TA 聊聊吧。"
        action={
          <button type="button" className="primary" onClick={back}>
            返回
          </button>
        }
      />
    </main>
  );
}
