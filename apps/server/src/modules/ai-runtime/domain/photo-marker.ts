/**
 * T-20261103g：私聊里按素材分享照片（对照表 v3 第 12 项「分享图片：基础层，聊天里按素材自然出现」）。
 *
 * 做法沿用表情包（T-20261103d，sticker-marker.ts）：
 * - 角色有可分享的素材图（最近的微博素材里、这个用户还没收到过的图）时，提示词告诉模型这轮可以分享，
 *   附上那条微博的文字，让它知道图大概是什么（photoPromptText）；
 * - 模型想分享时在正文最后另起一行写「[照片]」，回复引擎 / 主动消息在拆条前用 takePhotoMarker 剥掉，
 *   再由 media-ai planExtras 复核硬规则后发出那张图；
 * - 用户看到的正文里绝不残留标记：「[图片]」「【照片】」「[分享照片]」「[photo]」，以及模型照着
 *   聊天记录学写的「[你发了一张图片：…]」一律剥掉。
 * 只发已入库、已审核的微博素材图，不生图、不找网图、不用风景图（选图见 application/chat-photo.ts）。
 */
import { z } from 'zod';
import type { ImageCaption } from './image-caption.js';
import { healthPrivate } from './memory.js';
import { outputAllowed } from './reply-rules.js';

/** 这轮提示里给模型的那张图（存进回复快照，发送时按它发；不是契约字段）。 */
export const PhotoOffer = z.object({
  mediaId: z.string().min(1).max(100),
  /** 出自哪条公开动态（public_updates.id）。 */
  updateId: z.string().min(1).max(100),
  /** 那条微博的文字摘录（已过日常范围规则）。 */
  excerpt: z.string().max(200),
  /** 原帖日期 YYYY-MM-DD；不知道为 null。 */
  publishedOn: z.string().max(20).nullable(),
});
export type PhotoOffer = z.infer<typeof PhotoOffer>;

/** 给模型看的微博摘录上限。 */
const EXCERPT_MAX = 80;

/** [照片]、【图片】、[分享照片]、[发张照片]、[照片:海边]、[photo]、[image]。 */
const MARKER =
  /[[【［]\s*(?:分享|发)?(?:一张|张)?(?:照片|图片|相片|photo|image)\s*(?:[:：][^\]】］\n]{0,60})?\s*[\]】］]/giu;
/** 模型照着聊天记录里自己发过的图（「[你发了一张图片：…]」）学着写的：只剥，不当成要发图。 */
const ECHO = /[[【［]\s*你(?:发了|分享了)(?:一张|张)?(?:图片|照片)(?:[:：][^\]】］\n]{0,400})?\s*[\]】］]/gu;

/** 正文只剩标记时补一句很短的话（绝不发空回复）；正常情况下提示词要求正文必须有文字。 */
const BARE = '给你看看这张';

export interface PhotoMarkerResult {
  /** 给用户看的正文（标记已剥掉）。 */
  text: string;
  /** 模型写了「[照片]」：想分享提示里那张图。 */
  photo: boolean;
}

/**
 * 剥掉正文里的照片标记。只有标记的行整行去掉，句中的标记就地去掉；没有任何标记时原样返回（一个字不改）。
 */
export function takePhotoMarker(text: string): PhotoMarkerResult {
  let photo = false;
  let marked = false;
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const withoutEcho = line.replace(ECHO, '');
    const stripped = withoutEcho.replace(MARKER, '');
    if (stripped !== withoutEcho) photo = true;
    if (stripped === line) {
      lines.push(line);
      continue;
    }
    marked = true;
    if (stripped.trim()) lines.push(stripped.replace(/[ \t]{2,}/g, ' ').trimEnd());
  }
  if (!marked) return { text, photo: false };
  const out = lines.join('\n').trim();
  return { text: out || (photo ? BARE : ''), photo };
}

/** 微博原文 → 给模型看的一句摘录（压掉换行和多余空白，超长截断）。 */
export function photoExcerpt(content: string): string {
  const flat = content.replace(/\s+/gu, ' ').trim();
  const chars = [...flat];
  return chars.length > EXCERPT_MAX ? `${chars.slice(0, EXCERPT_MAX).join('')}…` : flat;
}

/** 「2026-10-30」→「10月30日」；认不出返回 null。 */
function dateLabel(date: string | null): string | null {
  const m = date ? /^\d{4}-(\d{2})-(\d{2})/u.exec(date) : null;
  return m ? `${Number(m[1])}月${Number(m[2])}日` : null;
}

/** 素材文字能不能拿来分享：日常范围的违禁词规则、不涉及健康隐私。 */
export function photoMaterialAllowed(
  content: string,
  policy: { isMinor: boolean; isRealPerson: boolean; romanceAllowed: boolean },
): boolean {
  return content.trim().length >= 4 && !healthPrivate(content) && outputAllowed(content, policy, false);
}

/**
 * 提示词里的分享照片说明（动态结尾，每轮重算，不影响前缀缓存）。
 * withSticker：这轮也能配表情包时，提醒两样只选一样（同一轮最多一种媒体附加）。
 */
export function photoPromptText(opts: { offer: PhotoOffer; withSticker: boolean }): string {
  const day = dateLabel(opts.offer.publishedOn);
  return [
    '这轮可以分享一张你最近的照片，像真人聊天那样偶尔分享，不用每轮都发。',
    `这张照片是你${day ?? '最近'}发的微博里的配图，那条微博写的是：「${opts.offer.excerpt}」。你看不到照片本身，聊到它时只按这条微博说，不编造照片里的细节，也不说是刚拍的。`,
    '想分享时，在正文最后另起一行写 [照片]，系统会把这张照片跟在你的文字后面发出；这行标记对方看不到，不算括号动作。正文照常要有文字；和现在聊的话题不搭就不写。',
    opts.withSticker ? '这轮照片和表情包最多选一样，不要两个标记都写。' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 照片发出后存进图片描述存档的那段描述：之后聊天记录里显示「[你发了一张图片：微博配图（…）]」，
 * 角色接着聊时知道发的是哪条微博的图；这条存档也表示这个用户收到过这张图，不再重发。
 */
export function photoCaption(offer: PhotoOffer): ImageCaption {
  const day = dateLabel(offer.publishedOn);
  return {
    kind: 'other',
    description: `微博配图（${day ? `${day}的` : ''}微博：「${offer.excerpt}」）`.slice(0, 300),
    textInImage: '',
    people: [],
  };
}
