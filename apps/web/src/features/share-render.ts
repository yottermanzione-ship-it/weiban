import type { ReceivedMessageContent, ShareTemplate } from '@weiban/contracts';
import tokens from '../../../../docs/design/tokens.json';

/*
 * 分享图画布绘制（share-templates.md 第 2～4 节）。
 * 以 360 逻辑像素宽排版、放大 3 倍导出 1080 宽。所有颜色、字体都取自设计令牌 tokens.json：
 * 四套模板固定浅色，不跟随用户主题；「聊天原样」固定用 theme.pink.light。
 */

type Node = Record<string, unknown>;
export function lookup(path: string, depth = 0): string {
  let node: unknown = tokens;
  for (const part of path.split('.')) node = (node as Node | undefined)?.[part];
  const value = (node as { $value?: unknown } | undefined)?.$value ?? node;
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}') && depth < 8)
    return lookup(value.slice(1, -1), depth + 1);
  return String(value);
}
const c = (name: string) => lookup(`primitive.color.${name}`);
const pinkTheme = (name: string) => lookup(`theme.pink.light.color.${name}`);
const share = (name: string) => lookup(`share.${name}`);
const sans = lookup('typography.fontFamily.sans');
const serif = lookup('typography.fontFamily.serif');
const relaxed = Number(lookup('typography.lineHeight.relaxed'));
const normal = Number(lookup('typography.lineHeight.normal'));

export const SHARE_WIDTH = 360;
export const SHARE_SCALE = 3;
const MIN_HEIGHT = 480;

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
  template: ShareTemplate;
  label: 'weiban' | 'weiban_not_real_person';
  items: ShareRenderItem[];
  people: Record<string, SharePerson>;
  me: SharePerson;
  title: string;
  group: boolean;
  daysKnown: number | null;
  showTime: boolean;
  card: ShareRenderCard | null;
}

// ---------- 画笔：dry = true 时只量尺寸不画 ----------

class Painter {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly dry: boolean,
  ) {}
  font(size: number, weight = 400, family = sans) {
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
        if (line && this.width(line + ch) > max) {
          lines.push(line);
          line = ch;
        } else line += ch;
      }
      lines.push(line);
    }
    return lines;
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
    fill: string | CanvasGradient | null,
    stroke?: string,
    lineWidth = 1,
    dash?: number[],
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
      ctx.setLineDash(dash ?? []);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      ctx.setLineDash([]);
    }
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
  avatar(person: SharePerson, x: number, y: number, size: number, radiusRatio = 0.12) {
    const radius = size * radiusRatio;
    this.rect(x, y, size, size, radius, person.background);
    if (person.image) this.image(person.image, x, y, size, size, radius);
    else {
      this.font(size * (Array.from(person.letters).length === 1 ? 0.44 : 0.34), 600);
      if (this.dry) return;
      this.ctx.textBaseline = 'middle';
      this.ctx.textAlign = 'center';
      this.ctx.fillStyle = person.foreground;
      this.ctx.fillText(person.letters, x + size / 2, y + size / 2);
    }
  }
  star(cx: number, cy: number, r: number, color: string) {
    if (this.dry) return;
    const { ctx } = this;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? r : r * 0.45;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx[i === 0 ? 'moveTo' : 'lineTo'](
        cx + radius * Math.cos(angle),
        cy + radius * Math.sin(angle),
      );
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
  placeholder(x: number, y: number, w: number, h: number, radius: number) {
    this.rect(x, y, w, h, radius, c('gray.150'));
    this.star(x + w / 2, y + h / 2, 8, c('gray.400'));
  }
}

// ---------- 微伴贴纸（第 3 节） ----------

/** 微伴 logo（brand.md 第 7 节：对话气泡 + 星星），高 20。 */
function drawLogo(p: Painter, x: number, y: number, ink: boolean) {
  if (p.dry) return;
  const { ctx } = p;
  const s = 20 / 98;
  const bubble = ink ? share('stickerInkText') : share('logo');
  const starColor = ink ? share('stickerInkBg') : share('stickerBg');
  ctx.save();
  ctx.translate(x - 43 * s, y - 48 * s);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(43, 48);
  ctx.lineTo(149, 48);
  ctx.lineTo(149, 124);
  ctx.lineTo(89, 124);
  ctx.lineTo(59, 146);
  ctx.lineTo(59, 124);
  ctx.lineTo(43, 124);
  ctx.closePath();
  ctx.fillStyle = bubble;
  ctx.fill();
  ctx.restore();
  p.star(x + 54 * s, y + 38 * s, 22 * s, starColor);
}

function stickerSize(p: Painter, label: ShareRenderInput['label']) {
  p.font(14, 700);
  const main = p.width('微伴AI聊天');
  p.font(12, 500);
  const sub = label === 'weiban_not_real_person' ? p.width('非本人，请谨慎识别') : 0;
  const textHeight = label === 'weiban_not_real_person' ? 18 + 2 + 16 : 18;
  return { w: 12 + 20 + 8 + Math.max(main, sub) + 12, h: 8 + Math.max(20, textHeight) + 8 };
}

/** 画贴纸：以 (right, bottom) 为右下角锚点，angle 为角度。 */
function drawSticker(
  p: Painter,
  label: ShareRenderInput['label'],
  anchor: { x: number; y: number; from: 'right' | 'left' },
  variant: 'pink' | 'ink',
  radius: 'full' | 'md',
  angle: number,
) {
  const { w, h } = stickerSize(p, label);
  if (p.dry) return { w, h };
  const { ctx } = p;
  const left = anchor.from === 'right' ? anchor.x - w : anchor.x;
  const top = anchor.y - h;
  ctx.save();
  ctx.translate(left + w / 2, top + h / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  const ink = variant === 'ink';
  p.rect(
    0,
    0,
    w,
    h,
    radius === 'full' ? h / 2 : 12,
    ink ? share('stickerInkBg') : share('stickerBg'),
    ink ? undefined : share('stickerBorder'),
    1.5,
  );
  drawLogo(p, 12, (h - 20) / 2, ink);
  const textTop = label === 'weiban_not_real_person' ? 8 : (h - 18) / 2;
  p.font(14, 700);
  p.text('微伴AI聊天', 40, textTop, ink ? share('stickerInkText') : share('stickerText'));
  if (label === 'weiban_not_real_person') {
    p.font(12, 500);
    p.text(
      '非本人，请谨慎识别',
      40,
      textTop + 20,
      ink ? share('stickerInkText') : share('stickerSubText'),
    );
  }
  ctx.restore();
  // 贴纸外角的小星星（不压文字）。
  if (!ink) p.star(left + w + 2, top - 2, 4, c('pink.400'));
  return { w, h };
}

// ---------- 内容转文字 ----------

function seconds(ms: number) {
  return `${Math.max(1, Math.round(ms / 1000))}″`;
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
    case 'nudge':
      return '拍了拍';
    case 'action_card':
      return content.text;
    case 'image':
      return '[图片]';
    case 'sticker':
      return '[表情]';
    default:
      return '[消息]';
  }
}
const isPicture = (content: ReceivedMessageContent) =>
  content.type === 'image' || content.type === 'sticker';

function pictureSize(item: ShareRenderItem, longSide: number) {
  if (item.content.type === 'sticker') return { w: 80, h: 80 };
  const width =
    (item.content.type === 'image' && item.content.width) || item.image?.naturalWidth || 4;
  const height =
    (item.content.type === 'image' && item.content.height) || item.image?.naturalHeight || 3;
  const scale = longSide / Math.max(width, height);
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
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

// ---------- 气泡类模板（粉色滤镜、聊天原样） ----------

function bubbleTemplate(p: Painter, input: ShareRenderInput, height: number, original: boolean) {
  const W = SHARE_WIDTH;
  const ink = c('neutral.ink');
  const gray = c('neutral.600');
  const sticker = stickerSize(p, input.label);
  if (!p.dry) {
    if (original) p.rect(0, 0, W, height, 0, pinkTheme('bg.chat'));
    else {
      const gradient = p.ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, c('pink.50'));
      gradient.addColorStop(0.5, c('pink.100'));
      gradient.addColorStop(1, c('lilac.100'));
      p.rect(0, 0, W, height, 0, gradient);
      // 稀疏小星星（最多 8 个，只在左右留白里）。
      for (let i = 0; i < 8; i++) {
        const y = 110 + ((height - 200) / 8) * i + (i % 3) * 9;
        if (y > height - sticker.h - 40) break;
        p.star(i % 2 ? W - 7 : 7, y, 3 + (i % 2), c('pink.400'));
      }
    }
  }
  let y: number;
  const first = input.items[0];
  if (original) {
    p.font(17, 600);
    p.text(input.title, W / 2, 13, ink, 'center');
    y = 56;
  } else {
    p.rect(16, 16, W - 32, 72, 16, 'rgba(255, 255, 255, 0.85)');
    const headPerson = first
      ? personOf(input, input.items.find((i) => !i.mine) ?? first)
      : input.me;
    p.avatar(headPerson, 28, 32, 40);
    p.font(17, 600);
    p.text(input.title, 80, 33, ink);
    p.font(11);
    const date = dateText(input.items.at(-1)?.createdAt ?? new Date().toISOString());
    p.text(input.daysKnown ? `认识第 ${input.daysKnown} 天 · ${date}` : date, 80, 58, gray);
    y = 104;
  }
  const avatar = original ? 40 : 32;
  const radius = original ? Number.parseFloat(lookup('radius.bubble')) : 14;
  const textMax = original ? Math.round(W * 0.7) - 24 : 224;
  input.items.forEach((item, index) => {
    const previous = input.items[index - 1];
    if (input.showTime && needsTime(item, previous)) {
      p.font(11);
      p.text(timeText(item.createdAt, previous?.createdAt), W / 2, y + 4, gray, 'center');
      y += 26;
    }
    const person = personOf(input, item);
    const avatarX = item.mine ? W - 16 - avatar : 16;
    p.avatar(person, avatarX, y, avatar);
    let top = y;
    if (input.group && !item.mine) {
      p.font(11);
      p.text(person.name, avatarX + avatar + 8, y, gray);
      top += 16;
    }
    const edge = item.mine ? avatarX - 8 : avatarX + avatar + 8;
    let blockHeight: number;
    if (isPicture(item.content)) {
      const size = pictureSize(item, original ? 140 : 140);
      const x = item.mine ? edge - size.w : edge;
      if (item.image) {
        p.image(item.image, x, top, size.w, size.h, original ? 4 : 14);
        if (!original && item.content.type === 'image')
          p.rect(x, top, size.w, size.h, 14, `${c('pink.200')}4D`);
      } else p.placeholder(x, top, size.w, size.h, 4);
      blockHeight = size.h;
    } else {
      const voice = item.content.type === 'voice' ? item.content : null;
      const body = voice ? `▶ ${seconds(voice.durationMs)}` : shareText(item.content);
      p.font(15);
      const lines = p.wrap(body, textMax);
      const lineHeight = Math.round(15 * normal);
      const w = Math.max(...lines.map((l) => p.width(l))) + 24;
      const h = lines.length * lineHeight + 20;
      const x = item.mine ? edge - w : edge;
      const selfBg = original ? pinkTheme('bubble.selfBg') : c('pink.200');
      const otherBg = original ? pinkTheme('bubble.otherBg') : c('neutral.0');
      const corners = item.mine
        ? [radius, original ? radius : 4, radius, radius]
        : [original ? radius : 4, radius, radius, radius];
      p.rect(
        x,
        top,
        w,
        h,
        corners,
        item.mine ? selfBg : otherBg,
        item.mine || original ? undefined : c('pink.200'),
      );
      if (original && !p.dry) {
        // 小尖角（components.md 4.1）。
        const tail = Number.parseFloat(lookup('size.bubbleTail'));
        const tx = item.mine ? x + w : x;
        const dir = item.mine ? 1 : -1;
        p.ctx.beginPath();
        p.ctx.moveTo(tx, top + 12);
        p.ctx.lineTo(tx + dir * tail, top + 12 + tail);
        p.ctx.lineTo(tx, top + 12 + tail * 2);
        p.ctx.closePath();
        p.ctx.fillStyle = item.mine ? selfBg : otherBg;
        p.ctx.fill();
      }
      p.font(15);
      lines.forEach((line, i) =>
        p.text(line, x + 12, top + 10 + i * lineHeight + (lineHeight - 15) / 2, ink),
      );
      blockHeight = h;
      if (voice?.transcript) {
        p.font(13);
        const tl = p.wrap(voice.transcript, textMax);
        tl.forEach((line, i) =>
          p.text(
            line,
            item.mine ? edge : edge,
            top + h + 4 + i * 18,
            gray,
            item.mine ? 'right' : 'left',
          ),
        );
        blockHeight += 4 + tl.length * 18;
      }
    }
    y = Math.max(y + avatar, top + blockHeight) + 12;
  });
  return y + sticker.h + 32;
}

// ---------- 简洁白底 ----------

function simpleTemplate(p: Painter, input: ShareRenderInput, height: number) {
  const W = SHARE_WIDTH;
  const ink = c('neutral.ink');
  const gray = c('neutral.600');
  const sticker = stickerSize(p, input.label);
  p.rect(0, 0, W, height, 0, c('neutral.0'));
  p.star(24, 24, 8, c('pink.500'));
  p.font(20, 600);
  p.text(`和 ${input.title} 的聊天`, 16, 40, ink);
  p.font(11);
  const from = input.items[0]?.createdAt;
  const to = input.items.at(-1)?.createdAt;
  if (from && to) {
    const a = dateText(from);
    const b = dateText(to);
    p.text(a === b ? a : `${a} – ${b}`, 16, 70, gray);
  }
  p.rect(16, 88, W - 32, 0.5, 0, c('gray.200'));
  let y = 104;
  const lineHeight = Math.round(15 * relaxed);
  input.items.forEach((item, index) => {
    const previous = input.items[index - 1];
    const sameSpeaker =
      previous && previous.mine === item.mine && previous.characterId === item.characterId;
    if (!sameSpeaker) {
      if (index > 0) y += 20 - 6;
      const person = personOf(input, item);
      p.avatar(person, 16, y, 20);
      p.font(13, 600);
      p.text(person.name, 44, y + 2, item.mine ? c('pink.700') : ink);
      if (input.showTime) {
        const nameWidth = p.width(person.name);
        p.font(11);
        p.text(timeText(item.createdAt), 44 + nameWidth + 8, y + 4, gray);
      }
      y += 26;
    } else if (input.showTime && needsTime(item, previous)) {
      p.font(11);
      p.text(timeText(item.createdAt, previous.createdAt), 44, y, gray);
      y += 18;
    }
    if (isPicture(item.content)) {
      const size = pictureSize(item, 120);
      if (item.image) p.image(item.image, 44, y, size.w, size.h, 4);
      else p.placeholder(44, y, size.w, size.h, 4);
      y += size.h;
    } else {
      p.font(15);
      const lines = p.wrap(shareText(item.content), W - 44 - 16);
      lines.forEach((line, i) => p.text(line, 44, y + i * lineHeight + (lineHeight - 15) / 2, ink));
      y += lines.length * lineHeight;
    }
    y += 6;
  });
  return y + sticker.h + 32;
}

// ---------- 卡片风（固定 360×480） ----------

function cardTemplate(p: Painter, input: ShareRenderInput) {
  const W = SHARE_WIDTH;
  const ink = c('neutral.ink');
  const gray = c('neutral.600');
  p.rect(0, 0, W, MIN_HEIGHT, 0, c('pink.100'));
  const paper = { x: 20, y: 28, w: 320, h: 424 };
  if (!p.dry) {
    p.ctx.save();
    p.ctx.shadowColor = 'rgba(0, 0, 0, 0.10)';
    p.ctx.shadowBlur = 12;
    p.ctx.shadowOffsetY = 4;
    p.rect(paper.x, paper.y, paper.w, paper.h, 12, c('neutral.25'));
    p.ctx.restore();
  }
  const characterId = input.card?.characterId ?? input.items.find((i) => !i.mine)?.characterId;
  const person = (characterId && input.people[characterId]) || input.me;
  // 邮票：头像 56 + 齿孔边框（素材到位前用虚线圆角框代替，7.5 节）。
  const stamp = { x: paper.x + paper.w - 16 - 56, y: paper.y + 16 };
  p.rect(stamp.x - 4, stamp.y - 4, 64, 64, 6, c('neutral.0'), c('pink.300'), 2, [3, 3]);
  p.avatar(person, stamp.x, stamp.y, 56, 0.06);
  // 邮戳：日期 + 认识第 N 天。
  const markR = 38;
  const mark = { x: stamp.x - 12 - markR, y: stamp.y + 28 };
  if (!p.dry) {
    p.ctx.beginPath();
    p.ctx.arc(mark.x, mark.y, markR, 0, Math.PI * 2);
    p.ctx.strokeStyle = c('pink.400');
    p.ctx.lineWidth = 1.5;
    p.ctx.stroke();
  }
  const markDate = input.card
    ? input.card.obtainedOn.replaceAll('-', '.')
    : dateText(input.items.at(-1)?.createdAt ?? new Date().toISOString());
  p.font(11, 600);
  p.text(markDate, mark.x, mark.y - (input.daysKnown ? 14 : 6), c('pink.600'), 'center');
  if (input.daysKnown) {
    p.font(11);
    p.text(`认识第${input.daysKnown}天`, mark.x, mark.y + 2, c('pink.600'), 'center');
  }
  const innerX = paper.x + 16;
  const innerW = paper.w - 32;
  if (input.card) {
    const face = { x: innerX, y: paper.y + 100, w: innerW, h: Math.round((innerW * 2) / 3) };
    if (input.card.face) p.image(input.card.face, face.x, face.y, face.w, face.h, 8);
    else {
      const tones: Record<string, string> = {
        anniversary: 'memorial',
        familiarity: 'familiarity',
        holiday: 'festival',
      };
      const color = lookup(`semantic.light.color.card.${tones[input.card.kind] ?? 'moment'}`);
      p.rect(face.x, face.y, face.w, face.h, 8, color);
      p.star(face.x + face.w / 2, face.y + face.h / 2, 18, c('neutral.0'));
    }
    p.font(17, 400, serif);
    const lines = p.wrap(input.card.line || input.card.title, innerW).slice(0, 2);
    lines.forEach((line, i) => p.text(line, W / 2, face.y + face.h + 16 + i * 30, ink, 'center'));
    p.font(13);
    p.text(
      `No.${String(input.card.serialNo).padStart(3, '0')} · ${input.card.title}`,
      W / 2,
      face.y + face.h + 16 + lines.length * 30 + 6,
      gray,
      'center',
    );
  } else {
    const text = input.items
      .slice(0, 3)
      .map((i) => shareText(i.content))
      .join('\n')
      .slice(0, 120);
    p.font(20, 400, serif);
    const lineHeight = 36;
    const lines = p.wrap(text, innerW).slice(0, 7);
    const top = paper.y + 100 + Math.max(0, (260 - lines.length * lineHeight) / 2);
    lines.forEach((line, i) =>
      p.text(line, W / 2, top + i * lineHeight + (lineHeight - 20) / 2, ink, 'center'),
    );
    p.font(15);
    p.text(`— ${person.name}`, paper.x + paper.w - 16, paper.y + 364, ink, 'right');
  }
  drawSticker(
    p,
    input.label,
    { x: innerX, y: paper.y + paper.h - 16, from: 'left' },
    'pink',
    'full',
    0,
  );
  return MIN_HEIGHT;
}

// ---------- 入口 ----------

function layout(p: Painter, input: ShareRenderInput, height: number): number {
  switch (input.template) {
    case 'card_style':
      return cardTemplate(p, input);
    case 'simple_white':
      return simpleTemplate(p, input, height);
    case 'chat_original':
      return bubbleTemplate(p, input, height, true);
    default:
      return bubbleTemplate(p, input, height, false);
  }
}

/** 卡片风内容上限（4.4）：最多 3 条、合计 120 字。 */
export function cardStyleOverflow(items: ShareRenderItem[]) {
  return items.length > 3 || items.reduce((n, i) => n + shareText(i.content).length, 0) > 120;
}

export function renderShareImage(input: ShareRenderInput): HTMLCanvasElement {
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('canvas unavailable');
  const height = Math.max(MIN_HEIGHT, Math.ceil(layout(new Painter(measure, true), input, 0)));
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_WIDTH * SHARE_SCALE;
  canvas.height = height * SHARE_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.scale(SHARE_SCALE, SHARE_SCALE);
  const painter = new Painter(ctx, false);
  layout(painter, input, height);
  if (input.template !== 'card_style') {
    // 贴纸在右下角内容区下方的留白里，距右、距底 16（3.2）。
    drawSticker(
      painter,
      input.label,
      { x: SHARE_WIDTH - 16, y: height - 16, from: 'right' },
      input.template === 'simple_white' ? 'ink' : 'pink',
      input.template === 'simple_white' ? 'md' : 'full',
      -4,
    );
  }
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
    img.src = url;
  });
}
