/*
 * 旧版界面图标（docs/refactor/06-old-ui-spec.md 第 7 节）。
 * - OldIcon：单色图标，用 CSS mask 显示，颜色跟随 currentColor（或传 color）。
 * - OldImage：彩色原图（原色，不能着色）。
 * - 下面按 Phosphor 的名字导出同名组件：各页原来的 `import { X } from '@phosphor-icons/react'`
 *   改为从本文件引入即换成旧版素材；旧版素材里没有对应图形的（宠物、食物等内容插画）继续用 Phosphor。
 */
import type { CSSProperties } from 'react';
import type { IconProps } from '@phosphor-icons/react';

export type { IconProps };

const BASE = '/assets/old-ui/icons/';

/** 图标路径：`wechat/back`、`drawn/paw`、`color/color_settings`；不写扩展名时按 .svg。 */
export function iconUrl(name: string) {
  return `${BASE}${/\.(png|webp|svg)$/.test(name) ? name : `${name}.svg`}`;
}

export function OldIcon({
  name,
  size = 24,
  width,
  height,
  color,
  className,
  style,
  label,
}: {
  name: string;
  size?: number | string;
  width?: number | string;
  height?: number | string;
  color?: string;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  const url = `url("${iconUrl(name)}")`;
  return (
    <span
      className={`old-icon ${className ?? ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        width: width ?? size,
        height: height ?? size,
        maskImage: url,
        WebkitMaskImage: url,
        ...(color ? { color } : null),
        ...style,
      }}
    />
  );
}

export function OldImage({
  name,
  size = 24,
  className,
  label,
}: {
  name: string;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <img
      className={`old-image ${className ?? ''}`}
      src={iconUrl(name)}
      width={size}
      height={size}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      decoding="async"
    />
  );
}

/** 生成与 Phosphor 同名、同参数的组件。filled：weight="fill" 时换用的实心图。 */
function mk(name: string, filled?: string) {
  function Icon({ size = 24, weight, color, className, style, ...rest }: IconProps) {
    const label = (rest as { 'aria-label'?: string })['aria-label'];
    return (
      <OldIcon
        name={weight === 'fill' && filled ? filled : name}
        size={size}
        color={color}
        className={className}
        style={style}
        label={label}
      />
    );
  }
  Icon.displayName = `OldIcon(${name})`;
  return Icon;
}

export const AddressBook = mk('wechat/nav_contacts_lines');
export const Alarm = mk('wechat/bell');
export const Aperture = mk('wechat/finder');
export const BookOpen = mk('wechat/article');
export const BookOpenText = mk('wechat/discover_listen');
export const BookmarkSimple = mk('wechat/star', 'wechat/star_filled');
export const Camera = mk('wechat/camera');
export const Cards = mk('drawn/cards');
export const CaretDown = mk('wechat/chevron_down');
export const CaretLeft = mk('wechat/back_crop');
export const CaretRight = mk('wechat/chevron_right');
export const ChatCircle = mk('wechat/chat');
export const ChatCircleDots = mk('wechat/chat');
export const ChatsCircle = mk('wechat/chat_pair');
export const ChartBar = mk('wechat/note');
export const Check = mk('wechat/check');
export const CheckCircle = mk('wechat/check');
export const Circle = mk('drawn/capsule_close');
export const Compass = mk('wechat/moment');
export const CurrencyCny = mk('wechat/tag');
export const DotsThree = mk('wechat/more');
export const DownloadSimple = mk('drawn/import');
export const EnvelopeOpen = mk('drawn/letter');
export const EnvelopeSimple = mk('drawn/letter');
export const EnvelopeSimpleOpen = mk('drawn/letter');
export const Flower = mk('drawn/flower');
export const FlowerLotus = mk('drawn/flower');
export const GameController = mk('color/color_game');
export const Gear = mk('color/color_settings');
export const Gift = mk('wechat/gift');
export const Heart = mk('wechat/heart');
export const HourglassMedium = mk('drawn/hourglass');
export const IdentificationCard = mk('wechat/person');
export const Image = mk('wechat/album');
export const ImageIcon = mk('wechat/album');
export const ImageBroken = mk('wechat/picture');
export const Images = mk('wechat/picture');
export const Keyboard = mk('wechat/keyboard');
export const LinkSimple = mk('wechat/link');
export const ListChecks = mk('wechat/check');
export const MagnifyingGlass = mk('wechat/search');
export const Medal = mk('wechat/star');
export const Microphone = mk('drawn/mic');
export const MicrophoneSlash = mk('drawn/mic_off');
export const Notebook = mk('wechat/note');
export const Pause = mk('wechat/pause.png');
export const PawPrint = mk('drawn/paw');
export const PenNib = mk('wechat/note');
export const PencilSimple = mk('wechat/note');
export const PencilSimpleLine = mk('wechat/note');
export const Phone = mk('drawn/phone');
export const PhoneDisconnect = mk('drawn/hangup');
export const PhoneIncoming = mk('drawn/phone');
export const PhoneX = mk('drawn/hangup');
export const Play = mk('wechat/play');
export const Plus = mk('wechat/add');
export const PlusCircle = mk('wechat/add_circle');
export const QrCode = mk('wechat/qr_code.png');
export const Question = mk('wechat/info');
export const Receipt = mk('wechat/note');
export const Scan = mk('wechat/discover_scan');
export const Share = mk('wechat/share');
export const ShoppingBag = mk('wechat/store');
export const Smiley = mk('wechat/smile');
export const Sparkle = mk('drawn/scenario_sparkle');
export const SquaresFour = mk('wechat/discover_mini_program');
export const Star = mk('wechat/star', 'wechat/star_filled');
export const Storefront = mk('wechat/store');
export const Tag = mk('wechat/tag');
export const ThumbsUp = mk('wechat/like', 'wechat/like_filled');
export const Timer = mk('drawn/hourglass');
export const Trophy = mk('wechat/star');
export const User = mk('wechat/person');
export const UserList = mk('wechat/person');
export const UserPlus = mk('wechat/person');
export const Users = mk('drawn/people');
export const UsersFour = mk('drawn/people');
export const UsersThree = mk('drawn/people');
export const VideoCamera = mk('wechat/video_call');
export const Warning = mk('wechat/warning');
export const WarningCircle = mk('wechat/warning');
export const X = mk('wechat/close');

// 旧版素材里没有对应图形的：内容插画类图标继续用 Phosphor。
export {
  ArrowFatUp,
  BowlFood,
  Briefcase,
  Broadcast,
  Cake,
  CalendarBlank,
  CalendarCheck,
  Cardholder,
  CaretUp,
  Cat,
  Coffee,
  CookingPot,
  DeviceMobile,
  Dog,
  Eye,
  Fish,
  FlagBanner,
  FrameCorners,
  Gauge,
  Hand,
  HandHeart,
  HandTap,
  Hash,
  Headphones,
  House,
  JarLabel,
  Lightning,
  Lock,
  LockSimple,
  Megaphone,
  Moon,
  MusicNote,
  MusicNotes,
  Plant,
  PlusSquare,
  Rabbit,
  Ruler,
  ShieldCheck,
  Sun,
  TennisBall,
  Ticket,
  Wallet,
} from '@phosphor-icons/react';
