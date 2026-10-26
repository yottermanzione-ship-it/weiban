/**
 * 旧角色卡（旧库 `characters_v2` 整行 JSON）读取器。
 *
 * **旧卡就是运行格式。** 新服务器原样保存 `characters_v2` 的一整行，运行时不把它转成
 * `WeibanCardData`，提示词、群聊、朋友圈、开场白、音色都直接读这里的旧字段。
 * 字段名保持旧库原样（snake_case），不做改名；没有的字段按调用方给的默认值处理。
 *
 * 放在 contracts 包是因为 characters（读取与存储）、ai-runtime（提示词）和导入器
 * 都要读同一份旧格式；服务器模块边界 R1 不允许跨模块引用 domain 内部文件。
 */

import { z } from 'zod';

/** `characters_v2` 的一整行。保留全部旧列，不认识的列也原样带着。 */
export type LegacyCardRow = Record<string, unknown>;

/** 旧库 `character_lorebook_entries` 的一行（只取运行时要用的字段）。 */
export interface LegacyKnowledgeEntry {
  id: string;
  /** 旧表没有 title 列；行里有就带上。 */
  title: string;
  keys: string[];
  secondaryKeys: string[];
  constant: boolean;
  priority: number;
  content: string;
}

/** 旧库 `character_example_dialogues` 的一行（只取运行时要用的字段）。 */
export interface LegacyDialogueExample {
  id: string;
  scene: string;
  userText: string;
  assistantText: string;
  sortOrder: number;
}

/** 旧卡里的群聊设定（`group_chat_json`），缺省值由运行时补。 */
export interface LegacyGroupProfile {
  /** 群聊风格原文；没有就是空串。 */
  style: string;
  /** 0–100；旧卡没写时默认 50。 */
  talkativeness: number;
  /** 爱好/日常话题，`、` 连接；没有就是空串。 */
  hobbies: string;
  /** 起群名时的风格补充；没有就是空串。 */
  nameStyle: string;
}

/** 旧卡里的朋友圈设定（`moment_profile_json`），缺省值由运行时补。 */
export interface LegacyMomentProfile {
  tone: string;
  topics: string[];
  commentStyle: string;
  /** 每周发几条；旧卡没写时为 null，由调用方用自己的默认值。 */
  frequencyPerWeek: [number, number] | null;
}

function recordOf(value: unknown): LegacyCardRow | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as LegacyCardRow)
    : null;
}

/** 宽松 JSON：字段本身可能是已解析的数组/对象，也可能是旧库里的 JSON 字符串。 */
function jsonOf(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return null;
  if (!/^[[{"]/u.test(text)) return value;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function stringListOf(value: unknown): string[] {
  const parsed = jsonOf(value);
  if (Array.isArray(parsed))
    return parsed.map((item) => textOf(item)).filter((item) => item.length > 0);
  const text = textOf(parsed);
  if (!text) return [];
  // 旧库里也有用逗号/顿号连起来存的字段。
  return text
    .split(/[,，、\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberOf(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(textOf(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function boolOf(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function pick(row: LegacyCardRow, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function frequencyOf(value: unknown): [number, number] | null {
  const parsed = jsonOf(value);
  if (Array.isArray(parsed) && parsed.length >= 2) {
    const min = numberOf(parsed[0]);
    const max = numberOf(parsed[1]);
    return min === null || max === null ? null : [min, max];
  }
  const record = recordOf(parsed);
  if (record) {
    const min = numberOf(pick(record, ['min', 'from', 'minimum']));
    const max = numberOf(pick(record, ['max', 'to', 'maximum']));
    return min === null || max === null ? null : [min, max];
  }
  const single = numberOf(parsed);
  return single === null ? null : [single, single];
}

function talkativenessOf(value: unknown): number {
  const numeric = numberOf(jsonOf(value));
  if (numeric !== null) return Math.max(0, Math.min(100, Math.round(numeric)));
  const word = textOf(value).toLowerCase();
  if (['low', 'rare', 'quiet', '少'].includes(word)) return 30;
  if (['high', 'often', 'active', '多'].includes(word)) return 70;
  return 50;
}

/**
 * 旧卡访问器。构造时只持有原始行，不做字段改名、不补 WeibanCardData 字段。
 * 取值一律容错：旧库不同版本存过 JSON 字符串、数组、对象混用。
 */
export class LegacyCharacterCard {
  private constructor(private readonly row: LegacyCardRow) {}

  /** 解析一个 jsonb 值；不是对象时返回 null（空值 / 坏值都不伪装成旧卡）。 */
  static from(value: unknown): LegacyCharacterCard | null {
    const record = recordOf(jsonOf(value));
    return record && Object.keys(record).length > 0 ? new LegacyCharacterCard(record) : null;
  }

  /** 原样行：导入、调试、审计用。 */
  get raw(): LegacyCardRow {
    return this.row;
  }

  private text(...keys: string[]): string {
    return textOf(pick(this.row, keys));
  }

  private json(...keys: string[]): unknown {
    return jsonOf(pick(this.row, keys));
  }

  private list(...keys: string[]): string[] {
    return stringListOf(pick(this.row, keys));
  }

  // ---------- 身份 / 广场展示 ----------

  get id(): string {
    return this.text('id');
  }

  get displayName(): string {
    return this.text('display_name', 'displayName', 'name');
  }

  get nickname(): string {
    return this.text('nickname');
  }

  get canonicalName(): string {
    return this.text('canonical_name', 'canonicalName');
  }

  /** `aliases_json` 原样别名；昵称另走 `nickname`，不混进来。 */
  get aliases(): string[] {
    return this.list('aliases_json', 'aliases');
  }

  get signature(): string {
    return this.text('signature', 'bio', 'sign');
  }

  /** 明确的微博资料；已有微博昵称直接视为有标记，显式关闭优先。不拿角色头像冒充微博头像。 */
  get weiboProfile(): { enabled: boolean; nickname: string; avatarUrl?: string; userId?: string } {
    const saved = recordOf(this.json('weibo_profile_json'));
    const nickname = textOf(saved?.nickname ?? this.row.weibo_nickname).slice(0, 80);
    const enabled =
      nickname.length > 0 && (saved?.enabled === undefined ? true : boolOf(saved.enabled));
    const rawAvatar = textOf(saved?.avatarUrl ?? this.row.weibo_avatar_url);
    const parsedAvatar = z.string().url().max(2000).safeParse(rawAvatar);
    // contracts 的公共类型检查不依赖 DOM/Node URL；使用已有Zod校验并排除凭据地址。
    const avatarUrl =
      parsedAvatar.success &&
      /^https:\/\//u.test(rawAvatar) &&
      !/^https:\/\/[^/]*@/u.test(rawAvatar)
        ? parsedAvatar.data
        : undefined;
    const rawId = textOf(saved?.userId ?? pick(this.row, ['weibo_user_id', 'weibo_uid']));
    return {
      enabled,
      nickname,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(/^\d{5,20}$/u.test(rawId) ? { userId: rawId } : {}),
    };
  }

  get identityType(): string {
    return this.text('identity_type', 'identityType');
  }

  get identityGender(): string {
    return this.text('identity_gender', 'gender');
  }

  get identityBirthday(): string {
    return this.text('identity_birthday', 'birthday');
  }

  get identityJson(): unknown {
    return this.json('identity_json', 'identity');
  }

  // ---------- 人设 ----------

  /** 旧卡的核心人设原文；运行时的「你是谁」主体。 */
  get corePersona(): string {
    return this.text('core_persona', 'corePersona');
  }

  get soulPersonality(): string {
    return this.text('soul_personality');
  }

  get soulEmotionalTone(): string {
    return this.text('soul_emotional_tone');
  }

  get soulRelationshipMode(): string {
    return this.text('soul_relationship_mode');
  }

  get relationshipMode(): string {
    return this.text('relationship_mode');
  }

  // ---------- 说话风格 ----------

  get speakingStyle(): string {
    return this.text('speaking_style');
  }

  get styleChatStyle(): string {
    return this.text('style_chat_style');
  }

  get styleEmojiLevel(): string {
    return this.text('style_emoji_level');
  }

  /** `style_avoid_json`：不用的词 / 避免的表达，原样取出。 */
  get styleAvoid(): string[] {
    return this.list('style_avoid_json', 'styleAvoid');
  }

  // ---------- 旧卡附属 JSON ----------

  /** `knowledge_json`；老数据里为空，真正知识在世界书表。 */
  get knowledgeJson(): unknown {
    return this.json('knowledge_json');
  }

  /** `opening_messages_json`：字符串数组；也兼容 `[{ text }]`。 */
  get openingMessages(): string[] {
    const parsed = this.json('opening_messages_json', 'openingMessages');
    const list = Array.isArray(parsed) ? parsed : parsed === null ? [] : [parsed];
    return list
      .map((item) => {
        const record = recordOf(item);
        return record ? textOf(pick(record, ['text', 'content', 'message'])) : textOf(item);
      })
      .filter(Boolean);
  }

  get groupChatJson(): unknown {
    return this.json('group_chat_json', 'groupChat');
  }

  get momentProfileJson(): unknown {
    return this.json('moment_profile_json', 'momentProfile');
  }

  get voiceJson(): unknown {
    return this.json('voice_json', 'voice');
  }

  get qwenVoiceId(): string {
    return this.text('qwen_voice_id', 'qwenVoiceId');
  }

  /** 旧卡里可用的音色标识（千问优先，其次 voice_json 里的常见字段）。 */
  get voiceIds(): string[] {
    const ids = [this.qwenVoiceId];
    const voice = recordOf(this.voiceJson);
    if (voice) {
      for (const key of [
        'qwen_voice_id',
        'qwenVoiceId',
        'voice_id',
        'voiceId',
        'id',
        'provider_voice_id',
        'providerVoiceId',
      ]) {
        const value = textOf(voice[key]);
        if (value) ids.push(value);
      }
    }
    ids.push(this.text('cartesia_voice_id', 'mimo_voice_id'));
    return [...new Set(ids.filter(Boolean))];
  }

  // ---------- 派生视图（字段缺省时给运行时可用的默认值） ----------

  get groupChat(): LegacyGroupProfile {
    const group = recordOf(this.groupChatJson);
    if (!group) return { style: '', talkativeness: 50, hobbies: '', nameStyle: '' };
    return {
      style: textOf(
        pick(group, [
          'group_style',
          'groupStyle',
          'group_chat_style',
          'style',
          'chat_style',
          'chatStyle',
          'description',
        ]),
      ),
      talkativeness: talkativenessOf(
        pick(group, ['talkativeness', 'activity', 'frequency', 'reply_frequency']),
      ),
      hobbies: stringListOf(pick(group, ['hobbies', 'topics', 'interests', 'likes'])).join('、'),
      nameStyle: textOf(
        pick(group, [
          'group_name_style',
          'groupNameStyle',
          'name_style',
          'nameStyle',
          'naming_style',
        ]),
      ),
    };
  }

  get momentProfile(): LegacyMomentProfile {
    const moment = recordOf(this.momentProfileJson);
    if (!moment)
      return {
        tone: '自然、生活化',
        topics: [],
        commentStyle: '自然',
        frequencyPerWeek: null,
      };
    return {
      tone:
        textOf(pick(moment, ['tone', 'style', 'mood', 'voice', 'moment_tone', 'post_style'])) ||
        '自然、生活化',
      topics: stringListOf(
        pick(moment, ['topics', 'themes', 'themes_json', 'subjects', 'content_topics']),
      ),
      commentStyle:
        textOf(pick(moment, ['comment_style', 'commentStyle', 'reply_style', 'comment_tone'])) ||
        '自然',
      frequencyPerWeek: frequencyOf(
        pick(moment, [
          'frequency_per_week',
          'frequencyPerWeek',
          'per_week',
          'perWeek',
          'posts_per_week',
        ]),
      ),
    };
  }
}

/** 读旧卡；不是对象时返回 null。函数形式便于纯函数调用方。 */
export function parseLegacyCard(value: unknown): LegacyCharacterCard | null {
  return LegacyCharacterCard.from(value);
}

/**
 * 旧库 `character_lorebook_entries` 行 → 运行时条目。原样保留 id / keys / content / priority，
 * 不做分类归并（旧卡知识就是旧表的内容）。
 */
export function legacyKnowledgeEntries(rows: readonly unknown[]): LegacyKnowledgeEntry[] {
  const entries: LegacyKnowledgeEntry[] = [];
  for (const row of rows) {
    const record = recordOf(jsonOf(row));
    if (!record) continue;
    if (record.enabled === false || record.enabled === 0 || record.enabled === '0') continue;
    const id = textOf(record.id);
    const content = textOf(record.content);
    if (!id || !content) continue;
    entries.push({
      id,
      title: textOf(record.title),
      keys: stringListOf(pick(record, ['trigger_keys_json', 'trigger_keys', 'keys_json', 'keys'])),
      secondaryKeys: stringListOf(
        pick(record, ['secondary_keys_json', 'secondary_keys', 'secondaryKeys']),
      ),
      constant:
        boolOf(record.constant) || boolOf(record.is_constant) || boolOf(record.always) || false,
      priority: numberOf(record.priority) ?? 0,
      content,
    });
  }
  return entries;
}

/** 旧库 `character_example_dialogues` 行 → 运行时示例；按 sort_order 稳定排序。 */
export function legacyDialogueExamples(rows: readonly unknown[]): LegacyDialogueExample[] {
  const examples: LegacyDialogueExample[] = [];
  for (const row of rows) {
    const record = recordOf(jsonOf(row));
    if (!record) continue;
    const id = textOf(record.id);
    const userText = textOf(pick(record, ['user_text', 'userText', 'user']));
    const assistantText = textOf(pick(record, ['assistant_text', 'assistantText', 'assistant']));
    if (!id || (!userText && !assistantText)) continue;
    examples.push({
      id,
      scene: textOf(record.scene),
      userText,
      assistantText,
      sortOrder: numberOf(record.sort_order ?? record.sortOrder) ?? 0,
    });
  }
  return examples.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}
