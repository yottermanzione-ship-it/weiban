/**
 * 系统内置素材（换壳 UI 批次，docs/refactor/02 第 6.5 节）：随版本带上、不依赖管理员上传的占位插画。
 *
 * 数据库 media.objects 里这类行的 storage_key 以 `builtin/` 开头（迁移 0084 预置），
 * 文件内容不在对象存储里，而是由本文件按 key 现场画出（原创的简单 SVG）。
 * 管理员之后在后台上传正式插画、改外观图即可替换，这些占位行不会被删除。
 *
 * key 格式：builtin/pet/<species>-<appearance>-<stage>.svg
 *   species = cat | dog | rabbit；appearance = 1 | 2 | 3；stage = baby | junior | adult
 */

export const BUILTIN_KEY_PREFIX = 'builtin/';

export function isBuiltinKey(storageKey: string): boolean {
  return storageKey.startsWith(BUILTIN_KEY_PREFIX);
}

type Species = 'cat' | 'dog' | 'rabbit';
type Stage = 'baby' | 'junior' | 'adult';

interface Look {
  bg: string;
  body: string;
  belly: string;
  /** 斑块：[cx, cy, r, color]，坐标在动物自身坐标系里。 */
  patches: [number, number, number, string][];
  ear: string;
}

const OUTLINE = '#5A4A42';

const LOOKS: Record<Species, [Look, Look, Look]> = {
  cat: [
    // 橘猫
    { bg: '#FFE9D2', body: '#F2A24A', belly: '#FFE3C2', patches: [], ear: '#F2A24A' },
    // 奶牛猫
    {
      bg: '#FFE9D2',
      body: '#FFFFFF',
      belly: '#FFFFFF',
      patches: [
        [-26, -52, 20, '#3A3A3A'],
        [30, 36, 24, '#3A3A3A'],
      ],
      ear: '#3A3A3A',
    },
    // 三花猫
    {
      bg: '#FFE9D2',
      body: '#FFFFFF',
      belly: '#FFFFFF',
      patches: [
        [-28, -50, 20, '#F2A24A'],
        [26, -54, 16, '#3A3A3A'],
        [-30, 44, 20, '#3A3A3A'],
        [32, 34, 18, '#F2A24A'],
      ],
      ear: '#F2A24A',
    },
  ],
  dog: [
    // 柴犬
    { bg: '#E3F0FF', body: '#D9893B', belly: '#FFF1DD', patches: [], ear: '#C87A30' },
    // 小白狗
    { bg: '#E3F0FF', body: '#FAFAFA', belly: '#FFFFFF', patches: [], ear: '#EDE6DE' },
    // 黑白狗
    {
      bg: '#E3F0FF',
      body: '#3A3A3A',
      belly: '#FFFFFF',
      patches: [[0, -22, 24, '#FFFFFF']],
      ear: '#2A2A2A',
    },
  ],
  rabbit: [
    // 白兔
    { bg: '#F3E6FF', body: '#FFFFFF', belly: '#FFFFFF', patches: [], ear: '#FFD6DE' },
    // 灰兔
    { bg: '#F3E6FF', body: '#A7A7AD', belly: '#E4E4E8', patches: [], ear: '#D9C3C8' },
    // 奶茶兔
    { bg: '#F3E6FF', body: '#D8B58F', belly: '#F4E6D4', patches: [], ear: '#F1C9B8' },
  ],
};

const STAGE_SCALE: Record<Stage, number> = { baby: 0.62, junior: 0.8, adult: 1 };

function ears(species: Species, look: Look): string {
  const o = `stroke="${OUTLINE}" stroke-width="4" stroke-linejoin="round"`;
  if (species === 'cat')
    return [
      `<polygon points="-48,-58 -40,-104 -12,-78" fill="${look.ear}" ${o}/>`,
      `<polygon points="48,-58 40,-104 12,-78" fill="${look.ear}" ${o}/>`,
    ].join('');
  if (species === 'dog')
    return [
      `<ellipse cx="-50" cy="-44" rx="17" ry="32" transform="rotate(22 -50 -44)" fill="${look.ear}" ${o}/>`,
      `<ellipse cx="50" cy="-44" rx="17" ry="32" transform="rotate(-22 50 -44)" fill="${look.ear}" ${o}/>`,
    ].join('');
  return [
    `<ellipse cx="-22" cy="-104" rx="14" ry="44" fill="${look.body}" ${o}/>`,
    `<ellipse cx="-22" cy="-104" rx="6" ry="30" fill="${look.ear}"/>`,
    `<ellipse cx="22" cy="-104" rx="14" ry="44" fill="${look.body}" ${o}/>`,
    `<ellipse cx="22" cy="-104" rx="6" ry="30" fill="${look.ear}"/>`,
  ].join('');
}

function draw(species: Species, appearance: 1 | 2 | 3, stage: Stage): string {
  const look = LOOKS[species][appearance - 1] ?? LOOKS[species][0];
  const s = STAGE_SCALE[stage];
  const o = `stroke="${OUTLINE}" stroke-width="4"`;
  const patches = look.patches
    .map(([cx, cy, r, c]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`)
    .join('');
  // 幼年眼睛更大，显得稚气；成年眼睛略小。
  const eye = stage === 'baby' ? 8 : stage === 'junior' ? 7 : 6;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">`,
    `<circle cx="128" cy="128" r="124" fill="${look.bg}"/>`,
    `<g transform="translate(128 ${150 + (1 - s) * 40}) scale(${s})">`,
    ears(species, look),
    `<ellipse cx="0" cy="44" rx="62" ry="50" fill="${look.body}" ${o}/>`,
    `<ellipse cx="0" cy="54" rx="34" ry="30" fill="${look.belly}"/>`,
    `<circle cx="0" cy="-30" r="52" fill="${look.body}" ${o}/>`,
    `<clipPath id="h"><circle cx="0" cy="-30" r="50"/><ellipse cx="0" cy="44" rx="60" ry="48"/></clipPath>`,
    `<g clip-path="url(#h)">${patches}</g>`,
    `<circle cx="-19" cy="-34" r="${eye}" fill="#2B2B2B"/>`,
    `<circle cx="19" cy="-34" r="${eye}" fill="#2B2B2B"/>`,
    `<circle cx="-17" cy="-37" r="2" fill="#FFFFFF"/>`,
    `<circle cx="21" cy="-37" r="2" fill="#FFFFFF"/>`,
    `<ellipse cx="0" cy="-18" rx="6" ry="4" fill="#E58C8C"/>`,
    `<path d="M-8 -10 Q0 -4 8 -10" fill="none" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/>`,
    `<circle cx="-34" cy="-16" r="7" fill="#FFB3B3" opacity="0.6"/>`,
    `<circle cx="34" cy="-16" r="7" fill="#FFB3B3" opacity="0.6"/>`,
    `</g></svg>`,
  ].join('');
}

const PET_KEY = /^builtin\/pet\/(cat|dog|rabbit)-([123])-(baby|junior|adult)\.svg$/;

/** 按 key 画出内置素材（SVG 文本）；不认识的 key 返回 null。 */
export function renderBuiltinSvg(storageKey: string): Buffer | null {
  const m = PET_KEY.exec(storageKey);
  if (!m) return null;
  return Buffer.from(draw(m[1] as Species, Number(m[2]) as 1 | 2 | 3, m[3] as Stage), 'utf8');
}
