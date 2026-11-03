/**
 * 聊天里附带媒体（表情包、照片）的硬规则（纯函数）。提示词阶段与发送阶段共用同一套：
 * 提示词里说「这轮可以配」，发送时再按同样的规则复核一遍。
 * 私密 / 成人、涉及健康、树洞、关怀由调用方先挡掉；这里只看聊天记录本身。
 *
 * - T-20261103d：表情包（每 10 条角色气泡软上限 3 个、不连发、20 条内不重复同一张）。
 * - T-20261103g：照片（每 20 条角色消息软上限 2 张、不连发、这个用户收到过的不再发）；
 *   群聊表情包（只数这个角色自己的消息；同一轮已有角色带过表情，别人这轮不再配）。
 */
import type { Message } from '@weiban/contracts';
import { P02_SPLIT_BUBBLES } from '../../../platform/index.js';
import { detectFormSuppressions } from './chat-form-suppression.js';

/**
 * 表情包软上限（安全阀，不是目标）：每 10 条角色气泡最多 3 个。
 * T-20261103d 按任务卡从 MED-01 原文的 2 个放宽到 3 个（PRD MED-01 第 4 条已同步）。群聊每个角色同样。
 */
export const STICKER_WINDOW = 10;
export const STICKER_MAX_IN_WINDOW = 3;
/** 保底：连续这么多条角色消息没带表情包，提示词里提醒一句「可以配个表情」（不是服务端硬塞）。 */
export const STICKER_NUDGE_AFTER = 9;
/** T-20261103g：照片软上限，每 20 条角色消息最多 2 张。 */
export const PHOTO_WINDOW = 20;
export const PHOTO_MAX_IN_WINDOW = 2;

/** 会话里最近的角色消息（日常范围、未撤回），升序；群聊传 participantId 只取这个角色自己的。 */
export function characterMessages(history: readonly Message[], participantId?: string): Message[] {
  return history.filter(
    (m) =>
      m.senderKind === 'character' &&
      m.status === 'normal' &&
      m.scope === 'normal' &&
      (participantId === undefined || m.senderParticipantId === participantId),
  );
}

/**
 * 会话压制用的用户原话：最近 30 条用户原话 + 本轮原话（本轮原话在最后，后说的覆盖先说的）。
 * 用户在聊天里明确说过不喜欢某一种形式，就不发那一种；后来明确要了就恢复。
 */
export function recentUserTexts(history: readonly Message[], userText: string): string[] {
  return [
    ...history
      .filter((m) => m.senderKind === 'user')
      .slice(-30)
      .map((m) =>
        m.content?.type === 'text'
          ? m.content.text
          : m.content?.type === 'voice'
            ? (m.content.transcript ?? '')
            : '',
      ),
    userText,
  ];
}

/**
 * 窗口名额：本轮要发 contentCount 条内容（媒体本身之前的条数）时，这种媒体还剩几个名额。
 * 窗口 = 之前的 (window - contentCount - 1) 条 + 本轮 contentCount 条 + 媒体本身。
 */
function windowQuota(
  mine: readonly Message[],
  isMedia: (m: Message) => boolean,
  window: number,
  max: number,
): (contentCount: number) => number {
  return (contentCount) => {
    const previousCount = Math.max(0, window - contentCount - 1);
    const previous = previousCount ? mine.slice(-previousCount) : [];
    return max - previous.filter(isMedia).length;
  };
}

const isSticker = (m: Message) => m.content?.type === 'sticker';
const isImage = (m: Message) => m.content?.type === 'image';

/**
 * 表情包硬规则（T-20261103d；T-20261103g 起群聊也用）：
 * - 用户说过不要表情包就不发（suppressedForms）；
 * - 不连发：这个角色的上一条消息是表情包，这轮不配；
 * - 软上限：这个角色每 10 条气泡最多 3 个；
 * - 20 条内不重复同一张（excludedIds；群聊按全群算，别的角色刚发过的也不发）；
 * - 群聊（roundAfterSeq = 触发消息的序号）：这一轮已经有角色带过表情包，别人这轮不再配；
 * - sinceLast：上次表情包之后连续几条角色消息没带（保底提醒用，数到 STICKER_NUDGE_AFTER 为止）。
 */
export function stickerRoom(
  history: readonly Message[],
  userText: string,
  opts: { participantId?: string; roundAfterSeq?: number } = {},
) {
  const mine = characterMessages(history, opts.participantId);
  const everyone = characterMessages(history);
  const suppressed = detectFormSuppressions(recentUserTexts(history, userText)).suppressed.has(
    'sticker',
  );
  const quota = windowQuota(mine, isSticker, STICKER_WINDOW, STICKER_MAX_IN_WINDOW);
  const excludedIds = new Set(
    everyone
      .filter(isSticker)
      .slice(-20)
      .flatMap((m) => (m.content?.type === 'sticker' ? [m.content.stickerId] : [])),
  );
  const roundTaken =
    opts.roundAfterSeq !== undefined &&
    everyone.some((m) => m.seq > opts.roundAfterSeq! && isSticker(m));
  let sinceLast = 0;
  for (let i = mine.length - 1; i >= 0 && sinceLast < STICKER_NUDGE_AFTER; i--) {
    if (isSticker(mine[i]!)) break;
    sinceLast++;
  }
  return {
    suppressed,
    excludedIds,
    sinceLast,
    roundTaken,
    quota,
    /**
     * 本轮 contentCount 条内容之后还能不能再附一个表情。附上后不能超过 P-02 总上限
     * （T-20261103h 起 8 条，6 条文字 + 表情 = 7 条照常能配；原先写死 6，文字放宽到 6 条后会一个都配不上）。
     */
    open: (contentCount: number) =>
      !suppressed &&
      !roundTaken &&
      contentCount < P02_SPLIT_BUBBLES.maxTotalBubbles &&
      mine.at(-1)?.content?.type !== 'sticker' &&
      Math.min(quota(contentCount), quota(1)) > 0,
  };
}

/**
 * 照片硬规则（T-20261103g，私聊）：
 * - 用户说过不要图片 / 照片就不发（suppressedForms 的 photo）；
 * - 不连发：上一条角色消息是图片，这轮不发；
 * - 软上限：每 20 条角色消息最多 2 张（角色发的所有图片都算）；
 * - received：聊天记录里角色已经发过的图，不再发同一张（更早的由图片描述存档补上，见 ChatPhotoService）。
 */
export function photoRoom(history: readonly Message[], userText: string) {
  const mine = characterMessages(history);
  const suppressed = detectFormSuppressions(recentUserTexts(history, userText)).suppressed.has(
    'photo',
  );
  const quota = windowQuota(mine, isImage, PHOTO_WINDOW, PHOTO_MAX_IN_WINDOW);
  const received = new Set(
    history.flatMap((m) =>
      m.senderKind === 'character' && m.content?.type === 'image' ? [m.content.mediaId] : [],
    ),
  );
  return {
    suppressed,
    received,
    quota,
    /** 本轮 contentCount 条内容之后还能不能再附一张照片（附上后不超过 P-02 总上限，同表情包）。 */
    open: (contentCount: number) =>
      !suppressed &&
      contentCount < P02_SPLIT_BUBBLES.maxTotalBubbles &&
      mine.at(-1)?.content?.type !== 'image' &&
      Math.min(quota(contentCount), quota(1)) > 0,
  };
}
