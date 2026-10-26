import type { ReceivedMessageContent, ShareTemplate } from '@weiban/contracts';
import { Ecc, QrCode } from '@rc-component/qrcode/es/libs/qrcodegen';
import tokens from '../../../../docs/design/tokens.json';

/*
 * 分享图画布绘制（share-templates.md v3）。
 * 三套模板：A 微信原样（默认）/ B 柔和信纸 / C 卡片海报；三套共用底部品牌栏（logo +「微伴AI聊天」+ 关系或真人提示 + 下载二维码）。
 * 以 360 逻辑像素宽排版、放大 3 倍导出 1080 宽。颜色、字体都取自设计令牌 tokens.json 的 share.* 一组：固定浅色，不跟随用户主题。
 *
 * 令牌查找失败一律抛错（生成失败可见），不再像 v2「聊天原样」那样静默得到 "undefined" → 画布默认黑色整张底。
 */

// ---------- 令牌 ----------

type Node = Record<string, unknown>;
export function lookup(path: string, depth = 0): string {
  let node: unknown = tokens;
  for (const part of path.split('.')) node = (node as Node | undefined)?.[part];
  const value = (node as { $value?: unknown } | undefined)?.$value ?? node;
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    if (depth >= 8) throw new Error(`share token loop: ${path}`);
    return lookup(value.slice(1, -1), depth + 1);
  }
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new Error(`share token missing: ${path}`);
  return String(value);
}

function readPalette() {
  const s = (name: string) => lookup(`share.${name}`);
  return {
    text: s('text'),
    secondary: s('textSecondary'),
    hairline: s('hairline'),
    chatBg: s('chatBg'),
    chatMine: s('chatBubbleMine'),
    chatOther: s('chatBubbleOther'),
    paperBg: s('paperBg'),
    paperMine: s('paperBubbleMine'),
    paperOther: s('paperBubbleOther'),
    paperBorder: s('paperBorder'),
    paperQuote: s('paperQuote'),
    posterBg: s('posterBg'),
    badgeBg: s('posterBadgeBg'),
    badgeText: s('posterBadgeText'),
    footerBg: s('footerBg'),
    qr: s('qr'),
    logo: s('logo'),
    meAvatarBg: s('meAvatarBg'),
    meAvatarText: s('meAvatarText'),
    placeholder: lookup('primitive.color.gray.150'),
    placeholderIcon: lookup('primitive.color.gray.400'),
    sans: lookup('typography.fontFamily.sans'),
    serif: lookup('typography.fontFamily.serif'),
  };
}
let paletteCache: ReturnType<typeof readPalette> | null = null;
/** 分享图固定色（第一次用时读取；缺令牌时抛错，由调用方显示「生成失败」）。 */
export function sharePalette() {
  return (paletteCache ??= readPalette());
}

// ---------- 模板与契约值 ----------

export type ShareStyle = 'wechat' | 'paper' | 'poster';
export const SHARE_STYLES: ReadonlyArray<{ id: ShareStyle; label: string }> = [
  { id: 'wechat', label: '微信原样' },
  { id: 'paper', label: '柔和信纸' },
  { id: 'poster', label: '卡片海报' },
];
/**
 * 契约 ShareTemplate 仍是 v2 的四个值（不改契约）。v3 映射：
 * 读：pink_filter（服务器初始值）/ chat_original / 未知 → A；simple_white → B；card_style → C。
 * 写：A → chat_original，B → simple_white，C → card_style。
 */
export function styleFromTemplate(template: ShareTemplate | null | undefined): ShareStyle {
  if (template === 'simple_white') return 'paper';
  if (template === 'card_style') return 'poster';
  return 'wechat';
}
export function templateForStyle(style: ShareStyle): ShareTemplate {
  if (style === 'paper') return 'simple_white';
  if (style === 'poster') return 'card_style';
  return 'chat_original';
}

/** 品牌栏二维码指向的官网下载页（总经理 10-27）。 */
export const SHARE_DOWNLOAD_URL = 'https://weiban.online';
export const SHARE_WIDTH = 360;
export const SHARE_SCALE = 3;
const W = SHARE_WIDTH;
const MIN_HEIGHT = 480;
const FOOTER_HEIGHT = 84;

export interface SharePerson {
  name: string;
  letters: string;
  background: string;
  foreground: string;
  image: HTMLImageElement | null;
}
export interface ShareRenderItem {
  mine: boolean;
  characterId: string | null;
  content: ReceivedMessageContent;
  createdAt: string;
  /** 图片 / 表情的已加载图像；没加载出来为 null（画占位）。 */
  image: HTMLImageElement | null;
}
export interface ShareRenderCard {
  title: string;
  line: string;
  serialNo: number;
  obtainedOn: string;
  kind: string;
  face: HTMLImageElement | null;
  characterId: string;
}
export interface ShareRenderInput {
  style: ShareStyle;
  label: 'weiban' | 'weiban_not_real_person';
  items: ShareRenderItem[];
  people: Record<string, SharePerson>;
  me: SharePerson;
  title: string;
  group: boolean;
  daysKnown: number | null;
  showTime: boolean;
  card: ShareRenderCard | null;
  /** B 柔和信纸的摘录句：items 下标；null = 不显示摘录。 */
  excerpt: number | null;
  /** 品牌栏 logo（旧版绿色小熊图标）；没加载出来时画简化版。 */
  logo: HTMLImageElement | null;
}

// ---------- 画笔：dry = true 时只量尺寸不画 ----------

const NO_LINE_START = '，。！？、；：）」』”’…～,.!?;:)]}%';

class Painter {
  readonly pal = sharePalette();
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly dry: boolean,
  ) {}
  font(size: number, weight = 400, family = this.pal.sans) {
    this.ctx.font = `${weight} ${size}px ${family}`;
  }
  width(text: string) {
    return this.ctx.measureText(text).width;
  }
  wrap(text: string, max: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const ch of Array.from(paragraph)) {
        // 句末标点不放到行首（避头点），允许略超出一点。
        if (line && this.width(line + ch) > max && !NO_LINE_START.includes(ch)) {
          lines.push(line);
          line = ch;
        } else line += ch;
      }
      lines.push(line);
    }
    return lines;
  }
  /** 按当前字体换行，最多 maxLines 行，超出时最后一行加省略号。 */
  clamp(text: string, max: number, maxLines: number): string[] {
    const lines = this.wrap(text, max);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1] ?? '';
    while (last && this.width(`${last}…`) > max) last = Array.from(last).slice(0, -1).join('');
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  text(text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left') {
    if (this.dry) return;
    this.ctx.fillStyle = color;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(text, x, y);
  }
  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number | number[],
    fill: string | null,
    stroke?: string,
    lineWidth = 1,
  ) {
    if (this.dry) return;
    const { ctx } = this;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }
  line(x1: number, y: number, x2: number, color: string) {
    if (this.dry) return;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x1, y, x2 - x1, 0.5);
  }
  image(img: HTMLImageElement, x: number, y: number, w: number, h: number, radius = 0) {
    if (this.dry) return;
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.clip();
    // 居中裁剪铺满。
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }
  avatar(person: SharePerson, x: number, y: number, size: number, radius: number) {
    // 头像底色取不到（空字符串）时用中性灰，避免画布退回默认黑色。
    this.rect(x, y, size, size, radius, person.background || this.pal.meAvatarBg);
    if (person.image) this.image(person.image, x, y, size, size, radius);
    else {
      this.font(size * (Array.from(person.letters).length === 1 ? 0.44 : 0.34), 600);
      if (this.dry) return;
      this.ctx.textBaseline = 'middle';
      this.ctx.textAlign = 'center';
      this.ctx.fillStyle = person.foreground || this.pal.meAvatarText;
      this.ctx.fillText(person.letters, x + size / 2, y + size / 2);
    }
  }
  /** 图片没加载出来：灰底 + 简笔「图片」图标。 */
  placeholder(x: number, y: number, w: number, h: number, radius: number) {
    this.rect(x, y, w, h, radius, this.pal.placeholder);
    if (this.dry) return;
    const { ctx } = this;
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.strokeStyle = this.pal.placeholderIcon;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx - 12, cy - 9, 24, 18, 2);
    ctx.moveTo(cx - 9, cy + 6);
    ctx.lineTo(cx - 2, cy - 1);
    ctx.lineTo(cx + 3, cy + 4);
    ctx.lineTo(cx + 6, cy + 1);
    ctx.lineTo(cx + 9, cy + 6);
    ctx.stroke();
  }
}

// ---------- 内容转文字 ----------

function seconds(ms: number) {
  return `${Math.max(1, Math.round(ms / 1000))}″`;
}
function clock(totalSec: number) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export function shareText(content: ReceivedMessageContent): string {
  switch (content.type) {
    case 'text':
      return content.text;
    case 'link':
      return `[链接] ${content.title}`;
    case 'voice':
      return `[语音 ${seconds(content.durationMs)}]${content.transcript ? ` ${content.transcript}` : ''}`;
    case 'letter':
      return content.body;
    case 'daily_question':
      return `问：${content.question}\n答：${content.answer}`;
    case 'contact_card':
      return `[名片] ${content.name}`;
    case 'call_record':
      return `[通话] 时长 ${clock(content.durationSec)}`;
    case 'nudge':
      return '拍了拍';
    case 'action_card':
      return content.text;
    case 'forwarded_record':
      return `[聊天记录] ${content.title}`;
    case 'image':
      return '[图片]';
    case 'sticker':
      return '[表情]';
    default:
      return '[消息]';
  }
}

function pictureSize(item: ShareRenderItem, longSide: number) {
  if (item.content.type === 'sticker') return { w: 88, h: 88 };
  const width =
    (item.content.type === 'image' && item.content.width) || item.image?.naturalWidth || 4;
  const height =
    (item.content.type === 'image' && item.content.height) || item.image?.naturalHeight || 3;
  const scale = longSide / Math.max(width, height);
  return {
    w: Math.max(40, Math.round(width * scale)),
    h: Math.max(40, Math.round(height * scale)),
  };
}

function dateText(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
function timeText(iso: string, previous?: string) {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (previous && new Date(previous).toDateString() === d.toDateString()) return hm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
function needsTime(item: ShareRenderItem, previous?: ShareRenderItem) {
  return (
    !previous ||
    new Date(item.createdAt).getTime() - new Date(previous.createdAt).getTime() > 5 * 60_000
  );
}
function personOf(input: ShareRenderInput, item: ShareRenderItem): SharePerson {
  return item.mine ? input.me : (input.people[item.characterId ?? ''] ?? input.me);
}
/** 头部 / 海报用的主角：卡片的角色，否则第一条角色消息的角色。 */
function leadPerson(input: ShareRenderInput): SharePerson {
  const id = input.card?.characterId ?? input.items.find((i) => !i.mine)?.characterId;
  return (id && input.people[id]) || Object.values(input.people)[0] || input.me;
}
function lastDate(input: ShareRenderInput) {
  return dateText(input.items.at(-1)?.createdAt ?? new Date().toISOString());
}

// ---------- 摘录句（B） ----------

const EXCERPT_SHORT = 6;
function excerptText(item: ShareRenderItem | undefined) {
  return item?.content.type === 'text' ? item.content.text.trim() : '';
}
/** 可做摘录的句子：角色说的文字消息（items 下标，按时间顺序）。 */
export function excerptCandidates(items: ShareRenderItem[]): number[] {
  return items.flatMap((item, index) => (!item.mine && excerptText(item) ? [index] : []));
}
/** 默认摘录：角色说的最长一句；都很短（< 6 字）时取最后一句。 */
export function defaultExcerpt(items: ShareRenderItem[]): number | null {
  const candidates = excerptCandidates(items);
  if (candidates.length === 0) return null;
  const length = (i: number) => Array.from(excerptText(items[i])).length;
  const longest = candidates.reduce((best, i) => (length(i) > length(best) ? i : best));
  return length(longest) < EXCERPT_SHORT ? (candidates.at(-1) ?? null) : longest;
}

// ---------- 聊天消息（A、B 共用，外观由 look 决定） ----------

interface ChatLook {
  side: number;
  avatar: number;
  avatarRadius: number;
  bubbleRadius: number;
  tail: boolean;
  mineBg: string;
  otherBg: string;
  otherBorder: string | null;
  pictureRadius: number;
  textMax: number;
}

const LINE = 22; // 正文 15 的行高
const PAD_X = 12;
const PAD_Y = 9;

function bubbleShape(
  p: Painter,
  look: ChatLook,
  x: number,
  top: number,
  w: number,
  h: number,
  mine: boolean,
) {
  const fill = mine ? look.mineBg : look.otherBg;
  const border = mine ? null : look.otherBorder;
  p.rect(x, top, w, h, look.bubbleRadius, fill, border ?? undefined, 1);
  if (look.tail && !p.dry) {
    // 小尖角（微信样式），在头像一侧、距顶 14。
    const tx = mine ? x + w : x;
    const dir = mine ? 1 : -1;
    const { ctx } = p;
    ctx.beginPath();
    ctx.moveTo(tx - dir * 0.5, top + 12);
    ctx.lineTo(tx + dir * 5, top + 17);
    ctx.lineTo(tx - dir * 0.5, top + 22);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

/** 画一段文字气泡，返回高度。 */
function textBubble(
  p: Painter,
  look: ChatLook,
  text: string,
  edge: number,
  top: number,
  mine: boolean,
) {
  p.font(15);
  const lines = p.wrap(text, look.textMax);
  const w = Math.max(...lines.map((l) => p.width(l))) + PAD_X * 2;
  const h = lines.length * LINE + PAD_Y * 2;
  const x = mine ? edge - w : edge;
  bubbleShape(p, look, x, top, w, h, mine);
  p.font(15);
  lines.forEach((line, i) => p.text(line, x + PAD_X, top + PAD_Y + i * LINE + 3, p.pal.text));
  return h;
}

/** 卡片式气泡（慢信、链接、聊天记录）：标题行 + 正文 + 底部来源。 */
function cardBubble(
  p: Painter,
  look: ChatLook,
  parts: { head?: string; title?: string; body: string; bodyLines?: number; foot?: string },
  edge: number,
  top: number,
  mine: boolean,
) {
  const inner = look.textMax;
  const w = inner + PAD_X * 2;
  const x = mine ? edge - w : edge;
  let h = PAD_Y + 2;
  p.font(15, 600);
  const titleLines = parts.title ? p.clamp(parts.title, inner, 2) : [];
  p.font(parts.title ? 13 : 15);
  const bodyLines = parts.bodyLines
    ? p.clamp(parts.body, inner, parts.bodyLines)
    : p.wrap(parts.body, inner);
  const bodyLine = parts.title ? 19 : LINE;
  if (parts.head) h += 18 + 8;
  h += titleLines.length * LINE + (titleLines.length ? 4 : 0);
  h += bodyLines.length * bodyLine;
  if (parts.foot) h += 8 + 18;
  h += PAD_Y;
  bubbleShape(p, look, x, top, w, h, mine);
  let y = top + PAD_Y + 2;
  if (parts.head) {
    p.font(12, 500);
    p.text(parts.head, x + PAD_X, y + 2, p.pal.secondary);
    y += 18;
    p.line(x + PAD_X, y + 3.5, x + w - PAD_X, p.pal.hairline);
    y += 8;
  }
  p.font(15, 600);
  titleLines.forEach((line, i) => p.text(line, x + PAD_X, y + i * LINE + 3, p.pal.text));
  y += titleLines.length * LINE + (titleLines.length ? 4 : 0);
  p.font(parts.title ? 13 : 15);
  bodyLines.forEach((line, i) =>
    p.text(line, x + PAD_X, y + i * bodyLine + 2, parts.title ? p.pal.secondary : p.pal.text),
  );
  y += bodyLines.length * bodyLine;
  if (parts.foot) {
    y += 8;
    p.line(x + PAD_X, y - 3, x + w - PAD_X, p.pal.hairline);
    p.font(11);
    p.text(parts.foot, x + PAD_X, y + 3, p.pal.secondary);
  }
  return h;
}

function voiceBubble(
  p: Painter,
  look: ChatLook,
  content: Extract<ReceivedMessageContent, { type: 'voice' }>,
  edge: number,
  top: number,
  mine: boolean,
) {
  const sec = Math.max(1, Math.round(content.durationMs / 1000));
  const w = Math.min(look.textMax + PAD_X * 2, 72 + Math.min(sec, 60) * 2.4);
  const h = LINE + PAD_Y * 2;
  const x = mine ? edge - w : edge;
  bubbleShape(p, look, x, top, w, h, mine);
  // 声波图标：三段弧，朝向对方（我方朝左、对方朝右）。
  const iconX = mine ? x + w - PAD_X - 4 : x + PAD_X + 4;
  const dir = mine ? -1 : 1;
  const cy = top + h / 2;
  if (!p.dry) {
    const { ctx } = p;
    ctx.strokeStyle = p.pal.text;
    ctx.fillStyle = p.pal.text;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(iconX - dir * 2, cy, 1.6, 0, Math.PI * 2);
    ctx.fill();
    for (const r of [5.5, 9.5]) {
      ctx.beginPath();
      const start = dir > 0 ? -Math.PI / 4 : (Math.PI * 3) / 4;
      ctx.arc(iconX - dir * 2, cy, r, start, start + Math.PI / 2);
      ctx.stroke();
    }
  }
  p.font(15);
  const label = `${sec}″`;
  p.text(
    label,
    mine ? iconX - 16 : iconX + 16,
    top + PAD_Y + 3,
    p.pal.text,
    mine ? 'right' : 'left',
  );
  let height = h;
  if (content.transcript) {
    // 转写文字：气泡下方同色小框（微信「转文字」样式）。
    p.font(14);
    const lines = p.wrap(content.transcript, look.textMax);
    const tw = Math.max(...lines.map((l) => p.width(l))) + PAD_X * 2;
    const th = lines.length * 20 + 14;
    const tx = mine ? edge - tw : edge;
    const ty = top + h + 6;
    p.rect(
      tx,
      ty,
      tw,
      th,
      look.bubbleRadius,
      mine ? look.mineBg : look.otherBg,
      (!mine && look.otherBorder) || undefined,
    );
    p.font(14);
    lines.forEach((line, i) => p.text(line, tx + PAD_X, ty + 7 + i * 20 + 2, p.pal.text));
    height += 6 + th;
  }
  return height;
}

/** 画一条消息的内容块（不含头像），返回高度。 */
function messageBlock(
  p: Painter,
  look: ChatLook,
  item: ShareRenderItem,
  edge: number,
  top: number,
) {
  const { content, mine } = item;
  switch (content.type) {
    case 'image':
    case 'sticker': {
      const size = pictureSize(item, 140);
      const x = mine ? edge - size.w : edge;
      if (item.image) p.image(item.image, x, top, size.w, size.h, look.pictureRadius);
      else p.placeholder(x, top, size.w, size.h, look.pictureRadius);
      return size.h;
    }
    case 'voice':
      return voiceBubble(p, look, content, edge, top, mine);
    case 'letter':
      return cardBubble(p, look, { head: '慢信', body: content.body }, edge, top, mine);
    case 'link':
      return cardBubble(
        p,
        look,
        {
          title: content.title,
          body: content.description ?? '',
          bodyLines: 2,
          foot: content.source ?? '链接',
        },
        edge,
        top,
        mine,
      );
    case 'forwarded_record':
      return cardBubble(
        p,
        look,
        {
          title: content.title,
          body: content.items
            .slice(0, 4)
            .map((i) => `${i.senderName}：${shareText(i.content).replace(/\n/g, ' ')}`)
            .join('\n'),
          bodyLines: 4,
          foot: '聊天记录',
        },
        edge,
        top,
        mine,
      );
    default:
      return textBubble(p, look, shareText(content), edge, top, mine);
  }
}

/** 居中的灰色小字行（时间、拍一拍等），返回占用高度。 */
function centerNote(p: Painter, text: string, y: number) {
  p.font(12);
  const lines = p.clamp(text, W - 64, 2);
  lines.forEach((line, i) => p.text(line, W / 2, y + i * 17, p.pal.secondary, 'center'));
  return lines.length * 17;
}

function drawChat(p: Painter, input: ShareRenderInput, look: ChatLook, startY: number) {
  let y = startY;
  input.items.forEach((item, index) => {
    const previous = input.items[index - 1];
    if (input.showTime && needsTime(item, previous)) {
      y += 2 + centerNote(p, timeText(item.createdAt, previous?.createdAt), y + 2) + 12;
    }
    const person = personOf(input, item);
    if (item.content.type === 'nudge') {
      const target = item.content.targetKind === 'user' ? '我' : '';
      y += centerNote(p, `${person.name} 拍了拍${target}${item.content.suffix ?? ''}`, y) + 14;
      return;
    }
    const avatarX = item.mine ? W - look.side - look.avatar : look.side;
    p.avatar(person, avatarX, y, look.avatar, look.avatarRadius);
    let top = y;
    if (input.group && !item.mine) {
      p.font(12);
      p.text(person.name, avatarX + look.avatar + 10, y, p.pal.secondary);
      top += 18;
    }
    const edge = item.mine ? avatarX - 10 : avatarX + look.avatar + 10;
    const block = messageBlock(p, look, item, edge, top);
    y = Math.max(y + look.avatar, top + block) + 16;
  });
  return y;
}

// ---------- A 微信原样 ----------

function wechatTemplate(p: Painter, input: ShareRenderInput, height: number) {
  const { pal } = p;
  p.rect(0, 0, W, height, 0, pal.chatBg);
  p.font(17, 600);
  const title = p.clamp(input.title, W - 64, 1)[0] ?? '';
  p.text(title, W / 2, 15, pal.text, 'center');
  p.line(0, 48, W, pal.hairline);
  return drawChat(
    p,
    input,
    {
      side: 12,
      avatar: 40,
      avatarRadius: 4,
      bubbleRadius: 4,
      tail: true,
      mineBg: pal.chatMine,
      otherBg: pal.chatOther,
      otherBorder: null,
      pictureRadius: 4,
      textMax: 226,
    },
    64,
  );
}

// ---------- B 柔和信纸 ----------

function paperTemplate(p: Painter, input: ShareRenderInput, height: number) {
  const { pal } = p;
  p.rect(0, 0, W, height, 0, pal.paperBg);
  const lead = leadPerson(input);
  p.avatar(lead, 24, 28, 48, 8);
  p.font(18, 600);
  p.text(p.clamp(input.title, W - 84 - 24, 1)[0] ?? '', 84, 31, pal.text);
  p.font(12);
  const date = lastDate(input);
  const sub = input.group
    ? `群聊 · ${date}`
    : input.daysKnown
      ? `认识第 ${input.daysKnown} 天 · ${date}`
      : date;
  p.text(sub, 84, 57, pal.secondary);
  let y = 100;
  const excerptItem = input.excerpt === null ? undefined : input.items[input.excerpt];
  const excerpt = excerptText(excerptItem);
  if (excerptItem && excerpt) {
    p.font(48, 400, pal.serif);
    p.text('“', 18, y - 8, pal.paperQuote);
    p.font(20, 400, pal.serif);
    const lines = p.clamp(excerpt, W - 48, 5);
    const top = y + 20;
    lines.forEach((line, i) => p.text(line, 24, top + i * 34 + 7, pal.text));
    y = top + lines.length * 34 + 6;
    p.font(13);
    p.text(`— ${personOf(input, excerptItem).name}`, W - 24, y, pal.secondary, 'right');
    y += 18 + 20;
  }
  p.rect(24, y, W - 48, 1, 0, pal.paperBorder);
  y += 20;
  return drawChat(
    p,
    input,
    {
      side: 16,
      avatar: 32,
      avatarRadius: 6,
      bubbleRadius: 12,
      tail: false,
      mineBg: pal.paperMine,
      otherBg: pal.paperOther,
      otherBorder: pal.paperBorder,
      pictureRadius: 8,
      textMax: 212,
    },
    y,
  );
}

// ---------- C 卡片海报 ----------

function posterTemplate(p: Painter, input: ShareRenderInput, height: number) {
  const { pal } = p;
  p.rect(0, 0, W, height, 0, pal.posterBg);
  const lead = leadPerson(input);
  const face = { x: 16, y: 16, w: W - 32, h: Math.round(((W - 32) * 3) / 4) };
  if (input.card?.face) p.image(input.card.face, face.x, face.y, face.w, face.h, 12);
  else {
    // 无卡面：角色头像 + 由头像底色调淡的柔和色底（不再画蓝色占位块）。
    p.rect(face.x, face.y, face.w, face.h, 12, lead.background || pal.meAvatarBg);
    p.rect(face.x, face.y, face.w, face.h, 12, 'rgba(255, 255, 255, 0.8)');
    p.avatar(lead, W / 2 - 44, face.y + face.h / 2 - 44, 88, 12);
  }
  if (input.card) {
    p.font(12, 600);
    const badge = `No.${String(input.card.serialNo).padStart(3, '0')}`;
    const bw = p.width(badge) + 20;
    p.rect(face.x + 12, face.y + 12, bw, 24, 12, pal.badgeBg);
    p.text(badge, face.x + 12 + bw / 2, face.y + 12 + 6, pal.badgeText, 'center');
  }
  let y = face.y + face.h + 20;
  const excerptItem = input.excerpt === null ? undefined : input.items[input.excerpt];
  const title = input.card?.title ?? lead.name;
  const line = input.card ? input.card.line : excerptText(excerptItem);
  p.font(20, 600);
  const titleLines = p.clamp(title, W - 48, 2);
  titleLines.forEach((l, i) => p.text(l, 24, y + i * 28 + 2, pal.text));
  y += titleLines.length * 28 + 8;
  if (line) {
    p.font(17, 400, pal.serif);
    const lines = p.clamp(line, W - 48, 5);
    lines.forEach((l, i) => p.text(l, 24, y + i * 30 + 6, pal.text));
    y += lines.length * 30 + 6;
  }
  p.font(12);
  const meta = input.card
    ? `${lead.name} · ${input.card.obtainedOn.replaceAll('-', '.')} 获得`
    : `${lead.name} · ${lastDate(input)}`;
  p.text(meta, 24, y + 2, pal.secondary);
  return y + 18 + 24;
}

// ---------- 底部品牌栏（三套共用，不可删除 / 关闭） ----------

let qrCache: boolean[][] | null = null;
function qrModules() {
  return (qrCache ??= QrCode.encodeText(SHARE_DOWNLOAD_URL, Ecc.MEDIUM).getModules());
}

function drawLogo(p: Painter, x: number, y: number, size: number, logo: HTMLImageElement | null) {
  if (logo) return p.image(logo, x, y, size, size, 8);
  // 图标没加载出来：绿底 + 白色小熊脸（简化版）。
  p.rect(x, y, size, size, 8, p.pal.logo);
  if (p.dry) return;
  const { ctx } = p;
  const cx = x + size / 2;
  const cy = y + size * 0.56;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(cx - size * 0.24, cy - size * 0.26, size * 0.08, 0, Math.PI * 2);
  ctx.arc(cx + size * 0.24, cy - size * 0.26, size * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy, size * 0.3, size * 0.27, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 品牌栏第二行：含真人固定「非本人，请谨慎识别」；否则单聊「和 X 认识第 N 天」；群聊 / 无天数省略。 */
export function footerRelation(
  input: Pick<ShareRenderInput, 'label' | 'group' | 'daysKnown' | 'title'>,
) {
  if (input.label === 'weiban_not_real_person') return '非本人，请谨慎识别';
  if (!input.group && input.daysKnown) return `和 ${input.title} 认识第 ${input.daysKnown} 天`;
  return null;
}

function drawFooter(p: Painter, input: ShareRenderInput, top: number) {
  const { pal } = p;
  p.rect(0, top, W, FOOTER_HEIGHT, 0, pal.footerBg);
  p.line(0, top, W, pal.hairline);
  drawLogo(p, 16, top + 24, 36, input.logo);
  const qrSize = 50;
  const qrX = W - 16 - qrSize;
  const textX = 62;
  const textMax = qrX - 12 - textX;
  const relation = footerRelation(input);
  p.font(15, 600);
  p.text('微伴AI聊天', textX, relation ? top + 23 : top + 33, pal.text);
  if (relation) {
    const real = input.label === 'weiban_not_real_person';
    p.font(12, real ? 500 : 400);
    let shown = relation;
    if (!real && p.width(shown) > textMax) {
      // 名字太长：只截名字，「认识第 N 天」保留。
      const tail = ` 认识第 ${input.daysKnown} 天`;
      let name = input.title;
      while (name && p.width(`和 ${name}…${tail}`) > textMax)
        name = Array.from(name).slice(0, -1).join('');
      shown = `和 ${name}…${tail}`;
    }
    p.text(shown, textX, top + 46, pal.secondary);
  }
  // 二维码：本地生成，指向官网下载页；模块对齐到导出像素（×3）避免发虚。
  const modules = qrModules();
  const unit = Math.floor((qrSize / modules.length) * SHARE_SCALE) / SHARE_SCALE;
  const size = unit * modules.length;
  const qx = qrX + (qrSize - size) / 2;
  const qy = top + 10 + (qrSize - size) / 2;
  if (!p.dry) {
    const { ctx } = p;
    ctx.fillStyle = pal.qr;
    ctx.beginPath();
    modules.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) ctx.rect(qx + x * unit, qy + y * unit, unit, unit);
      }),
    );
    ctx.fill();
  }
  p.font(11);
  p.text('扫码下载', qrX + qrSize / 2, top + 64, pal.secondary, 'center');
}

// ---------- 入口 ----------

function layout(p: Painter, input: ShareRenderInput, height: number): number {
  switch (input.style) {
    case 'poster':
      return posterTemplate(p, input, height);
    case 'paper':
      return paperTemplate(p, input, height);
    default:
      return wechatTemplate(p, input, height);
  }
}

export function renderShareImage(input: ShareRenderInput): HTMLCanvasElement {
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('canvas unavailable');
  const content = Math.ceil(layout(new Painter(measure, true), input, 0));
  // 品牌栏接在内容下方，不压任何内容；A / B 最小 480 高，C 随内容。
  const height =
    input.style === 'poster'
      ? content + FOOTER_HEIGHT
      : Math.max(MIN_HEIGHT, content + FOOTER_HEIGHT);
  const canvas = document.createElement('canvas');
  canvas.width = W * SHARE_SCALE;
  canvas.height = height * SHARE_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.scale(SHARE_SCALE, SHARE_SCALE);
  const painter = new Painter(ctx, false);
  layout(painter, input, height);
  drawFooter(painter, input, height - FOOTER_HEIGHT);
  return canvas;
}

/** 导出：PNG；超过 4MB 改 JPEG（质量 92）。画布被跨域图片污染时抛错。 */
export async function exportShareImage(canvas: HTMLCanvasElement): Promise<Blob> {
  const toBlob = (type: string, quality?: number) =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('export failed'))),
        type,
        quality,
      ),
    );
  const png = await toBlob('image/png');
  if (png.size <= 4 * 1024 * 1024) return png;
  return toBlob('image/jpeg', 0.92);
}

export function loadImage(url: string | null | undefined, timeoutMs = 5000) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    if (!url) return resolve(null);
    // 本机 Vite 已代理 /api；画布必须同源读取签名媒体，不能靠放宽服务器 CORS。
    let imageUrl = url;
    if (import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      const local = new URL(url, window.location.href);
      if (
        local.origin === 'http://127.0.0.1:3000' &&
        /^\/api\/v1\/media\/[0-9a-f-]+\/content$/.test(local.pathname)
      )
        imageUrl = local.pathname + local.search;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    img.src = imageUrl;
  });
}
