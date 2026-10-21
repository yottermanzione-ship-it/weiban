/**
 * H3（契约 3.29，任务卡 docs/tasks/2026-10-21-gm-feedback-4.md 批 H3，方案 docs/refactor/22-image-understanding.md）：
 * 图片描述存档的纯规则。
 *
 * 用户发图时，聊天模型直接看图回复（所有聊天模型都是多模态），**同一次调用**在回复正文之后顺带输出一段
 * 简短的结构化图片描述（尾标 <图片描述>…</图片描述>，用户看不到，不额外调用模型）。描述加密存档，
 * 之后的私聊上下文、记忆抽取、摘要、群聊、生态、朋友圈评论都用这段描述，不再只说「发过一张图片」。
 *
 * 这里只放：尾标提示词、解析与剥离、描述的几种文字写法、能否进记忆的判断。不碰数据库。
 */
import { z } from 'zod';
import { healthPrivate } from './memory.js';

export const CAPTION_TEMPLATE = 'image-caption-v1';
/** 一次调用最多附几张图（多出来的这一轮不看，写「另外还有 N 张图」）。 */
export const CAPTION_MAX_IMAGES = 4;
/** 描述、图中文字的存档上限。 */
const DESCRIPTION_MAX = 300;
const TEXT_MAX = 120;

export const CAPTION_KINDS = [
  'selfie',
  'photo',
  'food',
  'pet',
  'scenery',
  'screenshot',
  'meme',
  'document',
  'health',
  'magazine',
  'other',
] as const;
export type CaptionKind = (typeof CAPTION_KINDS)[number];

const KIND_LABEL: Record<CaptionKind, string> = {
  selfie: '自拍',
  photo: '生活照',
  food: '食物',
  pet: '宠物',
  scenery: '风景',
  screenshot: '截图',
  meme: '表情包',
  document: '文档',
  health: '健康类图片',
  magazine: '杂志 / 海报 / 剧照',
  other: '图片',
};

export const ImageCaption = z.object({
  kind: z.enum(CAPTION_KINDS).catch('other'),
  description: z.string().max(DESCRIPTION_MAX),
  textInImage: z.string().max(TEXT_MAX).default(''),
  /** 认出的人（存档时已按当时的认人名单过滤；读取时只用来判断「图里有你自己」）。 */
  people: z.array(z.string().max(40)).max(10).default([]),
});
export type ImageCaption = z.infer<typeof ImageCaption>;

/** 本轮附给模型看的一张图（尾标里按 n 对应）。 */
export interface ImageSlot {
  n: number;
  mediaId: string;
  ownerUserId: string;
  /** 图片所在的消息（转发记录里的图记外层消息）；朋友圈图片没有消息。 */
  messageId: string | null;
  /** 用户自己的表情（不是从表情库发的）：描述当作表情含义。 */
  sticker: boolean;
}

const OPEN = '<图片描述>';
const CLOSE = '</图片描述>';

/**
 * 动态结尾里的本轮看图要求 + 尾标格式。只在本轮有附图时出现（稳定开头不变，不影响前缀缓存）。
 * allowed：认人名单（本人 + 有公开关系的人）；scope = normal 时描述不写露骨细节。
 */
export function captionInstruction(
  slots: readonly ImageSlot[],
  opts: { allowed: readonly string[] | null; scope: 'normal' | 'adult'; skipped?: number },
): string {
  if (!slots.length) return '';
  const names = slots.map((s) => `图${s.n}`).join('、');
  return [
    `【这一轮的图片】对方这轮发来 ${slots.length} 张图（${names}），图附在对应的消息里（文字里用〔图N〕标出），你能直接看到。${
      opts.skipped ? `另外还有 ${opts.skipped} 张这次没附上，不要猜它们的内容。` : ''
    }按人设自然回应画面本身：`,
    '- 表情包 / 梗图：这是表情动作，不是要你分析的照片，按它表达的情绪回应；',
    '- 聊天截图：是对方转述别人的话，不是对方本人说的；',
    '- 自拍：可以夸、可以关心，不评论身材，不性化；图里有儿童：不作任何与外貌有关的亲密评价；',
    '- 病历、检查单、经期记录等健康类：可以关心，不追问细节；',
    opts.scope === 'normal'
      ? '- 不适合日常聊天的裸露 / 色情画面：不描述，按关怀口吻岔开；'
      : '- 看不清或打不开的图：不要猜，可以自然地问问是什么；',
    `回复正文写完后，另起一行输出图片存档（这是平台存档格式，对方看不到，是本轮唯一允许的例外格式）：`,
    `${OPEN}[{"n":1,"kind":"photo","description":"不超过100字的客观描述，多写以后能接话的细节","text":"图中清晰可见的文字，没有就留空","people":[]}]${CLOSE}`,
    `每张图一项。kind 只能是：selfie 自拍、photo 生活照、food 食物、pet 宠物、scenery 风景、screenshot 截图、meme 表情包或梗图、document 证件文档、health 病历检查单经期等健康类、magazine 杂志海报剧照周边、other 其他。`,
    `people 只能填这些名字里非常确定的人：${JSON.stringify(opts.allowed ?? [])}；名单外的人只写外观，不说出或猜测身份。${
      opts.scope === 'normal'
        ? '描述不写露骨细节（这类画面只写「画面含不适合日常聊天的内容」）。'
        : ''
    }`,
    '【图片存档要求结束】',
  ].join('\n');
}

/** 去掉回复里所有图片存档尾标（含没写完的尾标、包着它的代码块），只留给用户看的正文。 */
export function stripCaptionTail(text: string): string {
  return splitCaptionTail(text, 0).reply;
}

/**
 * 把模型输出拆成「给用户看的正文」和「每张图的描述」（按 n 对应，下标 0 = 图1；解析不到的为 null）。
 * 容错：尾标没闭合、包在 ``` 代码块里、JSON 用了一个对象而不是数组；只有一张图且不是 JSON 时把整段当描述。
 */
export function splitCaptionTail(
  text: string,
  slotCount: number,
): { reply: string; captions: (ImageCaption | null)[] } {
  const captions: (ImageCaption | null)[] = Array.from({ length: slotCount }, () => null);
  const inner: string[] = [];
  let reply = '';
  let rest = text;
  for (;;) {
    const at = rest.indexOf(OPEN);
    if (at < 0) {
      reply += rest;
      break;
    }
    reply += rest.slice(0, at);
    const after = rest.slice(at + OPEN.length);
    const end = after.indexOf(CLOSE);
    inner.push(end < 0 ? after : after.slice(0, end));
    rest = end < 0 ? '' : after.slice(end + CLOSE.length);
  }
  reply = reply
    .split(CLOSE)
    .join('')
    .replace(/```[a-z]*\s*```/giu, '')
    .replace(/\n?```[a-z]*\s*$/iu, '')
    .trim();
  for (const block of inner) {
    const items = parseItems(block);
    if (items) {
      items.forEach((item, index) => {
        const n = typeof item.n === 'number' && Number.isInteger(item.n) ? item.n : index + 1;
        if (n < 1 || n > slotCount || captions[n - 1]) return;
        captions[n - 1] = normalize(item);
      });
    } else if (slotCount === 1 && !captions[0]) {
      const plain = block
        .replace(/```[a-z]*/giu, '')
        .trim()
        .slice(0, DESCRIPTION_MAX);
      // 截断或畸形的 JSON 不是图片描述，不能作为纯文字兜底写入存档。
      if (plain && !['[', ']', '{', '}'].some((char) => plain.includes(char)))
        captions[0] = { kind: 'other', description: plain, textInImage: '', people: [] };
    }
  }
  return { reply, captions };
}

interface RawItem {
  n?: unknown;
  kind?: unknown;
  description?: unknown;
  text?: unknown;
  textInImage?: unknown;
  people?: unknown;
}

function parseItems(block: string): RawItem[] | null {
  const body = block.replace(/```[a-z]*/giu, '').trim();
  const starts = [body.indexOf('['), body.indexOf('{')].filter((i) => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const end = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'));
  if (end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)
      ? (raw as { items: unknown[] }).items
      : raw && typeof raw === 'object'
        ? [raw]
        : null;
  if (!list) return null;
  return list.filter((i): i is RawItem => !!i && typeof i === 'object');
}

function normalize(item: RawItem): ImageCaption | null {
  const description =
    typeof item.description === 'string' ? item.description.trim().slice(0, DESCRIPTION_MAX) : '';
  if (!description) return null;
  const textRaw =
    typeof item.text === 'string'
      ? item.text
      : typeof item.textInImage === 'string'
        ? item.textInImage
        : '';
  const kind = (CAPTION_KINDS as readonly string[]).includes(item.kind as string)
    ? (item.kind as CaptionKind)
    : 'other';
  return {
    kind,
    description,
    textInImage: textRaw.trim().slice(0, TEXT_MAX),
    people: (Array.isArray(item.people) ? item.people : [])
      .filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length <= 40)
      .slice(0, 10),
  };
}

/** 存档前：认出的人只留名单里的（名单外的一律丢掉）。 */
export function filterPeople(caption: ImageCaption, allowed: readonly string[]): ImageCaption {
  return { ...caption, people: caption.people.filter((p) => allowed.includes(p)) };
}

/** 描述正文（不带前缀）：「（生活照）……；图中文字：……」。 */
export function captionPhrase(c: ImageCaption): string {
  const label = c.kind === 'other' ? '' : `（${KIND_LABEL[c.kind]}）`;
  return `${label}${c.description}${c.textInImage ? `；图中文字：${c.textInImage}` : ''}`;
}

/** 表情包 / 梗图：按表情的方式交给角色（学旧版：是表情动作，不是要分析的照片）。 */
export function isMeme(c: ImageCaption, sticker = false): boolean {
  return sticker || c.kind === 'meme';
}

/**
 * 私聊上下文里的一行（对方发的图）。fresh = 本轮刚发（已经有存档，例如重试或同一张图再发），否则是历史。
 * selfNames：角色本人名字与别名（存档里认出本人时提示「图里有你自己」；其他人名不在历史里复述）。
 */
export function captionLine(
  c: ImageCaption,
  opts: { fresh: boolean; sticker?: boolean; selfNames?: readonly string[] },
): string {
  if (isMeme(c, opts.sticker))
    return `[对方发了一个表情包：${c.description}。这是表情动作，按它表达的情绪理解]`;
  const self = opts.selfNames?.some((n) => c.people.includes(n)) ? '图里有你自己。' : '';
  return `[对方${opts.fresh ? '发来' : '之前发过'}一张图片：${captionPhrase(c)}${self ? `。${self}` : ''}]`;
}

/** 离线资料（群聊记录、记忆抽取、摘要、生态、转发记录）里的写法，不带「对方」视角。 */
export function captionSnapshot(c: ImageCaption, sticker = false): string {
  return isMeme(c, sticker) ? `[表情包：${c.description}]` : `[图片：${captionPhrase(c)}]`;
}

/** 能不能进记忆：健康类（经期报告、病历、检查单）一律不进（沿用健康隐私规则）。 */
export function captionForMemory(c: ImageCaption): boolean {
  return c.kind !== 'health' && !healthPrivate(`${c.description} ${c.textInImage}`);
}

/** 看不到图时（模型缺识图能力、读不到图片）给模型的说法。 */
export const BLIND_IMAGE_LINE =
  '[对方发来一张图片，但你看不到图片内容；不要描述或猜测图片里有什么，可以自然地问问是什么]';
export const BLIND_STICKER_LINE = '[对方发了一个表情]';
