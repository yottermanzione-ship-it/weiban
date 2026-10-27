/*
 * 人设板块配置：「板块 → 子板块 → 字段」的唯一来源（2026-10-27 批 U3 建最小版本，批 U4 挪到 client-core 并扩展）。
 *
 * 谁在用：
 * - 网页自建角色创建 / 编辑页（apps/web/src/features/custom-character.tsx）：按 create 生成分组白色行和整页编辑器；
 * - 网页人设卡（apps/web/src/features/persona-card.tsx）：广场作品详情、微伴角色详情、资料页「TA 的人设」、补充设定对照原卡；
 * - 后台角色预览（apps/admin/src/components/persona-card-preview.tsx）：同一配置分组，内部标记也显示；
 * - 后台人设原文分段（persona-text-sections.ts）：分段标签表 = 各子板块 legacyLabels 的合集。
 *
 * 总经理 10-26：字段方案未定，先搭骨架、预留位置。没有数据来源的子板块只写编号 / 标题 / 展示方式，
 * 取值为空的子板块（以及全空的板块）在人设卡上整块不显示。
 *
 * 以后加一个字段：只改下面 PERSONA_SECTIONS 一处——在对应板块加一条子板块（或给预留子板块补 from / field / create）。
 * 详见 docs/handoffs/2026-10-27-ui-u4.md「如何新增一个字段」。
 */
import {
  LegacyCharacterCard,
  type AgeSetting,
  type CharacterBasis,
  type CharacterProfile,
  type LegacyDialogueExample,
  type LegacyKnowledgeEntry,
  type PlazaOfficialPersona,
  type PlazaWorkDetail,
  type RealPersonKind,
  type UserCustomCharacter,
} from '@weiban/contracts';
import { splitPersonaTextWith, type PersonaTextDocument } from './persona-text.js';

// ---------- 创建草稿 ----------

/** 创建 / 编辑页正在编辑的一份角色草稿（与接口 UserCustomCharacterWrite 一一对应，只是列表用数组）。 */
export interface PersonaDraft {
  avatarMediaId: string | null;
  avatarUrl: string | null;
  name: string;
  basis: CharacterBasis;
  realKind: RealPersonKind;
  ageSetting: AgeSetting;
  childAppearance: boolean;
  tags: string[];
  description: string;
  speechStyle: string;
  catchphrases: string[];
  exampleDialogue: string;
  birthday: string;
  voiceId: string | null;
}

// ---------- 人设卡上的值与展示方式 ----------

export interface DialogueTurn {
  who: 'me' | 'ta';
  text: string;
}
/** 折叠条目（世界书、场景态度…）：标题一行，点开看内容。 */
export interface PersonaEntry {
  title: string;
  text: string;
}
/** 头像横滑里的一个人（认识的角色）。 */
export interface PersonaPerson {
  id: string;
  name: string;
  note?: string;
  avatarUrl?: string | null;
}
/**
 * 取值函数的返回值。展示方式决定该是哪一种：
 * text / line / title / identity / keyValue / avatar → 字符串；tags / quotes → 字符串数组；
 * bubbles → DialogueTurn[]；entries → PersonaEntry[]；avatarStrip → PersonaPerson[]。
 */
export type PersonaValue =
  | string
  | readonly string[]
  | readonly DialogueTurn[]
  | readonly PersonaEntry[]
  | readonly PersonaPerson[]
  | null
  | undefined;

/** 人设卡上的展示方式；组件按它渲染，配置只说用哪种。 */
export type PersonaDisplay =
  /** 头部大头像（值 = 图片地址，可为空；组件也可以由调用方换成自己的头像组件）。 */
  | 'avatar'
  /** 头部名字。 */
  | 'title'
  /** 头部一句身份（原创 / 作品角色 / 真人，一个词）。 */
  | 'identity'
  /** 头部灰字一行（一句话介绍）。 */
  | 'line'
  /** 标签：浅灰底小圆角，不加边框。 */
  | 'tags'
  /** 正文：超过 5 行折叠「展开」。 */
  | 'text'
  /** 引用列表：浅色引用块，每条一行（口头禅）。 */
  | 'quotes'
  /** 对话气泡：迷你聊天，左 TA 右我（示例对话）。 */
  | 'bubbles'
  /** 键值小行：灰字标题 + 值（生日、音色、来源）。 */
  | 'keyValue'
  /** 折叠条目：标题一行，点开看内容。 */
  | 'entries'
  /** 头像横滑：头像 + 名字 + 关系一行。 */
  | 'avatarStrip';

/** 创建页点进行后的编辑器类型；页面按类型渲染，配置只给参数。 */
export type PersonaEditor =
  /** 头像：点大头像直接弹「拍照 / 从相册选择」。 */
  | { kind: 'avatar' }
  /** 单行文字：FieldPage。 */
  | { kind: 'line'; maxLength: number; placeholder?: string }
  /** 长文本：整页大文本区 + 字数。 */
  | { kind: 'longText'; maxLength: number; minLength?: number; placeholder?: string; hint?: string }
  /** 可增删条目（口头禅、标签）。 */
  | {
      kind: 'list';
      maxItems: number;
      itemMaxLength: number;
      itemName: string;
      /** 行右侧摘要：count =「N 条」，join = 把条目用顿号连起来（标签）。 */
      summary: 'count' | 'join';
      placeholder?: string;
      hint?: string;
    }
  /** 示例对话：「我说 / TA 说」气泡式编辑，存成「我：… / TA：…」逐行文本。 */
  | { kind: 'dialogue'; maxLength: number }
  /** 日期：微信式滚轮。 */
  | { kind: 'date'; clearLabel: string }
  /** 音色：二级页面单选 + 试听。 */
  | { kind: 'voice' }
  /** 角色分类：二级页面单选，分类说明放在页内。 */
  | { kind: 'basis' }
  /** 年龄设定：二级页面单选 + 「外表是儿童」开关。 */
  | { kind: 'age' };

// ---------- 数据来源（四种形状） ----------

type Classification = Pick<
  CharacterProfile['classification'],
  'basis' | 'realPersonKind' | 'ageSetting' | 'childAppearance'
> & { childFeaturesDetected?: boolean };

/** 角色资料：资料页「TA 的人设」、补充设定对照原卡、微伴角色详情。custom = 自建角色的完整资料；official = 广场公开的基本人设。 */
export interface ProfilePersonaSource {
  profile: Pick<
    CharacterProfile,
    'name' | 'tagline' | 'tags' | 'basis' | 'intro' | 'birthday' | 'works' | 'aliases'
  > & { classification?: Classification; avatarUrl?: string | null };
  custom?: Pick<
    UserCustomCharacter,
    'description' | 'catchphrase' | 'catchphrases' | 'speechStyle' | 'exampleDialogue'
  > | null;
  official?: PlazaOfficialPersona | null;
  /** 音色名（调用方用音色库把 voiceId 换成名字）。 */
  voiceName?: string | null;
}

/** 广场作品（快照）：作品详情。 */
export interface PlazaPersonaSource {
  work: Pick<
    PlazaWorkDetail,
    | 'kind'
    | 'name'
    | 'tagline'
    | 'basis'
    | 'avatarUrl'
    | 'basedOnPresetName'
    | 'snapshot'
    | 'remixOf'
  >;
}

/** 平台旧卡（后台角色预览）：旧卡字段 + 世界书 / 示例两张附属表 + 角色库主表字段。 */
export interface LegacyPersonaSource {
  name: string;
  avatarUrl: string | null;
  signature: string;
  aliases: string[];
  corePersona: string;
  speakingStyle: string;
  relationshipMode: string;
  lorebook: Pick<LegacyKnowledgeEntry, 'title' | 'content' | 'keys'>[];
  examples: Pick<LegacyDialogueExample, 'scene' | 'userText' | 'assistantText'>[];
  /** 旧卡 moment_profile_json / group_chat_json 原值（JSON 或已解析对象）。 */
  momentProfile: unknown;
  groupChat: unknown;
  classification?: Classification | null;
  tags?: string[];
  works?: string[];
  birthday?: string | null;
}

export interface PersonaSources {
  draft: PersonaDraft;
  profile: ProfilePersonaSource;
  plaza: PlazaPersonaSource;
  legacy: LegacyPersonaSource;
}
export type PersonaSourceKind = keyof PersonaSources;
export type PersonaSource = {
  [K in PersonaSourceKind]: { kind: K; data: PersonaSources[K] };
}[PersonaSourceKind];

/** 每种来源一个取值函数；没写的来源 = 这个子板块在那里没有数据（不显示）。草稿默认按 field 取值。 */
export type PersonaGetters = {
  [K in PersonaSourceKind]?: (data: PersonaSources[K], sub: PersonaSubsection) => PersonaValue;
};

export interface PersonaSubsection {
  /** 稳定编号：也用作创建页二级页面的地址参数（?edit=编号），不要改名。 */
  id: string;
  /** 创建页行标题；人设卡小标题（没写 cardTitle 时）。 */
  title: string;
  /** 人设卡上的小标题，和创建页叫法不同时才写。 */
  cardTitle?: string;
  /** 草稿里的字段（创建页读写用）；没有数据来源的预留子板块不写。 */
  field?: keyof PersonaDraft;
  display: PersonaDisplay;
  /** 用户端人设卡是否展示（年龄设定、场景态度这类内部内容为 false，只在后台预览显示）。 */
  userVisible: boolean;
  /** 人设卡取值函数（按来源）。 */
  from?: PersonaGetters;
  /** 写了才在创建 / 编辑页出现一行。required：没填时创建按钮灰色、行右侧显示「未填写」。 */
  create?: { editor: PersonaEditor; required?: boolean };
  /** 对应后台角色管理里的位置（对齐说明；后台预览里显示成小字）。 */
  admin?: { tab: string; label: string };
  /**
   * 平台角色人设原文里属于这个子板块的中文分段标签（后台 PersonaTextEditor 分段 + 旧卡预览按标签落位）。
   * 新增一个标签只在这里加。
   */
  legacyLabels?: readonly string[];
}

export interface PersonaSection {
  id: string;
  /** 用户端人设卡上的板块标题。 */
  title: string;
  /** 后台的叫法（与 legacy-card-editor.tsx 分区一致），后台预览用；不写同 title。 */
  adminTitle?: string;
  subsections: PersonaSubsection[];
}

// ---------- 选项与小工具 ----------

export const BASIS_OPTIONS: {
  value: CharacterBasis;
  label: string;
  /** 用户端「一句身份」只显示这一个词。 */
  word: string;
  description: string;
}[] = [
  {
    value: 'original',
    label: '原创角色',
    word: '原创',
    description:
      '名字和经历是新编的，不以任何真实人物的身份出现。以某位真人的性格、说话风格为灵感也算原创，只要不用 TA 的真名、不写 TA 的真实作品、人际关系和经历。',
  },
  {
    value: 'fictional',
    label: '虚构作品中的角色',
    word: '作品角色',
    description: '出自影视、动画、小说、游戏等作品。',
  },
  {
    value: 'real_person',
    label: '真人',
    word: '真人',
    description:
      '以真实人物本人的身份出现：用 TA 的真名，或写了 TA 的真实作品、人际关系、经历。包括你身边的朋友、家人。',
  },
];

export const REAL_KIND_OPTIONS: { value: RealPersonKind; label: string }[] = [
  { value: 'private_person', label: '身边真人' },
  { value: 'celebrity', label: '公众人物' },
  { value: 'historical', label: '历史人物' },
];

export const AGE_OPTIONS: { value: AgeSetting; label: string }[] = [
  { value: 'adult', label: '已满 18 岁' },
  { value: 'minor', label: '未满 18 岁' },
];

/** 分类 → 用户端一个词（原创 / 作品角色 / 真人）；不认识的取值返回空串（不显示）。 */
export function basisWord(basis: string | null | undefined): string {
  return BASIS_OPTIONS.find((option) => option.value === basis)?.word ?? '';
}

function ageText(c: Classification | null | undefined): string {
  if (!c) return '';
  const age = AGE_OPTIONS.find((option) => option.value === c.ageSetting)?.label ?? '';
  const marks = [
    age,
    c.childAppearance ? '外表是儿童' : '',
    c.childFeaturesDetected ? '检测到儿童特征' : '',
  ];
  return marks.filter(Boolean).join(' · ');
}
function realKindText(c: Classification | null | undefined): string {
  if (!c || c.basis !== 'real_person') return '';
  return REAL_KIND_OPTIONS.find((option) => option.value === c.realPersonKind)?.label ?? '';
}

/** 「1998-03-14」→「3月14日」（生日只显示月日）。 */
export function birthdayText(value: string | null | undefined): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/u.exec(value ?? '');
  return match ? `${Number(match[1])}月${Number(match[2])}日` : '';
}

const catchphrasesOf = (custom: ProfilePersonaSource['custom']) =>
  custom?.catchphrases?.length
    ? custom.catchphrases
    : custom?.catchphrase
      ? [custom.catchphrase]
      : [];

const worksText = (works: readonly string[] | undefined) =>
  works?.length
    ? `出自 ${works.map((w) => (/^《.*》$/u.test(w) ? w : `《${w}》`)).join('、')}`
    : '';

// ---------- 板块 → 子板块 ----------

/** 板块 → 子板块。顺序就是创建页分组顺序和人设卡板块顺序。 */
export const PERSONA_SECTIONS: PersonaSection[] = [
  {
    id: 'head',
    title: '头部',
    adminTitle: '资料与头像',
    subsections: [
      {
        id: 'avatar',
        title: '头像',
        field: 'avatarUrl',
        display: 'avatar',
        userVisible: true,
        from: {
          profile: (d) => d.profile.avatarUrl,
          plaza: (d) => d.work.avatarUrl,
          legacy: (d) => d.avatarUrl,
        },
        create: { editor: { kind: 'avatar' } },
        admin: { tab: '资料与头像', label: '头像' },
      },
      {
        id: 'name',
        title: '名字',
        field: 'name',
        display: 'title',
        userVisible: true,
        from: {
          profile: (d) => d.profile.name,
          plaza: (d) => d.work.name,
          legacy: (d) => d.name,
        },
        create: {
          editor: { kind: 'line', maxLength: 32, placeholder: '角色名字' },
          required: true,
        },
        admin: { tab: '资料与头像', label: '角色名字' },
      },
      {
        id: 'basis',
        title: '角色分类',
        field: 'basis',
        display: 'identity',
        userVisible: true,
        from: {
          draft: (d) => basisWord(d.basis),
          profile: (d) => basisWord(d.profile.basis),
          plaza: (d) =>
            d.work.kind === 'preset_variant'
              ? '预设改版'
              : basisWord(
                  d.work.snapshot.kind === 'custom_character'
                    ? d.work.snapshot.classification.basis
                    : d.work.basis,
                ),
          legacy: (d) => basisWord(d.classification?.basis),
        },
        create: { editor: { kind: 'basis' } },
      },
      {
        id: 'realKind',
        title: '真人类型',
        display: 'keyValue',
        userVisible: false,
        from: {
          profile: (d) => realKindText(d.profile.classification),
          plaza: (d) =>
            d.work.snapshot.kind === 'custom_character'
              ? realKindText(d.work.snapshot.classification)
              : '',
          legacy: (d) => realKindText(d.classification),
        },
      },
      {
        id: 'age',
        title: '年龄设定',
        field: 'ageSetting',
        display: 'keyValue',
        userVisible: false,
        from: {
          draft: (d) =>
            ageText({
              basis: d.basis,
              realPersonKind: null,
              ageSetting: d.ageSetting,
              childAppearance: d.childAppearance,
            }),
          profile: (d) => ageText(d.profile.classification),
          plaza: (d) =>
            d.work.snapshot.kind === 'custom_character'
              ? ageText(d.work.snapshot.classification)
              : '',
          legacy: (d) => ageText(d.classification),
        },
        create: { editor: { kind: 'age' } },
      },
      {
        id: 'tagline',
        title: '一句话介绍',
        display: 'line',
        userVisible: true,
        from: {
          profile: (d) => d.profile.tagline,
          plaza: (d) => d.work.tagline,
          legacy: (d) => d.signature,
        },
        admin: { tab: '资料与头像', label: '签名' },
      },
      {
        id: 'tags',
        title: '标签',
        field: 'tags',
        display: 'tags',
        userVisible: true,
        from: {
          profile: (d) => d.profile.tags,
          plaza: (d) => (d.work.snapshot.kind === 'custom_character' ? d.work.snapshot.tags : []),
          legacy: (d) => d.tags,
        },
        create: {
          editor: {
            kind: 'list',
            maxItems: 10,
            itemMaxLength: 16,
            itemName: '标签',
            summary: 'join',
            placeholder: '如：傲娇、高冷、害羞',
          },
        },
      },
    ],
  },
  {
    id: 'about',
    title: '关于 TA',
    adminTitle: '人物与性格',
    subsections: [
      {
        id: 'description',
        title: '人设描述',
        cardTitle: '简介',
        field: 'description',
        display: 'text',
        userVisible: true,
        from: {
          profile: (d) => d.custom?.description || d.official?.summary || d.profile.intro,
          plaza: (d) =>
            d.work.snapshot.kind === 'custom_character' ? d.work.snapshot.description : '',
          legacy: legacyText,
        },
        create: {
          editor: {
            kind: 'longText',
            maxLength: 2000,
            minLength: 50,
            placeholder: '性格、经历、和你的关系、平时在做什么……至少 50 字',
          },
          required: true,
        },
        admin: { tab: '人设文本', label: '核心人设' },
        legacyLabels: ['身份', '简介', '公众人设', '公众形象', '舞台形象', '代表作品'],
      },
      {
        id: 'personality',
        title: '性格',
        display: 'text',
        userVisible: true,
        from: {
          profile: (d) => d.official?.personality,
          legacy: legacyText,
        },
        admin: { tab: '人设文本', label: '核心人设' },
        legacyLabels: [
          '人格核心',
          '性格核心',
          '私下感',
          '人设张力',
          '价值观',
          '情绪基线',
          '情绪基调',
          '情绪质感',
        ],
      },
      {
        id: 'variantText',
        title: '改版设定',
        display: 'text',
        userVisible: true,
        from: {
          plaza: (d) =>
            d.work.snapshot.kind === 'preset_variant' ? d.work.snapshot.variantText : '',
        },
      },
      // 预留：外貌、经历（有数据来源后补 from）
      { id: 'appearance', title: '外貌', display: 'text', userVisible: true },
      { id: 'history', title: '经历', display: 'text', userVisible: true },
    ],
  },
  {
    id: 'speech',
    title: '说话方式',
    subsections: [
      {
        id: 'speechStyle',
        title: '说话风格',
        field: 'speechStyle',
        display: 'text',
        userVisible: true,
        from: {
          profile: (d) => d.custom?.speechStyle || d.official?.speechStyle,
          plaza: (d) =>
            d.work.snapshot.kind === 'custom_character' ? d.work.snapshot.speechStyle : '',
          legacy: legacyText,
        },
        create: {
          editor: {
            kind: 'longText',
            maxLength: 500,
            placeholder: '语气、句子长短、爱不爱用表情……如：说话简短，爱用省略号',
          },
        },
        admin: { tab: '人设文本', label: '说话风格' },
        legacyLabels: ['句式规则', '回复长度', '样例语气', '反通用 AI 规则', '反通用AI规则'],
      },
      {
        id: 'catchphrases',
        title: '口头禅',
        field: 'catchphrases',
        display: 'quotes',
        userVisible: true,
        from: {
          profile: (d) => (d.custom ? catchphrasesOf(d.custom) : (d.official?.catchphrases ?? [])),
          plaza: (d) =>
            d.work.snapshot.kind === 'custom_character' ? d.work.snapshot.catchphrases : [],
        },
        create: {
          editor: {
            kind: 'list',
            maxItems: 10,
            itemMaxLength: 50,
            itemName: '口头禅',
            summary: 'count',
            placeholder: '一句 TA 常说的话',
          },
        },
      },
      {
        id: 'exampleDialogue',
        title: '示例对话',
        field: 'exampleDialogue',
        display: 'bubbles',
        userVisible: true,
        from: {
          draft: (d) => parseDialogue(d.exampleDialogue),
          profile: (d) => parseDialogue(d.custom?.exampleDialogue ?? ''),
          plaza: (d) =>
            d.work.snapshot.kind === 'custom_character'
              ? parseDialogue(d.work.snapshot.exampleDialogue)
              : [],
          legacy: (d) =>
            d.examples.flatMap((e) => [
              ...(e.userText.trim() ? [{ who: 'me' as const, text: e.userText.trim() }] : []),
              ...(e.assistantText.trim()
                ? [{ who: 'ta' as const, text: e.assistantText.trim() }]
                : []),
            ]),
        },
        create: { editor: { kind: 'dialogue', maxLength: 2000 } },
        admin: { tab: '词条与示例', label: '对话示例' },
      },
    ],
  },
  {
    id: 'background',
    title: '背景资料',
    adminTitle: '背景与词条',
    subsections: [
      // 预留：世界观 / 设定
      { id: 'world', title: '世界观 / 设定', display: 'text', userVisible: true },
      {
        id: 'loreEntries',
        title: '公开资料条目',
        display: 'entries',
        userVisible: true,
        from: {
          legacy: (d) =>
            d.lorebook.map((entry) => ({
              title: entry.title || entry.keys.join('、') || '未命名条目',
              text: entry.content,
            })),
        },
        admin: { tab: '词条与示例', label: '背景与触发词条' },
      },
    ],
  },
  {
    id: 'relations',
    title: '关系',
    subsections: [
      // 预留：认识的角色（头像横滑）、与你的关系
      { id: 'knownCharacters', title: '认识的角色', display: 'avatarStrip', userVisible: true },
      { id: 'relationToYou', title: '与你的关系', display: 'keyValue', userVisible: true },
    ],
  },
  {
    id: 'attitude',
    title: '场景态度',
    adminTitle: '人设引擎 · 场景态度',
    subsections: [
      // 平台角色给模型的写作要求：只在后台预览显示
      {
        id: 'sceneAttitude',
        title: '场景态度',
        display: 'entries',
        userVisible: false,
        from: { legacy: legacyEntries },
        admin: { tab: '人设文本', label: '关系与场景态度' },
        legacyLabels: [
          '默认回复',
          '冷淡回复',
          '温和回复',
          '调侃模式',
          '越界回复',
          '安慰模式',
          '吃醋模式',
          '亲近方式',
          '互动距离',
          '关系距离',
          '关系模式',
          '粉丝互动',
        ],
      },
      {
        id: 'boundaries',
        title: '边界处理',
        display: 'entries',
        userVisible: false,
        from: { legacy: legacyEntries },
        legacyLabels: [
          '必须保留',
          '必须避免',
          '边界处理',
          '隐私问题',
          '绯闻问题',
          '行程问题',
          '官方立场',
        ],
      },
    ],
  },
  {
    id: 'interaction',
    title: '互动风格',
    subsections: [
      {
        id: 'momentStyle',
        title: '朋友圈风格',
        display: 'keyValue',
        userVisible: false,
        from: {
          legacy: (d) => {
            const m = LegacyCharacterCard.from({
              moment_profile_json: d.momentProfile,
            })?.momentProfile;
            return m
              ? [m.tone, m.topics.join('、'), m.commentStyle].filter(Boolean).join(' · ')
              : '';
          },
        },
        admin: { tab: '互动风格', label: '朋友圈风格' },
      },
      {
        id: 'groupStyle',
        title: '群聊风格',
        display: 'keyValue',
        userVisible: false,
        from: {
          legacy: (d) => {
            const g = LegacyCharacterCard.from({ group_chat_json: d.groupChat })?.groupChat;
            return g ? [g.style, g.hobbies].filter(Boolean).join(' · ') : '';
          },
        },
        admin: { tab: '互动风格', label: '群聊风格与开场白' },
      },
    ],
  },
  {
    id: 'other',
    title: '其他',
    subsections: [
      {
        id: 'birthday',
        title: '生日',
        field: 'birthday',
        display: 'keyValue',
        userVisible: true,
        from: {
          draft: (d) => birthdayText(d.birthday),
          profile: (d) => birthdayText(d.profile.birthday),
          plaza: (d) =>
            d.work.snapshot.kind === 'custom_character'
              ? birthdayText(d.work.snapshot.birthday)
              : '',
          legacy: (d) => birthdayText(d.birthday),
        },
        create: { editor: { kind: 'date', clearLabel: '不设置生日' } },
      },
      {
        id: 'voice',
        title: '音色',
        field: 'voiceId',
        display: 'keyValue',
        userVisible: true,
        from: {
          // 草稿里只有音色 ID，名字要音色库换算：草稿人设卡暂不显示音色
          draft: () => '',
          profile: (d) => d.voiceName,
          plaza: (d) =>
            d.work.snapshot.kind === 'custom_character' ? d.work.snapshot.voiceName : '',
        },
        create: { editor: { kind: 'voice' } },
        admin: { tab: '声音与微博', label: '音色' },
      },
      {
        id: 'aliases',
        title: '别名',
        display: 'keyValue',
        userVisible: true,
        from: {
          profile: (d) => d.profile.aliases.join('、'),
          legacy: (d) => d.aliases.join('、'),
        },
        admin: { tab: '资料与头像', label: '别名' },
      },
      {
        id: 'source',
        title: '来源 / 改编',
        cardTitle: '来源',
        display: 'keyValue',
        userVisible: true,
        from: {
          profile: (d) => worksText(d.profile.works),
          plaza: (d) =>
            d.work.snapshot.kind === 'preset_variant'
              ? `基于预设角色 ${d.work.basedOnPresetName ?? ''}`.trim()
              : d.work.remixOf
                ? `改编自《${d.work.remixOf.name}》· 原作者 ${d.work.remixOf.authorNickname}`
                : '',
          legacy: (d) => worksText(d.works),
        },
      },
    ],
  },
];

// ---------- 旧卡原文按标签落位 ----------

/** 平台人设原文能识别的全部中文分段标签（= 各子板块 legacyLabels 合集；后台分段编辑也用这张表）。 */
export const PERSONA_TEXT_LABELS: ReadonlySet<string> = new Set(
  PERSONA_SECTIONS.flatMap((section) =>
    section.subsections.flatMap((sub) => sub.legacyLabels ?? []),
  ),
);

export function splitPersonaText(source: string): PersonaTextDocument {
  return splitPersonaTextWith(source, PERSONA_TEXT_LABELS);
}

const LABEL_OWNER = new Map<string, string>(
  PERSONA_SECTIONS.flatMap((section) =>
    section.subsections.flatMap((sub) =>
      (sub.legacyLabels ?? []).map((label) => [label, sub.id] as const),
    ),
  ),
);

/** 三段旧卡原文各自「没带标签的部分」归到哪个子板块。 */
const LEGACY_TEXT_HOME = [
  ['corePersona', 'description'],
  ['speakingStyle', 'speechStyle'],
  ['relationshipMode', 'sceneAttitude'],
] as const;

const legacyCache = new WeakMap<LegacyPersonaSource, Map<string, PersonaEntry[]>>();
/** 把旧卡三段原文按标签切开，落到对应子板块（子板块 id → 段落）。 */
function legacyParts(d: LegacyPersonaSource): Map<string, PersonaEntry[]> {
  const cached = legacyCache.get(d);
  if (cached) return cached;
  const result = new Map<string, PersonaEntry[]>();
  const push = (id: string, entry: PersonaEntry) => {
    if (!entry.text.trim()) return;
    result.set(id, [...(result.get(id) ?? []), { title: entry.title, text: entry.text.trim() }]);
  };
  for (const [key, home] of LEGACY_TEXT_HOME) {
    const doc = splitPersonaText(d[key]);
    push(home, { title: '', text: doc.leading });
    for (const part of doc.parts)
      push(LABEL_OWNER.get(part.label) ?? home, { title: part.label, text: part.text });
  }
  legacyCache.set(d, result);
  return result;
}
function legacyText(d: LegacyPersonaSource, sub: PersonaSubsection): string {
  const own = new Set([sub.title, sub.cardTitle]);
  return (legacyParts(d).get(sub.id) ?? [])
    .map((p) => (p.title && !own.has(p.title) ? `${p.title}：${p.text}` : p.text))
    .join('\n');
}
function legacyEntries(d: LegacyPersonaSource, sub: PersonaSubsection): PersonaEntry[] {
  return (legacyParts(d).get(sub.id) ?? []).map((p) => ({
    title: p.title || sub.admin?.label || sub.title,
    text: p.text,
  }));
}

// ---------- 解析：来源 → 人设卡要显示的板块 ----------

export function isEmptyPersonaValue(value: PersonaValue): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return !value.trim();
  return value.length === 0;
}

export interface ResolvedSubsection {
  sub: PersonaSubsection;
  value: Exclude<PersonaValue, null | undefined>;
}
export interface ResolvedSection {
  section: PersonaSection;
  items: ResolvedSubsection[];
}

function valueOf(source: PersonaSource, sub: PersonaSubsection): PersonaValue {
  const getter = sub.from?.[source.kind] as
    ((data: PersonaSources[PersonaSourceKind], sub: PersonaSubsection) => PersonaValue) | undefined;
  if (getter) return getter(source.data, sub);
  if (source.kind === 'draft' && sub.field) return source.data[sub.field] as PersonaValue;
  return null;
}

/**
 * 按配置取出人设卡要显示的内容：取值为空的子板块去掉，全空的板块去掉；
 * audience = 'user' 时去掉 userVisible = false 的子板块（内部标记只在后台显示）。
 */
export function resolvePersonaCard(
  source: PersonaSource,
  audience: 'user' | 'admin' = 'user',
): ResolvedSection[] {
  return PERSONA_SECTIONS.map((section) => ({
    section,
    items: section.subsections
      .filter((sub) => audience === 'admin' || sub.userVisible)
      .map((sub) => ({ sub, value: valueOf(source, sub) }))
      .filter((item): item is ResolvedSubsection => !isEmptyPersonaValue(item.value)),
  })).filter((group) => group.items.length > 0);
}

/** 值的类型守卫：组件按展示方式取对应形状，形状不对时当空处理。 */
export const personaValue = {
  text: (value: PersonaValue): string => (typeof value === 'string' ? value : ''),
  list: (value: PersonaValue): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [],
  turns: (value: PersonaValue): DialogueTurn[] =>
    Array.isArray(value)
      ? value.filter((v): v is DialogueTurn => typeof v === 'object' && v !== null && 'who' in v)
      : [],
  entries: (value: PersonaValue): PersonaEntry[] =>
    Array.isArray(value)
      ? value.filter((v): v is PersonaEntry => typeof v === 'object' && v !== null && 'title' in v)
      : [],
  people: (value: PersonaValue): PersonaPerson[] =>
    Array.isArray(value)
      ? value.filter((v): v is PersonaPerson => typeof v === 'object' && v !== null && 'id' in v)
      : [],
};

// ---------- 创建页 ----------

/** 创建页要出现的子板块（按板块分组，空板块不出现）。 */
export function createSections(): { section: PersonaSection; rows: PersonaSubsection[] }[] {
  return PERSONA_SECTIONS.map((section) => ({
    section,
    rows: section.subsections.filter((s) => s.create && s.field),
  })).filter((group) => group.rows.length > 0);
}

export function findSubsection(id: string | null): PersonaSubsection | undefined {
  if (!id) return undefined;
  for (const section of PERSONA_SECTIONS)
    for (const sub of section.subsections) if (sub.id === id && sub.create && sub.field) return sub;
  return undefined;
}

// ---------- 示例对话：「我说 / TA 说」与逐行文本互转 ----------

const ME_PREFIX = /^\s*(我|用户|user|\{\{user\}\})\s*[:：]\s*/iu;
const TA_PREFIX = /^\s*(TA|他|她|它|角色|char|\{\{char\}\})\s*[:：]\s*/iu;

/** 逐行文本 → 气泡。没有「我：/ TA：」开头的行接到上一句后面；开头就没有前缀的当作 TA 说的。 */
export function parseDialogue(text: string): DialogueTurn[] {
  const turns: DialogueTurn[] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const me = ME_PREFIX.exec(line);
    const ta = me ? null : TA_PREFIX.exec(line);
    if (me) turns.push({ who: 'me', text: line.slice(me[0].length) });
    else if (ta) turns.push({ who: 'ta', text: line.slice(ta[0].length) });
    else if (turns.length) turns[turns.length - 1]!.text += `\n${line}`;
    else turns.push({ who: 'ta', text: line });
  }
  return turns;
}

export function serializeDialogue(turns: DialogueTurn[]): string {
  return turns
    .filter((turn) => turn.text.trim())
    .map((turn) => `${turn.who === 'me' ? '我' : 'TA'}：${turn.text.trim()}`)
    .join('\n');
}

/** 「N 组」：每次「我说」开始一组；没有我说、直接 TA 说的也算一组。 */
export function dialogueGroups(text: string): number {
  let groups = 0;
  let prev: DialogueTurn['who'] | null = null;
  for (const turn of parseDialogue(text)) {
    if (turn.who === 'me' || prev !== 'me') groups += 1;
    prev = turn.who;
  }
  return groups;
}
