/**
 * 小V同学知识库：仓库内版本化的数据文件（data/knowledge-base.json），启动时校验加载。
 * 维护方式已定：暂时找 Muse 改，不做后台入口。改完须跑知识库单测（匹配、占位符、未知口径）。
 *
 * 两条回答路径（见 engine）：
 * - deterministic + answer 模板可渲染 → 直接按模板答，不调模型（数字只来自简报占位符，不编）；
 * - guidance / unknown / 无匹配 → 走 small_v 模型，guidance 与未知口径作为提示词事实注入。
 * 模板占位符缺值时渲染返回 null，调用方自动降级走模型路径（不得带空值硬答）。
 */
import { z } from 'zod';
import kbJson from '../data/knowledge-base.json';

const KnowledgeBaseEntrySchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  keywords: z.array(z.string().min(1)).min(1),
  deterministic: z.boolean(),
  answer: z.string().min(1).nullable(),
  guidance: z.string().min(1).optional(),
  unknown: z.boolean().optional().default(false),
});
export type KnowledgeBaseEntry = z.infer<typeof KnowledgeBaseEntrySchema>;

const KnowledgeBaseFileSchema = z.object({
  version: z.number().int().positive(),
  updatedAt: z.string().min(1),
  source: z.string().min(1),
  entries: z.array(KnowledgeBaseEntrySchema).min(1),
});
export type KnowledgeBaseFile = z.infer<typeof KnowledgeBaseFileSchema>;

/** 启动时校验：数据文件格式不对直接抛错、拒绝启动（静默上线一条错知识库比报错更糟）。 */
export function loadKnowledgeBase(): KnowledgeBaseFile {
  const parsed = KnowledgeBaseFileSchema.safeParse(kbJson);
  if (!parsed.success)
    throw new Error(
      `小V知识库数据文件格式不正确：${parsed.error.issues.map((i) => i.path.join('.')).join('、')}`,
    );
  const ids = new Set<string>();
  for (const entry of parsed.data.entries) {
    if (ids.has(entry.id)) throw new Error(`小V知识库条目 ID 重复：${entry.id}`);
    ids.add(entry.id);
    if (entry.deterministic && !entry.answer)
      throw new Error(`小V知识库确定性条目缺少 answer：${entry.id}`);
    if (!entry.deterministic && !entry.guidance)
      throw new Error(`小V知识库模型条目缺少 guidance：${entry.id}`);
  }
  return parsed.data;
}

/** 归一化：全半角统一、小写、去空白与标点，只留字母数字汉字（与旧版关键词匹配同口径）。 */
export function normalizeQuestion(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function keywordScore(normalized: string, keyword: string): number {
  const needle = normalizeQuestion(keyword);
  if (!needle) return 0;
  return normalized.includes(needle) ? needle.length : 0;
}

/**
 * 关键词匹配：取总分最高的一条；同分时确定性条目优先、文件顺序优先。
 * 停用（enabled=false）的条目永不命中。无命中返回 null（调用方走通用模型路径）。
 */
export function matchEntry(
  kb: KnowledgeBaseFile,
  text: string,
): { entry: KnowledgeBaseEntry; score: number } | null {
  const normalized = normalizeQuestion(text);
  if (!normalized) return null;
  let best: { entry: KnowledgeBaseEntry; score: number } | null = null;
  for (const entry of kb.entries) {
    if (!entry.enabled) continue;
    // 计分取最长命中关键词的长度（不累加）：重叠关键词（如 pro / pro+）不得重复计分，
    // 否则泛条目会压过更具体的条目。
    const score = entry.keywords.reduce(
      (best, kw) => Math.max(best, keywordScore(normalized, kw)),
      0,
    );
    if (score <= 0) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && entry.deterministic && !best.entry.deterministic)
    )
      best = { entry, score };
  }
  return best;
}

/** 模板占位符白名单：只允许简报事实，模板里出现白名单外的占位符直接渲染失败（防错写）。 */
const TEMPLATE_FACT_KEYS = new Set([
  'pointsBalance',
  'contactCount',
  'contactLimit',
  'membershipTier',
  'membershipExpiresAt',
  'membershipPlans',
  'rechargeTiers',
  'signupBonus',
]);
export type TemplateFacts = Record<string, string | null | undefined>;

/**
 * 渲染确定性答案：占位符逐个替换；任一占位符缺值（null/undefined）或不在白名单 → 返回 null，
 * 调用方降级走模型路径并在提示词里注明“该项没查到”。绝不输出带空占位符的半成品。
 */
export function renderAnswer(entry: KnowledgeBaseEntry, facts: TemplateFacts): string | null {
  if (!entry.answer) return null;
  let missing = false;
  const rendered = entry.answer.replace(/\{\{(\w+)\}\}/g, (_whole, key: string) => {
    if (!TEMPLATE_FACT_KEYS.has(key)) {
      missing = true;
      return '';
    }
    const value = facts[key];
    if (value === null || value === undefined || value === '') {
      missing = true;
      return '';
    }
    return value;
  });
  return missing ? null : rendered;
}
