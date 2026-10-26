/**
 * 运行时角色视图（application 层）。
 *
 * 新卡角色读 `WeibanCardData`；旧卡角色（`legacy_card`）**直接读旧字段**，
 * 这里不构造、也不映射 `WeibanCardData`——旧卡就是运行格式。
 * 只把两种来源收敛成调用方要的几段文本/数值，避免每个调用点各写一遍分支。
 */
import type {
  CharacterForRuntime,
  LegacyCharacterCard,
  LegacyDialogueExample,
  LegacyGroupProfile,
  LegacyKnowledgeEntry,
  WeibanCardData,
} from '@weiban/contracts';
import { parseLegacyCard } from '@weiban/contracts';
import {
  LEGACY_CARE_FALLBACK,
  LEGACY_DEFLECT,
  legacyPersonaSpeechText,
} from '../domain/legacy-prompt.js';

export interface CharacterView {
  /** 新卡角色为卡片正文；旧卡角色为 null。 */
  card: WeibanCardData | null;
  /** 旧卡角色为旧卡访问器；新卡角色为 null。 */
  legacy: LegacyCharacterCard | null;
  /** 旧卡角色的旧库世界书（新卡角色为空）。 */
  lorebook: LegacyKnowledgeEntry[];
  /** 旧卡角色的旧库示例对话（新卡角色为空）。 */
  examples: LegacyDialogueExample[];
}

/** P16 朋友圈默认频率（与 moments-ai 的默认值一致，避免两处口径漂移）。 */
const DEFAULT_MOMENTS_PER_WEEK: [number, number] = [2, 4];

export function characterView(
  role: Pick<CharacterForRuntime, 'card' | 'legacyCard'>,
  context?: { lorebook?: LegacyKnowledgeEntry[]; examples?: LegacyDialogueExample[] } | null,
): CharacterView {
  return {
    card: role.card?.data ?? null,
    legacy: role.legacyCard ? parseLegacyCard(role.legacyCard) : null,
    lorebook: context?.lorebook ?? [],
    examples: context?.examples ?? [],
  };
}

/** 运行时朋友圈配置：旧卡没写频率时已经补上默认值，所以这里不是 null。 */
export interface RoleMoments {
  tone: string;
  topics: string[];
  commentStyle: string;
  frequencyPerWeek: [number, number];
}

/** 朋友圈文风 / 主题 / 评论风格；旧卡读 moment_profile_json。 */
export function roleMoments(view: CharacterView): RoleMoments {
  if (view.card) {
    const moments = view.card.social.moments;
    return {
      tone: moments.tone,
      topics: moments.topics ?? [],
      commentStyle: moments.commentStyle ?? '自然',
      frequencyPerWeek: moments.frequencyPerWeek ?? DEFAULT_MOMENTS_PER_WEEK,
    };
  }
  const legacy = view.legacy?.momentProfile ?? {
    tone: '自然、生活化',
    topics: [],
    commentStyle: '自然',
    frequencyPerWeek: null,
  };
  return {
    ...legacy,
    frequencyPerWeek: legacy.frequencyPerWeek ?? DEFAULT_MOMENTS_PER_WEEK,
  };
}

/** 群聊风格；旧卡读 group_chat_json。 */
export function roleGroup(view: CharacterView): LegacyGroupProfile {
  if (view.card) {
    const social = view.card.social;
    return {
      style: social.groupStyle ?? '',
      talkativeness: social.talkativeness,
      hobbies: view.card.simulation.hobbies.join('、'),
      nameStyle: social.groupStyle ?? '',
    };
  }
  return view.legacy?.groupChat ?? { style: '', talkativeness: 50, hobbies: '', nameStyle: '' };
}

/** 角色可用音色：新卡 social.voiceId；旧卡 voice_json / qwen_voice_id。 */
export function roleVoiceIds(view: CharacterView): string[] {
  if (view.card) return view.card.social.voiceId ? [view.card.social.voiceId] : [];
  return view.legacy?.voiceIds ?? [];
}

/** 关怀兜底话术；旧卡没有安全风格字段，用代码层兜底。 */
export function roleCareFallback(view: CharacterView): string {
  return view.card?.safetyStyle.careFallbackText ?? LEGACY_CARE_FALLBACK;
}

/** 岔开话题话术；旧卡没有安全风格字段，用代码层兜底。 */
export function roleDeflect(view: CharacterView, fallback = LEGACY_DEFLECT): string {
  return view.card?.safetyStyle.deflectStyle ?? fallback;
}

/** 输出检查用的性格标签；旧卡没有这个字段，返回空数组。 */
export function rolePersonaTags(view: CharacterView): string[] {
  return view.card?.persona.personaTags ?? [];
}

/** 错别字风格；旧卡没有这个字段，按 none 处理。 */
export function roleTypoStyle(view: CharacterView): string {
  return view.card?.speech.typoStyle ?? 'none';
}

/** 情景模式白名单；旧卡没有这个字段，返回空数组。 */
export function roleAdminAllowlist(view: CharacterView): string[] {
  return view.card?.modes.adminAllowlist ?? [];
}

/** 人设 + 说话风格的短文本（群聊、通话、朋友圈、识图等较小的提示用）。 */
export function rolePersonaSpeechText(view: CharacterView, max = 6000): string {
  if (view.card)
    return JSON.stringify({ persona: view.card.persona, speech: view.card.speech }).slice(0, max);
  return view.legacy ? legacyPersonaSpeechText(view.legacy, max) : '';
}

/** 明确的微博资料；迁入角色已有微博昵称也能参与，显式关闭优先。 */
export function roleWeiboMarker(
  view: CharacterView,
): { nickname: string; avatarUrl?: string; userId?: string } | null {
  if (view.card) return view.card.profileExtra.weibo ?? null;
  const profile = view.legacy?.weiboProfile;
  return profile?.enabled && profile.nickname ? profile : null;
}
