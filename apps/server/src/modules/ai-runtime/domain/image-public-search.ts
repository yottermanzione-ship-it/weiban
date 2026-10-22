import type { CharacterForRuntime, Message } from '@weiban/contracts';
import type { ImageCaption } from './image-caption.js';
import { healthPrivate } from './memory.js';

/** Hidden/cleared messages retain a normal status but their readable content is null. */
export function publicImageSource(message: Message | null, conversationId: string): boolean {
  return (
    !!message &&
    message.status === 'normal' &&
    !!message.content &&
    message.senderKind === 'user' &&
    message.conversationId === conversationId &&
    !(message.labels ?? []).includes('health')
  );
}

/** Query vocabulary comes from the published preset card, never from free OCR or user text. */
export function publicImageQuery(
  role: CharacterForRuntime,
  captions: readonly (ImageCaption | null)[],
) {
  if (
    role.profile.kind !== 'preset' ||
    role.classification.realPersonKind === 'private_person' ||
    !role.card.data.recognition.selfEnabled
  )
    return null;
  const works = role.card.data.recognition.selfPublicImages ?? [];
  for (const caption of captions) {
    if (
      !caption ||
      caption.kind !== 'magazine' ||
      healthPrivate(`${caption.description} ${caption.textInImage}`) ||
      /隐私|私密|裸|色情|证件|身份证|护照|电话|微信|住址|病历|检查单/u.test(
        `${caption.description} ${caption.textInImage}`,
      )
    )
      continue;
    // Only exact, visible public titles qualify. Faces, visual similarity and people[] never qualify.
    const publicWorks = works.filter(
      (w) => /^https:\/\//u.test(w.sourceUrl) && w.publisher.trim().length >= 2,
    );
    const work = publicWorks.find(
      (w) => w.title.trim().length >= 2 && caption.textInImage.includes(w.title.trim()),
    );
    // An unknown title must be explicitly quoted and paired with an already approved publisher visible in the image.
    const publisher = publicWorks.find((w) => caption.textInImage.includes(w.publisher.trim()));
    const quoted = caption.textInImage.match(/《([\p{L}\p{N} ·・：:—-]{2,48})》/u)?.[1];
    const chosen = work ?? (publisher && quoted ? { ...publisher, title: quoted, date: '' } : null);
    if (!chosen) continue;
    const words = [
      chosen.title.trim(),
      chosen.publisher.trim(),
      chosen.date.slice(0, 4),
      '作品 海报 公开资料',
    ];
    if (
      words
        .slice(0, 2)
        .some((s) => s.length > 80 || /[\r\n@:/\\]|\d{7,}|忽略|指令|提示词|ignore|prompt/iu.test(s))
    )
      continue;
    return { query: words.join(' ').slice(0, 128), count: 1 };
  }
  return null;
}

export function needsPublicFacts(text: string) {
  return /什么|哪[部年期个]|出处|来源|作品|海报|杂志|介绍|上映|发行|最新|最近|新作|what|which|when|source|latest/iu.test(
    text,
  );
}
