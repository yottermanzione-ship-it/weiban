import { z } from 'zod';
import { MemoryEntry } from '@weiban/contracts';
export const MemoryPayload = MemoryEntry.omit({
  memoryId: true,
  characterId: true,
  scope: true,
  knownBy: true,
  createdAt: true,
  updatedAt: true,
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
