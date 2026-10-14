/**
 * v3.6：系统消息放法（docs/refactor/09-chat-pipeline.md 第 5 节；思路来自爱语「兼容模式」与酒馆
 * 「Squash system messages」）。纯函数，网关发请求前按模型目录的 systemMessageMode 改写消息。
 *
 * - multi：原样。
 * - single_system：第一条（且位于开头的）系统消息保留；其余系统消息改成用户消息并注明来源，
 *   之后相邻的同角色消息合并（部分平台要求 user / assistant 交替）。
 * - no_system：所有系统消息都改成用户消息，再合并。
 *
 * 改写只影响「发出去的样子」，不改变内容顺序，所以前缀缓存照样有效（开头部分每次改写结果相同）。
 */
import type { SystemMessageMode } from '@weiban/contracts';

export interface WireMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

const NOTE_OPEN = '【系统提示，不是用户说的话】\n';

export function asSystemMessageMode(value: string | null | undefined): SystemMessageMode {
  return value === 'single_system' || value === 'no_system' ? value : 'multi';
}

export function applySystemMessageMode<T extends WireMessage>(
  messages: T[],
  mode: SystemMessageMode,
): T[] {
  if (mode === 'multi') return messages;
  const converted = messages.map((m, i) => {
    if (m.role !== 'system') return m;
    if (mode === 'single_system' && i === 0) return m;
    return { ...m, role: 'user' as const, content: `${NOTE_OPEN}${m.content}` };
  });
  // 相邻同角色合并（带图片的消息不合并，避免图片挪位置）
  const out: T[] = [];
  for (const m of converted) {
    const last = out.at(-1);
    if (last && last.role === m.role && last.role !== 'system' && !last.images && !m.images) {
      out[out.length - 1] = { ...last, content: `${last.content}\n\n${m.content}` };
      continue;
    }
    out.push(m);
  }
  return out;
}
