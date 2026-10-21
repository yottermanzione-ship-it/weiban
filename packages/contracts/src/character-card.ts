/** WB-Card 1.0（D-L0-10、ADR-0009）。分类事实独立于卡片，所有对象拒绝未知规则字段。 */
import { z } from 'zod';
import { Id, LocalDate, Timestamp } from './common.js';
export const CHARACTER_CARD_SCHEMA_VERSION = 1 as const;
const text = z.string().min(1).max(2000);
const optionalText = z.string().max(4000).optional();
const strings = z.array(z.string().max(500)).max(100);
export const PersonaTag = z.enum([
  'tsundere',
  'aloof',
  'shy',
  'gentle',
  'sharpTongue',
  'cheerful',
  'calm',
  'playful',
  'airhead',
  'mature',
]);
export const CardSource = z.strictObject({
  url: z.url(),
  title: z.string().max(200),
  accessedAt: z.union([LocalDate, Timestamp]),
});
export const CardPersona = z.strictObject({
  summary: z.string().min(1).max(600),
  background: optionalText,
  personality: text,
  values: optionalText,
  likes: strings.optional(),
  dislikes: strings.optional(),
  personaTags: z.array(PersonaTag).min(1).max(3),
  personaTagsCustom: strings.optional(),
  defaultAttitudeToUser: optionalText,
  growthByFamiliarity: z
    .strictObject({
      L1: optionalText,
      L2: optionalText,
      L3: optionalText,
      L4: optionalText,
      L5: optionalText,
    })
    .optional(),
  worldNote: optionalText,
});
export const CardSpeech = z.strictObject({
  selfReference: strings.min(1),
  addressUserDefault: optionalText,
  tone: text,
  sentenceLength: z.enum(['veryShort', 'short', 'medium', 'long']),
  catchphrases: strings.optional(),
  catchphraseFrequency: z.enum(['rare', 'sometimes', 'often']).optional(),
  emojiHabit: z.strictObject({
    frequency: z.enum(['none', 'rare', 'sometimes', 'often']),
    favorites: strings,
  }),
  punctuationHabit: optionalText,
  dialect: optionalText,
  typoStyle: z.enum(['pinyin', 'none']).optional(),
  forbiddenWords: strings.optional(),
  languageNotes: optionalText,
});
export const CardExample = z.strictObject({
  id: z.string().min(1).max(64),
  scene: z.enum([
    'greeting',
    'daily',
    'praised',
    'teased',
    'comfort',
    'refuseInCharacter',
    'deflectRumor',
    'workTalk',
    'lateNight',
    'group',
  ]),
  turns: z
    .array(z.strictObject({ role: z.enum(['user', 'char']), text }))
    .min(1)
    .max(8),
});
export const CardKnowledgeEntry = z.strictObject({
  id: z.string().min(1).max(64),
  title: z.string().max(200),
  category: z.enum([
    'work',
    'experience',
    'quote',
    'fandom',
    'trivia',
    'relationshipFact',
    'world',
  ]),
  keys: strings,
  secondaryKeys: strings.optional(),
  selective: z.boolean().optional(),
  content: z.string().min(1).max(300),
  constant: z.boolean().optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  validFrom: LocalDate.optional(),
  validTo: LocalDate.optional(),
  sources: z.array(CardSource).max(20).optional(),
  confidence: z.enum(['verified', 'singleSource', 'fictionCanon', 'userSource']),
  /** 3.7：这条被触发后，它的正文不再用来触发别的条目（世界书「防递归」）。 */
  preventRecursion: z.boolean().optional(),
});
export const CardKnowledge = z.strictObject({
  entries: z.array(CardKnowledgeEntry).max(500),
  unknownPolicy: text,
  /**
   * 3.7 世界书设置（docs/refactor/09-chat-pipeline.md 第 7.2 节），都可不填，用运行时默认值：
   * scanDepth = 扫描最近几条消息找关键词（默认 4）；constantBudget / triggeredBudget = 常驻条目 / 触发条目的字数上限
   * （默认 900 / 1200）；recursive = 触发条目的正文能否再触发别的条目（默认 true，只扩 1 层）。
   */
  scanDepth: z.number().int().min(1).max(20).optional(),
  constantBudget: z.number().int().min(0).max(4000).optional(),
  triggeredBudget: z.number().int().min(0).max(4000).optional(),
  recursive: z.boolean().optional(),
});
export const CardSimulation = z.strictObject({
  dailyActivities: strings.min(8),
  placeTypes: strings.min(1),
  hobbies: strings,
  workRhythm: optionalText,
  storylineSeeds: strings.optional(),
  forbiddenEventTopics: strings.optional(),
  moodBaseline: z.enum(['stable', 'expressive']).optional(),
  sharePreference: optionalText,
});
export const CardSocial = z.strictObject({
  talkativeness: z.number().int().min(0).max(100),
  groupStyle: optionalText,
  moments: z.strictObject({
    frequencyPerWeek: z.tuple([z.number().int().min(0).max(7), z.number().int().min(0).max(7)]),
    tone: text,
    imageSubjects: strings.optional(),
    commentStyle: optionalText,
  }),
  stickerPacks: strings.optional(),
  stickerRate: z.enum(['low', 'mid', 'high']).optional(),
  voiceId: z.string().max(64).optional(),
  proactiveStyle: optionalText,
  callStyle: optionalText,
});
export const CardRecognition = z.strictObject({
  selfEnabled: z.boolean(),
  selfPublicImages: z
    .array(
      z.strictObject({
        title: z.string().max(200),
        kind: z.enum(['magazine', 'poster', 'still', 'event']),
        date: LocalDate,
        publisher: z.string().max(200),
        visualCues: z.string().max(2000),
        sourceUrl: z.url(),
      }),
    )
    .max(50)
    .optional(),
  selfReferenceMediaIds: z.array(Id).max(50).optional(),
  appearanceCues: optionalText,
});
export const CardOpening = z.strictObject({
  firstMessageGuidance: optionalText,
  referralGreetingGuidance: optionalText,
});
export const CardModes = z.strictObject({
  adminAllowlist: z.array(z.string().min(1).max(64)).max(50),
  modeOverrides: z.record(z.string().max(64), z.string().max(2000)).optional(),
});
export const CardSafetyStyle = z.strictObject({
  deflectStyle: optionalText,
  refuseSelfieStyle: optionalText,
  careVoice: text,
  careFallbackText: z
    .string()
    .min(1)
    .max(2000)
    .refine(
      (value) =>
        ['12356', '110', '120'].every((number) => value.includes(number)) &&
        /信任|信得过/.test(value),
      '安全兜底必须提到信任的人、12356、110及120',
    ),
});
export const CardProfileExtra = z.strictObject({
  /** H4：两项齐备才视为明确微博标记，不从角色名字猜身份。 */
  weibo: z
    .strictObject({
      nickname: z.string().trim().min(1).max(80),
      avatarUrl: z
        .url()
        .max(2000)
        .refine((value) => /^https:\/\//iu.test(value), '微博头像地址须为 HTTPS'),
      userId: z
        .string()
        .regex(/^\d{5,20}$/u)
        .optional(),
    })
    .optional(),
  occupation: z.string().min(1).max(200),
  gender: z.enum(['female', 'male', 'other', 'unspecified']).optional(),
  ageDisplay: z.string().max(100).optional(),
  workSource: optionalText,
  fanNameUsage: optionalText,
  worksDetail: z
    .array(
      z.strictObject({
        title: z.string().max(200),
        type: z.string().max(64),
        year: z.union([z.number().int().min(-5000).max(5000), z.string().max(16)]),
        role: z.string().max(200),
      }),
    )
    .max(100)
    .optional(),
  searchKeywords: strings.optional(),
});
/**
 * 3.7：提示词写法（借鉴酒馆角色卡，docs/refactor/09-chat-pipeline.md 第 7.1 节）。全部可选，全部受平台规则约束：
 * 运行时把它们包在「角色作者的写作要求」里，并紧跟一句「与平台规则冲突时以平台规则为准」，不能替换平台守则。
 */
export const CardPrompting = z.strictObject({
  /** 角色作者的补充写作要求，放在稳定开头（角色资料之后）。 */
  systemNote: z.string().max(1500).optional(),
  /** 后置指令（酒馆 post_history_instructions）：每轮放在请求最末尾，模型最重视。 */
  postHistoryInstructions: z.string().max(1000).optional(),
  /** 角色笔记（酒馆 depth prompt）：插在聊天记录倒数第 depth 条消息之前（默认 4），提醒模型保持人设。 */
  characterNote: z
    .strictObject({
      text: z.string().min(1).max(1000),
      depth: z.number().int().min(1).max(20).optional(),
    })
    .optional(),
  /**
   * 示例对话保留策略：pinned = 固定几条常驻稳定开头（默认）；situational = 常驻 + 按情境（深夜、安慰、被逗等）
   * 在结尾补 1 条；off = 不发示例。exampleCount = 常驻条数（默认 6，0～12）。
   */
  exampleMode: z.enum(['pinned', 'situational', 'off']).optional(),
  exampleCount: z.number().int().min(0).max(12).optional(),
});

export const CardAdmin = z.strictObject({
  creatorNotes: optionalText,
  sourceList: z
    .array(CardSource.extend({ type: z.string().max(64) }).strict())
    .max(100)
    .optional(),
  creationMethod: z.enum(['distilled', 'manual', 'importedChat', 'importedSt']),
  importSource: z
    .strictObject({
      author: z.string().max(200).optional(),
      version: z.string().max(64).optional(),
      format: z.string().max(64).optional(),
    })
    .optional(),
  extensions: z.record(z.string().max(64), z.json()).optional(),
});
export const WeibanCardData = z.strictObject({
  persona: CardPersona,
  speech: CardSpeech,
  examples: z.array(CardExample).min(6).max(100),
  knowledge: CardKnowledge,
  simulation: CardSimulation,
  social: CardSocial,
  recognition: CardRecognition,
  opening: CardOpening,
  modes: CardModes,
  safetyStyle: CardSafetyStyle,
  profileExtra: CardProfileExtra,
  admin: CardAdmin,
  /** 3.7：提示词写法（可选）。 */
  prompting: CardPrompting.optional(),
});
export type WeibanCardData = z.infer<typeof WeibanCardData>;
export const CharacterCard = z.strictObject({
  cardSchemaVersion: z.literal(1),
  data: WeibanCardData,
});
export type CharacterCard = z.infer<typeof CharacterCard>;

/** 未完成的草稿可以保存；发布与运行时必须重新验证完整 CharacterCard。 */
export const DraftCharacterCard = z.strictObject({
  cardSchemaVersion: z.literal(1),
  data: z.strictObject({
    persona: CardPersona.partial().optional(),
    speech: CardSpeech.partial().optional(),
    examples: z.array(CardExample).max(100).optional(),
    knowledge: CardKnowledge.partial().optional(),
    simulation: CardSimulation.partial().optional(),
    social: CardSocial.partial().optional(),
    recognition: CardRecognition.partial().optional(),
    opening: CardOpening.optional(),
    modes: CardModes.partial().optional(),
    safetyStyle: CardSafetyStyle.partial().optional(),
    profileExtra: CardProfileExtra.partial().optional(),
    admin: CardAdmin.partial().optional(),
    prompting: CardPrompting.optional(),
  }),
});
export type DraftCharacterCard = z.infer<typeof DraftCharacterCard>;
