import type { ChatMessageForModel, ModelContextBudget } from '@weiban/contracts';

/** 输入保护与计费估算分开：保守按 UTF-8 两字节一 token，附图额外预留。 */
export function contextTokens(
  messages: readonly Pick<ChatMessageForModel, 'content' | 'images'>[],
): number {
  return messages.reduce(
    (n, m) =>
      n + Math.ceil(Buffer.byteLength(m.content, 'utf8') / 2) + 12 + (m.images?.length ?? 0) * 8192,
    0,
  );
}

export function contextBudget(
  modelKey: string,
  profiles: readonly { contextTokens: number; maxOutputTokens: number }[],
  requestedOutput?: number,
): ModelContextBudget | null {
  if (!profiles.length) return null;
  const context = Math.min(...profiles.map((p) => p.contextTokens));
  const output = Math.max(
    ...profiles.map((p) =>
      Math.min(p.maxOutputTokens, requestedOutput ?? p.maxOutputTokens, 32000),
    ),
  );
  const headroom = Math.min(8192, Math.max(512, Math.ceil(context * 0.03)));
  const input = context - output - headroom;
  if (input <= 0) return null;
  return {
    modelKey,
    contextTokens: context,
    reservedOutputTokens: output,
    inputTokens: input,
    triggerTokens: Math.min(input, Math.floor((context - output) * 0.8)),
  };
}

/** 系统头和中间/末尾控制指令不进入总结，最近完整用户往返保留。 */
export function compactablePrefix(
  messages: readonly ChatMessageForModel[],
  retainTokens: number,
): { start: number; end: number } | null {
  const start = messages[0]?.role === 'system' ? 1 : 0;
  let stop = messages.findIndex((m, i) => i >= start && m.role === 'system');
  if (stop < 0) stop = messages.length;
  let used = 0;
  let end = stop;
  for (let i = messages.length - 1; i >= start; i--) {
    used += contextTokens([messages[i]!]);
    if (used >= retainTokens) {
      end = Math.min(end, i);
      break;
    }
    end = Math.min(end, i);
  }
  // 不切在角色回复前，不压掉本轮最后一段用户输入。
  while (end > start && messages[end]?.role !== 'user') end--;
  let lastUser = messages.length - 1;
  while (lastUser >= start && messages[lastUser]?.role !== 'user') lastUser--;
  while (lastUser > start && messages[lastUser - 1]?.role === 'user') lastUser--;
  end = Math.min(end, lastUser);
  if (
    end <= start + 1 ||
    messages.slice(start, end).some((m) => m.role === 'system' || m.images?.length)
  )
    return null;
  return { start, end };
}
