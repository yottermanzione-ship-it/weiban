import { z } from 'zod';
import { MemoryEntry } from '@weiban/contracts';
export const MemoryPayload = MemoryEntry.omit({
  memoryId: true,
  characterId: true,
  scope: true,
  knownBy: true,
  createdAt: true,
  updatedAt: true,
  origin: true,
}).strict();
export type MemoryPayload = z.infer<typeof MemoryPayload>;
export const ExtractedMemory = z.strictObject({
  operations: z
    .array(
      z.strictObject({
        action: z.enum(['ADD', 'UPDATE', 'MARK_PAST', 'NOOP']),
        memoryId: z.uuid().optional(),
        content: z.string().trim().min(1).max(1000),
        category: MemoryPayload.shape.category,
        importance: MemoryPayload.shape.importance,
        dueAt: MemoryPayload.shape.dueAt.optional(),
        sourceMessageIds: z.array(z.uuid()).min(1).max(20),
        sharingClass: MemoryPayload.shape.sharingClass.optional(),
      }),
    )
    .max(20),
  summary: z.string().max(2000).optional(),
});
export type ExtractedOperation = z.infer<typeof ExtractedMemory>['operations'][number];

/**
 * 批 EJ：从没写完的记忆整理 JSON 里救出已经完整的 operations 条目（逐条校验，不合格的丢弃）。
 * 只认 `"operations": [` 之后、在顶层闭合的对象；写到一半的最后一条、summary 一律不要。
 * 不解释任何聊天内容，也不把正文写进日志。
 */
export function salvageOperations(partial: string): ExtractedOperation[] {
  const key = /"operations"\s*:\s*\[/u.exec(partial);
  if (!key) return [];
  const item = ExtractedMemory.shape.operations.element;
  const out: ExtractedOperation[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = key.index + key[0].length; i < partial.length && out.length < 20; i++) {
    const ch = partial[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') {
      if (depth === 0 && ch === '{') start = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
      if (depth === 0) break; // operations 数组本身结束
      depth--;
      if (depth === 0 && ch === '}' && start >= 0) {
        try {
          const parsed = item.safeParse(JSON.parse(partial.slice(start, i + 1)));
          if (parsed.success) out.push(parsed.data);
        } catch {
          // 单条坏掉就跳过这一条
        }
        start = -1;
      }
    }
  }
  return out;
}

/** 经期健康数据不能进入角色长期记忆或摘要。 */
export function healthPrivate(text: string): boolean {
  return /月经|生理期|经期|来姨妈|姨妈来了|排卵|痛经|menstrual|menstruation/iu.test(text);
}
export function sharingClass(
  content: string,
  proposed: MemoryPayload['sharingClass'] = 'never',
): MemoryPayload['sharingClass'] {
  return /秘密|别告诉|只跟你说|密码|地址|手机|电话|身份证|性行为|做爱|裸照|过敏|病|药/u.test(
    content,
  )
    ? 'never'
    : proposed;
}
export function memoryTerms(text: string): Set<string> {
  const normalized = text.toLocaleLowerCase().normalize('NFKC');
  const terms = new Set(normalized.match(/[a-z0-9]{2,}/gu) ?? []);
  for (const run of normalized.match(/[\p{Script=Han}]+/gu) ?? [])
    for (let i = 0; i < run.length - 1; i++) terms.add(run.slice(i, i + 2));
  return terms;
}
export function relevance(
  content: string,
  query: string,
  importance: number,
  ageMs: number,
): number {
  const terms = memoryTerms(content);
  const wanted = memoryTerms(query);
  const overlap = [...wanted].filter((term) => terms.has(term)).length;
  return (
    (wanted.size ? overlap / wanted.size : 0) * 0.7 +
    (importance / 10) * 0.2 +
    Math.exp(-Math.max(0, ageMs) / (30 * 86400000)) * 0.1
  );
}

export type MemorySharingLevel = 'off' | 'basic' | 'friends';
/** MEM-07 第 2 条「永不共享类别」：健康身体、心理情绪、感情私事、家庭矛盾、经济状况。规则直接判，模型无法改写。 */
const NEVER_SHARE =
  /焦虑|抑郁|难过|崩溃|哭了|压力|情绪|心情不好|失恋|分手|恋爱|男朋友|女朋友|老公|老婆|暧昧|喜欢的人|吵架|离婚|家里.{0,4}(?:矛盾|闹)|父母.{0,4}(?:吵|不和)|欠钱|借钱|工资|存款|负债|贷款|没钱|医院|生病|身体|体检|怀孕|失眠|成人模式/u;
/** MEM-07 第 2 条「可共享类别」：日常近况、兴趣爱好、近期计划（基础资料另算）。 */
const SHAREABLE_CATEGORIES = new Set(['basic', 'preference', 'status', 'commitment']);
/**
 * 跨角色共享闸门（runtime-overview.md 5.5 节）：全部用代码判断，不交给模型。
 * 关系网条件由调用方判断（只把有关系的角色作为来源）。
 */
export function memoryShareable(entry: MemoryEntryLike, level: MemorySharingLevel): boolean {
  if (level === 'off') return false;
  if (entry.visibility === 'only_this_character') return false;
  if (entry.scope !== 'normal' || entry.status !== 'current') return false;
  if (healthPrivate(entry.content) || NEVER_SHARE.test(entry.content)) return false;
  if (sharingClass(entry.content, entry.sharingClass) === 'never') return false;
  if (level === 'basic') return entry.sharingClass === 'basic';
  return SHAREABLE_CATEGORIES.has(entry.category);
}
export interface MemoryEntryLike {
  content: string;
  category: string;
  status: string;
  scope: string;
  visibility: string;
  sharingClass: MemoryPayload['sharingClass'];
}
