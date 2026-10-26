/*
 * 旧版界面通用组件（docs/refactor/06-old-ui-spec.md 第 3 节）：顶栏、菜单行、分组、分组标题、开关行、
 * 底部弹层、操作列表、浅色长按菜单、⊕ 深色菜单、勾选圈、空状态、文字切换、「暂未开放」。
 * 只用设计令牌（app/old-ui.css），动画只用 transform / opacity。
 */
import {
  useCallback,
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
  leading,
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
  leading?: ReactNode;
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
  // 10-20：红色危险操作行（退出登录、删除、清空、注销…）一律微信式居中、无箭头
  const centered = center || danger;
  const body = (
    <>
      {leading != null ? (
        <span className="menu-leading">{leading}</span>
      ) : image ? (
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
      <span className={`menu-text ${centered ? 'center' : ''}`}>
        <span className="menu-label">
          {/* 纯文字包一层：menu-label 是 flex，匿名文本节点无法省略，长标题会被硬裁 */}
          {typeof label === 'string' ? <span className="menu-label-text">{label}</span> : label}
          {badge}
          {dot && <span className="red-dot" aria-label="有新内容" />}
        </span>
        {subtitle != null && <small className="menu-subtitle">{subtitle}</small>}
      </span>
      {extra}
      {value != null && <span className="menu-value">{value}</span>}
      {right}
      {chevron && !centered && (to || onClick) && <Chevron />}
    </>
  );
  const className = `menu-row ${subtitle != null ? 'two-line' : ''} ${danger ? 'danger' : ''}`;
  if (!to && !onClick)
    return (
      <div className={className} aria-disabled={disabled || undefined}>
        {body}
      </div>
    );
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
  ariaLabel,
  subtitle,
  checked,
  disabled,
  onChange,
}: {
  label: ReactNode;
  ariaLabel?: string;
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
        label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      />
    </div>
  );
}

/** 勾选圈（规格 3.15）。size 用于登录页那种 16px 小圈，默认 24。 */
export function CheckCircle({
  checked,
  disabled,
  size = 24,
}: {
  checked: boolean;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <span
      className={`check-circle ${checked ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
      style={{ width: size, height: size, borderWidth: size <= 18 ? 1 : undefined }}
      aria-hidden
    >
      {checked && <OldIcon name="wechat/check" size={Math.round(size * 0.72)} />}
    </span>
  );
}

/** 首次同步还没回来时的占位：超过 6 秒仍没数据就提示重试，避免永远「正在读取」。 */
export function SyncPendingState({
  icon = 'wechat/person',
  label = '正在读取…',
}: {
  icon?: string;
  label?: string;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <EmptyState
      icon={icon}
      title={slow ? '读取较慢，返回上一页重试' : label}
      desc={slow ? '网络恢复后会自动继续' : undefined}
    />
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

export function useEscape(onClose: () => void) {
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
  fullScreen = false,
  closeDisabled = false,
}: {
  title?: ReactNode;
  onClose(): void;
  children: ReactNode;
  closeLabel?: string;
  action?: ReactNode;
  half?: boolean;
  fullScreen?: boolean;
  closeDisabled?: boolean;
}) {
  useEscape(() => {
    if (!closeDisabled) onClose();
  });
  const closeIcon = closeLabel === '✕' || closeLabel === '关闭';
  return (
    <div
      className="sheet-scrim"
      onClick={() => {
        if (!closeDisabled) onClose();
      }}
    >
      <div
        className={`sheet-panel shell-sheet ${half ? 'half' : ''} ${fullScreen ? 'fullscreen' : ''}`}
        role="dialog"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {title != null && (
          <header className="sheet-head">
            <span className="sheet-head-side">
              {!closeIcon && (
                <button
                  type="button"
                  className="sheet-text-button"
                  disabled={closeDisabled}
                  onClick={onClose}
                >
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
                    disabled={closeDisabled}
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
  /** 单选列表里的当前项：右侧固定位置显示绿色对号，不参与文字居中（10-21 G2）。 */
  checked?: boolean;
  onClick(): void;
}

/**
 * 对号固定列（10-21 G2）：不管选没选中都占同样宽度，行尾其他图标（试听喇叭等）因此始终对齐。
 */
export function CheckSlot({ checked, size = 20 }: { checked: boolean; size?: number }) {
  return (
    <span
      className="check-slot"
      style={{ width: size }}
      aria-label={checked ? '已选择' : undefined}
    >
      {checked && <OldIcon name="wechat/check" size={size} className="ink-brand" />}
    </span>
  );
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
              role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={item.checked}
              className={item.danger ? 'danger' : ''}
              onClick={() => {
                onClose();
                item.onClick();
              }}
            >
              {item.label}
              {item.checked && (
                <span className="action-check" aria-hidden>
                  <OldIcon name="wechat/check" size={20} className="ink-brand" />
                </span>
              )}
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
  const scrim = useMenuScrim(onClose);
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
    <div className="pop-scrim" {...scrim}>
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
  const scrim = useMenuScrim(onClose);
  return (
    <div className="pop-scrim" {...scrim}>
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

// ---------- 下拉筛选胶囊（角色广场的排序 / 类型 / 分类，替换浏览器原生 select） ----------

export interface PopSelectOption {
  value: string;
  label: string;
}

/** 同一时间只展开一颗筛选：新的展开前先把已展开的关掉。 */
const openPopSelectClosers = new Set<() => void>();
const nothing = () => {};

/**
 * 胶囊按钮 + 紧贴按钮正下方的圆角卡片菜单（外观沿用设计令牌里的 FilterBar 胶囊）。
 * - 按钮写当前选中值 + 向下小箭头，不再弹浏览器原生菜单；
 * - 菜单：圆角 12、白底（深色模式跟随）、轻微阴影、上下留白、每项 40 高，选中项品牌色 + 右侧对勾；
 * - 关闭：点外部、Esc（焦点回到按钮）、再点同一颗；同一时间只展开一颗；
 * - 无障碍：按钮 aria-haspopup="menu" + aria-expanded，菜单 role="menu"，每项 role="menuitemradio" + aria-checked。
 */
export function PopSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  /** 这颗筛选的名字（排序 / 类型 / 分类），只用于无障碍名称。 */
  label: string;
  value: string;
  options: PopSelectOption[];
  onChange(value: string): void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [alignEnd, setAlignEnd] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  // Esc 关闭（复用 useEscape）：顺手把焦点还给按钮，键盘用户不会掉到页面开头。
  const closeOnEscape = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);
  useEscape(open ? closeOnEscape : nothing);
  // 登记已展开的这颗，别的展开时先关掉它。
  useEffect(() => {
    if (!open) return;
    openPopSelectClosers.add(close);
    return () => {
      openPopSelectClosers.delete(close);
    };
  }, [open, close]);
  // 点组件外面关闭。用 pointerdown：打开这一下已经过去，不会自己把自己关掉。
  useEffect(() => {
    if (!open) return;
    const listener = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', listener, true);
    return () => document.removeEventListener('pointerdown', listener, true);
  }, [open]);
  // 菜单比按钮宽时改成靠按钮右边缘贴齐，最后一颗筛选点了不会顶出屏幕右边。
  useLayoutEffect(() => {
    if (!open) {
      setAlignEnd(false);
      return;
    }
    const el = menu.current;
    const anchor = trigger.current;
    if (!el || !anchor) return;
    setAlignEnd(anchor.getBoundingClientRect().left + el.offsetWidth > window.innerWidth - 12);
  }, [open]);
  const current = options.find((option) => option.value === value);
  return (
    <div className="pop-select" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="pop-select-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}：${current?.label ?? ''}`}
        disabled={disabled}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          for (const closeOther of openPopSelectClosers) closeOther();
          setOpen(true);
        }}
      >
        <span className="pop-select-value">{current?.label ?? label}</span>
        <OldIcon name="wechat/chevron_down" size={12} className="pop-select-caret" />
      </button>
      {open && (
        <div
          ref={menu}
          className={`pop-select-menu${alignEnd ? ' end' : ''}`}
          role="menu"
          aria-label={label}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              onClick={() => {
                setOpen(false);
                onChange(option.value);
              }}
            >
              <span className="pop-select-option">{option.label}</span>
              {option.value === value && (
                <OldIcon name="wechat/check" size={18} className="ink-brand" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const LONG_PRESS_MS = 500;
const PRESS_SLOP = 10;
/** 长按菜单刚出现后，抬手补发的兼容点击/上下文菜单不能被当成"点遮罩关闭"。 */
const SWALLOW_MS = 1000;

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
  const firedAt = useRef(0);
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
  /** 最近一次长按是否刚触发：用时间窗而不是布尔，避免安卓的 contextmenu 与计时器互相把状态抹掉。 */
  const recentlyFired = () => firedAt.current > 0 && Date.now() - firedAt.current < SWALLOW_MS;
  const fire = (x: number, y: number) => {
    firedAt.current = Date.now();
    callback.current({ x, y });
  };
  const begin = (x: number, y: number) => {
    window.clearTimeout(timer.current);
    firedAt.current = 0;
    start.current = { x, y };
    timer.current = window.setTimeout(() => {
      if (!start.current) return;
      start.current = null;
      fire(x, y);
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
    onTouchEnd(event: ReactTouchEvent) {
      // 长按已弹菜单：阻止抬手后浏览器补发的点击（否则会立刻点到菜单遮罩把菜单关掉，或进入会话）
      if (recentlyFired() && event.cancelable) event.preventDefault();
      cancel();
    },
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
      // 安卓长按会同时发 contextmenu 和到点计时器：谁先到谁弹，另一个直接忽略。
      if (firedAt.current > 0) return;
      cancel();
      fire(event.clientX, event.clientY);
    },
    onClickCapture(event: ReactMouseEvent) {
      if (recentlyFired()) {
        event.preventDefault();
        event.stopPropagation();
        firedAt.current = 0;
        return;
      }
      cancel();
      firedAt.current = 0;
    },
  };
}

/**
 * 长按菜单的遮罩点击：菜单刚出现的一小段时间内忽略点击。
 * 手机抬手后浏览器可能补发一次兼容点击，落点正好是刚铺开的遮罩，会把菜单瞬间关掉。
 */
export function useMenuScrim(onClose: () => void, guardMs = 400) {
  const openedAt = useRef(Date.now());
  return {
    onClick() {
      if (Date.now() - openedAt.current < guardMs) return;
      onClose();
    },
    onContextMenu(event: ReactMouseEvent) {
      event.preventDefault();
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
  listen: { name: '听书', icon: 'wechat/discover_listen', tint: 'orange' },
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
  workContacts: { name: '企业微信联系人', icon: 'drawn/people', tint: 'blue' },
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
