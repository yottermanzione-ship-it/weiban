/*
 * 人设板块配置（2026-10-27 批 U3，最小版本；U4 扩展并挪到 packages/client-core 供网页与后台共用）。
 *
 * 这是「板块 → 子板块 → 字段」的唯一来源：
 * - 自建角色创建 / 编辑页（custom-character.tsx）按它生成分组白色行、行右侧摘要、点进去的整页编辑器；
 * - U4 的人设卡组件按同一份配置渲染（display / userVisible 两项就是给它预留的）。
 *
 * 板块命名对齐后台角色管理（apps/admin/src/components/legacy-card-editor.tsx 的分区与
 * persona-text-sections.ts 的中文分段标签），不另起一套：「人物与性格」「说话方式」「场景态度」
 * 「背景与词条」「互动风格」直接用后台的叫法；后台的「资料与头像」在这里叫「头部」，「声音」并入「其他」。
 *
 * 以后加一个字段：只在下面 PERSONA_SECTIONS 里对应板块加一条子板块（有数据来源就写 field，
 * 要在创建页出现就写 create.editor），创建页自动多一行、点进去就是对应编辑器；
 * 字段在 PersonaDraft 里加一个键并在 custom-character.tsx 的读写映射里接上接口字段。详见
 * docs/handoffs/2026-10-27-ui-u3.md「以后加一个字段改哪一处」。
 */
import type { AgeSetting, CharacterBasis, RealPersonKind } from '@weiban/contracts';

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

/** 人设卡（U4）上的展示方式；创建页不用。 */
export type PersonaDisplay =
  | 'avatar'
  | 'identity'
  | 'text'
  | 'quotes'
  | 'bubbles'
  | 'tags'
  | 'keyValue'
  | 'entries'
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

export interface PersonaSubsection {
  /** 稳定编号：也用作创建页二级页面的地址参数（?edit=编号），不要改名。 */
  id: string;
  title: string;
  /** 草稿里的字段；没有数据来源的预留子板块不写。 */
  field?: keyof PersonaDraft;
  display: PersonaDisplay;
  /** 用户端人设卡是否展示（年龄设定这类内部分类为 false，只在后台显示）。 */
  userVisible: boolean;
  /** 写了才在创建 / 编辑页出现一行。required：没填时创建按钮灰色、行右侧显示「未填写」。 */
  create?: { editor: PersonaEditor; required?: boolean };
  /** 对应后台角色管理里的位置（只作对齐说明，U4 后台预览按它分组）。 */
  admin?: { tab: string; label: string };
  /**
   * 后台 persona-text-sections.ts 里属于这个子板块的中文分段标签（平台预设角色的人设原文按这些标签分段）。
   * U4 人设卡从平台角色原文里按标签取段落时用；自建角色不走这条。
   */
  legacyLabels?: readonly string[];
}

export interface PersonaSection {
  id: string;
  title: string;
  subsections: PersonaSubsection[];
}

export const BASIS_OPTIONS: {
  value: CharacterBasis;
  label: string;
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

/** 板块 → 子板块。顺序就是创建页分组顺序和人设卡板块顺序。 */
export const PERSONA_SECTIONS: PersonaSection[] = [
  {
    id: 'head',
    title: '头部',
    subsections: [
      {
        id: 'avatar',
        title: '头像',
        field: 'avatarUrl',
        display: 'avatar',
        userVisible: true,
        create: { editor: { kind: 'avatar' } },
        admin: { tab: '资料与头像', label: '头像' },
      },
      {
        id: 'name',
        title: '名字',
        field: 'name',
        display: 'identity',
        userVisible: true,
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
        create: { editor: { kind: 'basis' } },
        legacyLabels: ['身份'],
      },
      {
        id: 'age',
        title: '年龄设定',
        field: 'ageSetting',
        display: 'keyValue',
        userVisible: false,
        create: { editor: { kind: 'age' } },
      },
      {
        id: 'tags',
        title: '标签',
        field: 'tags',
        display: 'tags',
        userVisible: true,
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
    title: '人物与性格',
    subsections: [
      {
        id: 'description',
        title: '人设描述',
        field: 'description',
        display: 'text',
        userVisible: true,
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
        legacyLabels: [
          '简介',
          '公众人设',
          '公众形象',
          '舞台形象',
          '代表作品',
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
      // 预留：外貌、经历（U4 有数据来源后补 field）
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
        create: { editor: { kind: 'dialogue', maxLength: 2000 } },
        admin: { tab: '词条与示例', label: '对话示例' },
      },
    ],
  },
  {
    id: 'attitude',
    title: '场景态度',
    subsections: [
      // 预留：平台角色的「关系与场景态度」原文分段；自建角色暂无对应字段
      {
        id: 'sceneAttitude',
        title: '场景态度',
        display: 'entries',
        userVisible: true,
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
      // 只在后台显示的边界类分段
      {
        id: 'boundaries',
        title: '边界处理',
        display: 'entries',
        userVisible: false,
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
    id: 'background',
    title: '背景与词条',
    subsections: [
      { id: 'world', title: '世界观 / 设定', display: 'text', userVisible: true },
      {
        id: 'loreEntries',
        title: '公开资料条目',
        display: 'entries',
        userVisible: true,
        admin: { tab: '词条与示例', label: '背景与触发词条' },
      },
    ],
  },
  {
    id: 'relations',
    title: '关系',
    subsections: [
      { id: 'knownCharacters', title: '认识的角色', display: 'avatarStrip', userVisible: true },
      { id: 'relationToYou', title: '与你的关系', display: 'keyValue', userVisible: true },
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
        admin: { tab: '互动风格', label: '朋友圈风格' },
      },
      {
        id: 'groupStyle',
        title: '群聊风格',
        display: 'keyValue',
        userVisible: false,
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
        create: { editor: { kind: 'date', clearLabel: '不设置生日' } },
      },
      {
        id: 'voice',
        title: '音色',
        field: 'voiceId',
        display: 'keyValue',
        userVisible: true,
        create: { editor: { kind: 'voice' } },
        admin: { tab: '声音与微博', label: '音色' },
      },
      { id: 'source', title: '来源 / 改编', display: 'keyValue', userVisible: true },
    ],
  },
];

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

export interface DialogueTurn {
  who: 'me' | 'ta';
  text: string;
}

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
