/**
 * 日志上下文：同一个请求 / 事件 / 任务里的所有日志自动带上 requestId、eventId、jobId、userId
 * （engineering-standards.md 第 6 节第 1 条）。基于 Node 的 AsyncLocalStorage，异步调用链里自动传递。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  requestId?: string;
  eventId?: string;
  jobId?: string;
  userId?: string;
  module?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/** 在给定上下文中运行 fn；嵌套调用时继承外层字段。 */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  const parent = storage.getStore();
  return storage.run({ ...parent, ...context }, fn);
}

/** 当前上下文（没有时返回空对象）。 */
export function currentLogContext(): LogContext {
  return storage.getStore() ?? {};
}

/** 给当前上下文补字段（例如鉴权守卫识别出 userId 后）。不在任何上下文中时什么也不做。 */
export function setLogContextField<K extends keyof LogContext>(key: K, value: LogContext[K]): void {
  const store = storage.getStore();
  if (store) store[key] = value;
}
