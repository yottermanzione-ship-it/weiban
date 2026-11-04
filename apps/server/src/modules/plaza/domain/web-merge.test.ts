/**
 * 联网候选按实体合并（T-20261104e）与同名零误合并的固定语料。全部自造数据：
 * 30 个常见同名（每组 2～4 位不同的人），每人有百科条目、手机版 / 带参数的同一条目、部分维基条目和普通新闻页。
 * 「误合并」= 合并出来的一项里出现了不止一个人的出处。结果打印在测试输出里（写进交接）。
 */
import { describe, expect, it } from 'vitest';
import type {
  CharacterSearchEntity,
  WebCharacterCandidate,
  WebSearchResultItem,
} from '@weiban/contracts';
import { structureCandidates } from '../../model-access/testing.js';
import { mergeWebCandidates } from './site-search.js';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const candidate = (patch: Partial<WebCharacterCandidate>): WebCharacterCandidate => ({
  candidateId: 'web_AAAAAAAAAAAAAAAAAAAAAA',
  name: '李晨',
  title: '李晨（中国内地男演员）_百度百科',
  description: '李晨，中国内地男演员。',
  identity: '中国内地男演员',
  identitySourceUrl: 'https://baike.baidu.com/item/x/1001',
  sources: [{ url: 'https://baike.baidu.com/item/x/1001', title: '李晨', site: '百度百科' }],
  identifiers: ['baike:1001'],
  ...patch,
});

describe('联网候选按实体合并', () => {
  it('没有后台登记的实体：同名各自一项，标 ambiguous，未核实，不给官方角色', () => {
    const merged = mergeWebCandidates(
      [
        candidate({}),
        candidate({
          candidateId: 'web_BBBBBBBBBBBBBBBBBBBBBB',
          identity: '服装设计师',
          identifiers: ['baike:2002'],
          sources: [{ url: 'https://baike.baidu.com/item/x/2002', title: '李晨', site: null }],
        }),
      ],
      [],
    );
    expect(merged).toHaveLength(2);
    expect(merged.every((m) => m.ambiguous && m.unverified && m.characterIds.length === 0)).toBe(
      true,
    );
    expect(merged.map((m) => m.entityKey)).toEqual(['baike:1001', 'baike:2002']);
  });

  it('后台把两个标识登记到同一实体：并成一项，用核实的身份与显示名，给出关联的官方角色', () => {
    const entity: CharacterSearchEntity = {
      entityKey: 'manual:00000000-0000-4000-8000-0000000000aa',
      displayName: '李晨',
      identity: '演员、主持人',
      sources: [{ url: 'https://example.org/official', title: '官方资料', site: null }],
      identifiers: ['baike:1001', 'wiki:zh:李晨'],
      characterIds: [ID(1)],
    };
    const merged = mergeWebCandidates(
      [
        candidate({}),
        candidate({
          candidateId: 'web_CCCCCCCCCCCCCCCCCCCCCC',
          identifiers: ['wiki:zh:李晨'],
          sources: [{ url: 'https://zh.wikipedia.org/wiki/x', title: '李晨', site: null }],
        }),
        candidate({
          candidateId: 'web_BBBBBBBBBBBBBBBBBBBBBB',
          identity: '服装设计师',
          identifiers: ['baike:2002'],
          sources: [{ url: 'https://baike.baidu.com/item/x/2002', title: '李晨', site: null }],
        }),
      ],
      [entity],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      entityKey: entity.entityKey,
      identity: '演员、主持人',
      identitySourceUrl: 'https://example.org/official',
      unverified: false,
      characterIds: [ID(1)],
    });
    expect(merged[0]!.sources.map((s) => s.url)).toEqual([
      'https://baike.baidu.com/item/x/1001',
      'https://example.org/official',
      'https://zh.wikipedia.org/wiki/x',
    ]);
    // 另一位同名李晨不受影响。
    expect(merged[1]).toMatchObject({
      entityKey: 'baike:2002',
      characterIds: [],
      unverified: true,
    });
  });

  it('实体没填核实身份：仍算未核实，用公开资料摘出的身份', () => {
    const merged = mergeWebCandidates(
      [candidate({})],
      [
        {
          entityKey: 'baike:1001',
          displayName: '李晨',
          identity: null,
          sources: [],
          identifiers: ['baike:1001'],
          characterIds: [ID(1)],
        },
      ],
    );
    expect(merged[0]).toMatchObject({
      unverified: true,
      identity: '中国内地男演员',
      characterIds: [ID(1)],
    });
  });
});

// ---------- 固定语料：同名零误合并 ----------

const NAMES = [
  '李晨',
  '王伟',
  '张伟',
  '刘洋',
  '陈晨',
  '杨洋',
  '王芳',
  '李娜',
  '张杰',
  '刘伟',
  '黄磊',
  '周杰',
  '吴昊',
  '赵磊',
  '孙丽',
  '朱琳',
  '胡歌手',
  '郭靖',
  '林峰',
  '何洁',
  '高远',
  '罗兰',
  '梁静',
  '宋佳',
  '谢娜',
  '韩雪',
  '唐嫣然',
  '冯远',
  '董洁',
  '萧然',
];
const ROLES = ['中国内地男演员', '服装设计师', '流行歌手', '职业篮球运动员'];

interface Page {
  person: string;
  hit: WebSearchResultItem;
  identifier: string | null;
}

function corpus(): { groups: Array<{ name: string; pages: Page[]; persons: string[] }> } {
  return {
    groups: NAMES.map((name, g) => {
      const people = 2 + (g % 3);
      const pages: Page[] = [];
      const persons: string[] = [];
      for (let p = 0; p < people; p += 1) {
        const person = `${g}-${p}`;
        persons.push(person);
        const role = ROLES[p % ROLES.length]!;
        const baike = 10_000 + g * 10 + p;
        const encoded = encodeURIComponent(name);
        pages.push({
          person,
          identifier: `baike:${baike}`,
          hit: {
            title: `${name}（${role}）_百度百科`,
            url: `https://baike.baidu.com/item/${encoded}/${baike}`,
            snippet: `${name}，${role}，代表作品《作品${g}-${p}》。`,
            source: '百度百科',
            publishedAt: null,
          },
        });
        // 同一条目的手机版 / 带参数地址：应合并。
        pages.push({
          person,
          identifier: `baike:${baike}`,
          hit: {
            title: `${name}_百度百科`,
            url: `https://m.baike.baidu.com/item/${encoded}/${baike}?fr=aladdin`,
            snippet: `${name}是${role}。`,
            source: null,
            publishedAt: null,
          },
        });
        if (p % 2 === 0)
          pages.push({
            person,
            identifier: `wiki:zh:${name}_(${role})`,
            hit: {
              title: `${name} (${role}) - 维基百科，自由的百科全书`,
              url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(`${name}_(${role})`)}`,
              snippet: `${name}，${role}。`,
              source: null,
              publishedAt: null,
            },
          });
        // 普通新闻页：同名、同头像也不算证据。
        pages.push({
          person,
          identifier: null,
          hit: {
            title: `${name}出席活动 - 新闻`,
            url: `https://news.example.com/${g}/${p}`,
            snippet: `${role}${name}昨日出席公开活动。`,
            source: null,
            publishedAt: null,
          },
        });
      }
      return { name, pages, persons };
    }),
  };
}

/** 供应商一次最多给 5 条：把一组的网页按固定顺序（人交错）切成 5 条一批。 */
function windows(pages: Page[]): Page[][] {
  const byPerson = new Map<string, Page[]>();
  for (const page of pages) byPerson.set(page.person, [...(byPerson.get(page.person) ?? []), page]);
  const order: Page[] = [];
  const queues = [...byPerson.values()];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) order.push(q.shift()!);
  const out: Page[][] = [];
  for (let i = 0; i < order.length; i += 5) out.push(order.slice(i, i + 5));
  // 再加一批「同一人的两个地址」相邻的，检验同标识合并。
  for (const q of byPerson.values()) out.push(q.slice(0, 2));
  return out;
}

describe('同名零误合并（固定语料）', () => {
  it('只有同一公开资料标识或后台登记的实体才合并；名字相同的不同人一次也不合并', () => {
    const { groups } = corpus();
    let batches = 0;
    let outputs = 0;
    let wrong = 0;
    let expectedMerges = 0;
    let merged = 0;
    let entityBatches = 0;
    let entityWrong = 0;
    let entityMerged = 0;
    let entityExpected = 0;
    let pagesTotal = 0;
    let persons = 0;
    for (const group of groups) {
      pagesTotal += group.pages.length;
      persons += group.persons.length;
      const owner = new Map(group.pages.map((p) => [p.hit.url, p] as const));
      const ownerOf = (url: string) =>
        [...owner.entries()].find(([raw]) => new URL(raw).toString() === url)?.[1];
      // 后台为每组第一位登记实体：把他的百科条目和维基条目归到一起（人工核实过的同一人）。
      const first = group.persons[0]!;
      const firstIds = [
        ...new Set(
          group.pages.filter((p) => p.person === first && p.identifier).map((p) => p.identifier!),
        ),
      ];
      const entity: CharacterSearchEntity = {
        entityKey: `manual:00000000-0000-4000-8000-${String(groups.indexOf(group)).padStart(12, '0')}`,
        displayName: group.name,
        identity: ROLES[0]!,
        sources: [],
        identifiers: firstIds,
        characterIds: [ID(groups.indexOf(group) + 1)],
      };
      for (const batch of windows(group.pages)) {
        batches += 1;
        const structured = structureCandidates(
          group.name,
          batch.map((p) => p.hit),
        );
        // 期望：同一批里同一标识的网页合并成一项。
        const ids = new Map<string, number>();
        for (const p of batch)
          if (p.identifier) ids.set(p.identifier, (ids.get(p.identifier) ?? 0) + 1);
        expectedMerges += [...ids.values()].filter((n) => n > 1).length;
        for (const item of structured) {
          outputs += 1;
          const people = new Set(item.sources.map((s) => ownerOf(s.url)?.person));
          if (people.size > 1) wrong += 1;
          if (item.sources.length > 1 && people.size === 1) merged += 1;
          expect(people.has(undefined)).toBe(false);
        }
        // 再按实体合并（模拟后台登记过第一位）。
        entityBatches += 1;
        const withEntity = mergeWebCandidates(structured, [entity]);
        const firstHits = new Set(
          structured
            .filter((c) => c.identifiers.some((id) => firstIds.includes(id)))
            .map((c) => c.candidateId),
        );
        if (firstHits.size > 1) entityExpected += 1;
        for (const item of withEntity) {
          const people = new Set(item.sources.map((s) => ownerOf(s.url)?.person).filter(Boolean));
          if (people.size > 1) entityWrong += 1;
          if (item.entityKey === entity.entityKey && firstHits.size > 1) entityMerged += 1;
          // 只有登记的那位才带官方角色。
          if (item.characterIds.length) expect([...people]).toEqual([first]);
        }
      }
    }
    console.info(
      [
        `[web-candidates] 同名语料 ${groups.length} 组（${persons} 位不同的人，${pagesTotal} 个网页），供应商批次 ${batches}，候选 ${outputs} 项`,
        `[web-candidates] 同名误合并 ${wrong}（${((wrong / outputs) * 100).toFixed(1)}%）；同一标识应合并 ${expectedMerges} 处，实际合并 ${merged} 处`,
        `[web-candidates] 叠加后台实体后：批次 ${entityBatches}，误合并 ${entityWrong}；百科 + 维基跨标识应合并 ${entityExpected} 处，实际 ${entityMerged} 处`,
      ].join('\n'),
    );
    expect(wrong).toBe(0);
    expect(entityWrong).toBe(0);
    expect(merged).toBe(expectedMerges);
    expect(entityMerged).toBe(entityExpected);
  });
});
