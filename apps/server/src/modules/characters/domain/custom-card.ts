/**
 * 自定义角色的存储格式与「运行时角色卡」合成（T-088）。
 *
 * 自定义角色（含广场复制品）的 draft_ciphertext 存 CustomCharacterPayload（JSON）。AI 运行时、资料页、名字查询统一读
 * AdminCharacterWrite 形状，所以这里把 payload 合成为一份完整的 WB-Card（CharacterCard）：
 *   - 预设改版复制品带有 presetCard（复制时预设角色当前人设版本的卡片，已去掉公开资料、近期主线、来源清单、本人公开图片），
 *     直接使用并把改版设定并入 persona.background；
 *   - 其他自定义角色由人设描述、说话方式、口头禅、示例对话、标签按固定模板补齐必填项。
 * 分类事实永远只看数据库列，不看这里的任何文字（hard-boundaries.md 第 2 节）。
 */
import { CharacterCard, Id, type AdminCharacterWrite } from '@weiban/contracts';

export interface CustomCharacterPayload {
  name: string;
  description: string;
  classification: {
    basis: string;
    realPersonKind: string | null;
    ageSetting: string;
    childAppearance: boolean;
  };
  birthday: string | null;
  catchphrase: string | null;
  exampleDialogue: string | null;
  tags: string[];
  avatarMediaId: string | null;
  voiceId?: string | null;
  /** T-088：广场快照白名单中多出的字段。 */
  speechStyle?: string | null;
  catchphrases?: string[];
  voiceName?: string | null;
  /** 预设改版复制品：改版设定与基于的预设角色（只是引用）。 */
  variantText?: string | null;
  basedOnPresetId?: string | null;
  presetCard?: CharacterCard | null;
}

const CARE_FALLBACK =
  '如果你现在真的很难受，先联系一个你信任的人陪着你；也可以拨打心理援助热线 12356。遇到危险请马上拨打 110，需要急救请拨打 120。';

/** 旧预设复制品继承快照音色；明确的null必须保留清空语义。 */
export function voiceIdOf(p: CustomCharacterPayload): string | null {
  const selected = p.voiceId === undefined ? p.presetCard?.data.social.voiceId : p.voiceId;
  const parsed = Id.safeParse(selected);
  return parsed.success ? parsed.data : null;
}

const SCENES = ['greeting', 'daily', 'praised', 'teased', 'comfort', 'refuseInCharacter'] as const;
const GENERIC_LINES: Record<(typeof SCENES)[number], string> = {
  greeting: '嗨，你来啦。',
  daily: '今天过得怎么样？',
  praised: '哈哈，被你这么一说我都不好意思了。',
  teased: '哼，你又逗我。',
  comfort: '别急，慢慢说，我在听。',
  refuseInCharacter: '这个我就不聊啦，换个话题吧。',
};

export function catchphrasesOf(p: CustomCharacterPayload): string[] {
  if (p.catchphrases?.length) return p.catchphrases;
  return p.catchphrase ? [p.catchphrase] : [];
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function synthesizeCard(p: CustomCharacterPayload): CharacterCard {
  const description = p.description.trim() || p.name;
  const dialogue = (p.exampleDialogue ?? '').trim();
  const phrases = catchphrasesOf(p);
  const examples = SCENES.map((scene, i) => ({
    id: `ex_${scene}`,
    scene,
    turns: [
      {
        role: 'char' as const,
        text: clip(
          i === 0 && dialogue
            ? dialogue
            : i === 1 && phrases[0]
              ? phrases[0]
              : GENERIC_LINES[scene],
          2000,
        ),
      },
    ],
  }));
  return {
    cardSchemaVersion: 1,
    data: {
      persona: {
        summary: clip(description, 600),
        personality: clip(description, 2000),
        personaTags: ['calm'],
        ...(p.variantText ? { background: clip(p.variantText, 4000) } : {}),
      },
      speech: {
        selfReference: ['我'],
        tone: clip(p.speechStyle?.trim() || '自然、口语化，像朋友聊天', 2000),
        sentenceLength: 'short',
        ...(phrases.length ? { catchphrases: phrases.slice(0, 100) } : {}),
        emojiHabit: { frequency: 'rare', favorites: [] },
      },
      examples,
      knowledge: { entries: [], unknownPolicy: '不知道的事就自然地说不清楚，不编造。' },
      simulation: {
        dailyActivities: [
          '起床',
          '吃早饭',
          '出门',
          '忙自己的事',
          '吃午饭',
          '休息一会',
          '吃晚饭',
          '睡前放松',
        ],
        placeTypes: ['家'],
        hobbies: p.tags.slice(0, 100),
      },
      social: { talkativeness: 50, moments: { frequencyPerWeek: [1, 3], tone: '日常、随意' } },
      recognition: { selfEnabled: false },
      opening: {},
      modes: { adminAllowlist: [] },
      safetyStyle: { careVoice: '温和、认真，先关心对方的感受', careFallbackText: CARE_FALLBACK },
      profileExtra: { occupation: '未设定' },
      admin: { creationMethod: 'manual' },
    },
  };
}

/** 预设卡复制给用户时去掉的预设专有数据（PLZ-04 第 1 条：关系网、公开动态、近期主线、公开资料检索不复制）。 */
export function stripPresetCard(card: CharacterCard): CharacterCard {
  const d = card.data;
  const { storylineSeeds: _seeds, ...simulation } = d.simulation;
  const { sourceList: _sources, ...admin } = d.admin;
  void _seeds;
  void _sources;
  return {
    cardSchemaVersion: 1,
    data: {
      ...d,
      knowledge: { entries: [], unknownPolicy: d.knowledge.unknownPolicy },
      simulation,
      recognition: { selfEnabled: false },
      admin: { ...admin, creationMethod: 'manual' },
    },
  };
}

function cardFor(p: CustomCharacterPayload): CharacterCard {
  if (p.presetCard) {
    const parsed = CharacterCard.safeParse(p.presetCard);
    if (parsed.success) {
      const card = parsed.data;
      if (!p.variantText) return card;
      const background = [card.data.persona.background, `【改版设定】${p.variantText}`]
        .filter(Boolean)
        .join('\n');
      return {
        ...card,
        data: {
          ...card.data,
          persona: { ...card.data.persona, background: clip(background, 4000) },
        },
      };
    }
  }
  return synthesizeCard(p);
}

/** 合成 AdminCharacterWrite 形状（不经 parse，card 是完整 CharacterCard，也满足 DraftCharacterCard）。 */
export function customToAdminWrite(p: CustomCharacterPayload): AdminCharacterWrite {
  return {
    name: p.name,
    aliases: [],
    works: [],
    tagline: '',
    intro: clip(p.description, 1000),
    tags: p.tags.slice(0, 10),
    categoryId: null,
    avatar: {
      imageMediaId: p.avatarMediaId ?? null,
      display: { supportColors: [], avatarText: null, avatarPattern: 'none', themeColor: null },
    },
    birthday: p.birthday,
    fanName: null,
    classification: p.classification as AdminCharacterWrite['classification'],
    fallbackGreetings: ['嗨，我们终于加上好友啦。'],
    card: (() => {
      const card = cardFor(p);
      if (p.voiceId === undefined) return card;
      const { voiceId: _previousVoice, ...social } = card.data.social;
      void _previousVoice;
      return {
        ...card,
        data: { ...card.data, social: { ...social, ...(p.voiceId ? { voiceId: p.voiceId } : {}) } },
      };
    })(),
  } as AdminCharacterWrite;
}

/** 预设卡 → 复制品 payload 的人设字段（PLZ-04 第 1 条）。 */
export function presetPersonaFields(card: CharacterCard): {
  description: string;
  speechStyle: string;
  catchphrases: string[];
  exampleDialogue: string;
} {
  const d = card.data;
  return {
    description: clip([d.persona.summary, d.persona.personality].join('\n'), 2000),
    speechStyle: clip(d.speech.tone, 1000),
    catchphrases: (d.speech.catchphrases ?? []).slice(0, 20).map((c) => clip(c, 50)),
    exampleDialogue: clip(
      d.examples
        .slice(0, 6)
        .map((e) => e.turns.map((t) => `${t.role === 'char' ? 'TA' : '我'}：${t.text}`).join('\n'))
        .join('\n\n'),
      2000,
    ),
  };
}
