import { z } from 'zod';
import { ExtractedMemory, healthPrivate } from './memory.js';

export type CallMemoryRejection =
  'source_unavailable' | 'invalid_source_reference' | 'restricted_content';
export class CallMemoryRejected extends Error {
  constructor(readonly reason: CallMemoryRejection) {
    super('call_memory_rejected');
  }
}

// Stored results remain strict. Extra provider metadata is stripped only at the input boundary.
export const CallMemoryResult = ExtractedMemory.extend({
  episode: z.string().max(120),
  ignoredOperations: z.number().int().min(0).max(20).default(0),
});
const Envelope = z.object({
  operations: z.array(z.unknown()).max(20),
  episode: z.string().max(120),
});
const Operation = z.object(ExtractedMemory.shape.operations.element.shape);

/** Preserve independently valid facts; never infer the meaning of an unsupported action. */
export function parseCallMemoryResult(
  raw: unknown,
  sourceId: string,
): z.infer<typeof CallMemoryResult> {
  const envelope = Envelope.parse(raw);
  const operations: z.infer<typeof Operation>[] = [];
  let ignoredOperations = 0;
  if (healthPrivate(envelope.episode)) throw new CallMemoryRejected('restricted_content');
  for (const item of envelope.operations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      ignoredOperations++;
      continue;
    }
    const candidate = item as Record<string, unknown>;
    // Apply privacy/provenance barriers even to an otherwise malformed operation.
    if (typeof candidate.content === 'string' && healthPrivate(candidate.content))
      throw new CallMemoryRejected('restricted_content');
    if (
      Array.isArray(candidate.sourceMessageIds) &&
      candidate.sourceMessageIds.some((id) => id !== sourceId)
    )
      throw new CallMemoryRejected('invalid_source_reference');
    const action =
      typeof candidate.action === 'string'
        ? candidate.action.trim().toUpperCase()
        : candidate.action;
    // A no-op has no payload to save and does not need invented content or source IDs.
    if (action === 'NOOP') continue;
    const parsed = Operation.safeParse({ ...candidate, action });
    if (!parsed.success || (parsed.data.action !== 'ADD' && !parsed.data.memoryId)) {
      ignoredOperations++;
      continue;
    }
    operations.push(parsed.data);
  }
  return { operations, episode: envelope.episode, ignoredOperations };
}

export function callMemoryOutputInstruction(sourceId: string): string {
  return `只输出一个JSON对象，顶层只有operations和episode。operations为数组，action字段只能是ADD、UPDATE、MARK_PAST、NOOP，不要使用其他操作名。没有可记录事实时输出空数组。ADD省略memoryId；UPDATE和MARK_PAST必须填写已有记忆的memoryId。每条有效操作只含action、content、category、importance、sourceMessageIds，以及可选的memoryId、dueAt、sharingClass，不要增加解释字段。sourceMessageIds只能是["${sourceId}"]。episode为不超过120字的共同经历，无需记录时为空字符串。结构示例（占位内容不要作为事实）：{"operations":[{"action":"ADD","content":"用户明确说过的事实","category":"preference","importance":5,"sourceMessageIds":["${sourceId}"]}],"episode":""}。`;
}
