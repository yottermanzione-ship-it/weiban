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
});
export const CardKnowledge = z.strictObject({
  entries: z.array(CardKnowledgeEntry).max(500),
  unknownPolicy: text,
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
  }),
});
export type DraftCharacterCard = z.infer<typeof DraftCharacterCard>;
