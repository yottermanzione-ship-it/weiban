import { estimateTokens } from '../infra/text-adapter.js';

/**
 * 假上游的「前缀缓存」模拟（v3.6，docs/refactor/09 第 6 节）：同一用户 + 角色 + 用途记住上一次发出的请求，
 * 与这次比最长相同开头，按 64 token 一块向下取整算作命中（与 DeepSeek 的块粒度同量级）。只在开发 / 测试用，
 * 让本机也能看到请求结构改动对缓存命中率的影响。
 */
const fakePrefixCache = new Map<string, string>();
export function simulatePrefixCache(
  key: string,
  wire: { role: string; content: string }[],
): { total: number; cached: number } {
  const serialized = wire.map((m) => `<${m.role}>${m.content}`).join('\n');
  const previous = fakePrefixCache.get(key) ?? '';
  let i = 0;
  const max = Math.min(previous.length, serialized.length);
  while (i < max && previous.charCodeAt(i) === serialized.charCodeAt(i)) i++;
  if (fakePrefixCache.size > 5000) fakePrefixCache.clear();
  fakePrefixCache.set(key, serialized);
  const total = estimateTokens(serialized);
  const cached =
    i > 0 ? Math.min(total, Math.floor(estimateTokens(serialized.slice(0, i)) / 64) * 64) : 0;
  return { total, cached };
}
