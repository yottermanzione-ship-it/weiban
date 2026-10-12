/*
 * 换壳通用部件（docs/refactor/02-wechat-shell-and-miniprograms.md、02a-navigation-tree.md）：
 * 标题栏、菜单行（图标方块）、底部弹层、气泡菜单、「暂未开放」页。只用设计令牌（app/shell.css）。
 */
import { useEffect, type ComponentType, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Aperture,
  BookOpenText,
  Broadcast,
  CaretLeft,
  CaretRight,
  Cardholder,
  Eye,
  GameController,
  HandHeart,
  IdentificationCard,
  Hash,
  Megaphone,
  PuzzlePiece,
  QrCode,
  Scan,
  ShieldCheck,
  Smiley,
  Storefront,
  Tag,
  Wallet,
  type IconProps,
} from '@phosphor-icons/react';

export type Tint = 'pink' | 'gold' | 'orange' | 'teal' | 'lilac' | 'blue' | 'gray' | 'brand';

/** 圆角方块图标（点缀色铺底 + 白色线框图标）。 */
export function IconTile({
  icon: Icon,
  tint,
  size = 'sm',
}: {
  icon: ComponentType<IconProps>;
  tint: Tint;
  size?: 'sm' | 'lg';
}) {
  return (
    <span className={`icon-tile tint-${tint} ${size}`} aria-hidden>
      <Icon size={size === 'lg' ? 28 : 20} weight="regular" />
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

/** 统一标题栏：‹ 返回 · 标题（可带副标题）· 右侧操作。 */
export function NavBar({
  title,
  subtitle,
  right,
  back = true,
  fallback,
  onBack,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  back?: boolean;
  fallback?: string;
  onBack?: () => void;
}) {
  const goBack = useBack(fallback);
  return (
    <header className="nav-bar">
      <span className="nav-bar-side">
        {back && (
          <button
            type="button"
            className="nav-bar-back"
            aria-label="返回"
            onClick={onBack ?? goBack}
          >
            <CaretLeft size={24} />
          </button>
        )}
      </span>
      <span className="nav-bar-title">
        <h1>{title}</h1>
        {subtitle}
      </span>
      <span className="nav-bar-side end">{right}</span>
    </header>
  );
}

/** 菜单列表的一行（发现页、通讯录固定行、我页）。 */
export function MenuRow({
  to,
  onClick,
  icon,
  tint = 'brand',
  label,
  value,
  dot,
  extra,
}: {
  to?: string;
  onClick?: () => void;
  icon?: ComponentType<IconProps>;
  tint?: Tint;
  label: ReactNode;
  value?: ReactNode;
  dot?: boolean;
  extra?: ReactNode;
}) {
  const body = (
    <>
      {icon && <IconTile icon={icon} tint={tint} />}
      <span className="menu-label">{label}</span>
      {extra}
      {dot && <span className="red-dot" aria-label="有新内容" />}
      {value != null && <span className="menu-value">{value}</span>}
      <CaretRight size={16} className="menu-caret" aria-hidden />
    </>
  );
  return to ? (
    <Link className="menu-row" to={to}>
      {body}
    </Link>
  ) : (
    <button type="button" className="menu-row" onClick={onClick}>
      {body}
    </button>
  );
}

export function MenuGroup({ children }: { children: ReactNode }) {
  return <div className="menu-group">{children}</div>;
}

/** 底部弹层（从下升起，只动 transform / opacity）。点遮罩或 Esc 关闭。 */
export function Sheet({
  title,
  onClose,
  children,
  closeLabel = '关闭',
}: {
  title?: ReactNode;
  onClose(): void;
  children: ReactNode;
  closeLabel?: string;
}) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [onClose]);
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        className="sheet-panel"
        role="dialog"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {title && (
          <header className="sheet-head">
            <strong>{title}</strong>
            <button type="button" className="text-button" onClick={onClose}>
              {closeLabel}
            </button>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}

/** 右上角气泡菜单（⊕）。 */
export function PopMenu({
  items,
  onClose,
}: {
  items: Array<{ label: string; icon: ComponentType<IconProps>; onClick(): void }>;
  onClose(): void;
}) {
  return (
    <div className="pop-scrim" onClick={onClose}>
      <div className="pop-menu" role="menu" onClick={(event) => event.stopPropagation()}>
        {items.map(({ label, icon: Icon, onClick }) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onClick();
            }}
          >
            <Icon size={22} aria-hidden />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- 暂未开放 ----------

/**
 * 参照产品有、微伴暂时用不上的入口（总经理 2026-10-13 要求：都放上，点进去是统一的「暂未开放」页）。
 * 新增入口只在这里登记。
 */
export const comingSoon = {
  channels: { name: '视频号', icon: Aperture, tint: 'orange' },
  live: { name: '直播', icon: Broadcast, tint: 'pink' },
  scan: { name: '扫一扫', icon: Scan, tint: 'blue' },
  listen: { name: '听书', icon: BookOpenText, tint: 'orange' },
  topstories: { name: '看一看', icon: Eye, tint: 'gold' },
  games: { name: '游戏', icon: GameController, tint: 'lilac' },
  qrcode: { name: '二维码名片', icon: QrCode, tint: 'gray' },
  cards: { name: '卡包', icon: Cardholder, tint: 'blue' },
  pay: { name: '收付款', icon: Wallet, tint: 'teal' },
  status: { name: '状态', icon: Smiley, tint: 'gold' },
  tags: { name: '标签', icon: Tag, tint: 'blue' },
  official: { name: '公众号', icon: Megaphone, tint: 'blue' },
  shop: { name: '购物', icon: Storefront, tint: 'orange' },
  teen: { name: '青少年模式', icon: ShieldCheck, tint: 'teal' },
  care: { name: '关怀模式', icon: HandHeart, tint: 'pink' },
  plugins: { name: '插件', icon: PuzzlePiece, tint: 'lilac' },
  topics: { name: '话题', icon: Hash, tint: 'gray' },
  card: { name: '发送名片', icon: IdentificationCard, tint: 'blue' },
} as const satisfies Record<string, { name: string; icon: ComponentType<IconProps>; tint: Tint }>;
export type ComingSoonKey = keyof typeof comingSoon;
export const comingSoonPath = (key: ComingSoonKey) => `/coming-soon/${key}`;

/** 菜单里的「暂未开放」行。 */
export function ComingSoonRow({ id, withIcon = true }: { id: ComingSoonKey; withIcon?: boolean }) {
  const item = comingSoon[id];
  return (
    <MenuRow
      to={comingSoonPath(id)}
      icon={withIcon ? item.icon : undefined}
      tint={item.tint}
      label={item.name}
    />
  );
}

export function ComingSoonPage() {
  const { feature = '' } = useParams();
  const item = (comingSoon as Record<string, (typeof comingSoon)[ComingSoonKey]>)[feature];
  const back = useBack('/discover');
  const name = item?.name ?? '这个功能';
  return (
    <main className="coming-soon">
      <NavBar title={name} fallback="/discover" />
      <div className="coming-soon-body">
        {item && <IconTile icon={item.icon} tint={item.tint} size="lg" />}
        <h2>{name}暂未开放</h2>
        <p className="hint">微伴还在长大，这个功能以后再见。先去和 TA 聊聊吧。</p>
        <button type="button" className="primary" onClick={back}>
          返回
        </button>
      </div>
    </main>
  );
}
