/** Link request lifetimes without newer AbortSignal.any/timeout APIs (older Android WebView/Safari). */
export function linkedAbort(
  signals: readonly (AbortSignal | undefined)[],
  timeoutMs?: number,
): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const listeners: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  function dispose() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    for (const remove of listeners.splice(0)) remove();
  }
  function abort(reason: unknown) {
    controller.abort(reason);
    dispose();
  }
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      abort(signal.reason);
      break;
    }
    const listener = () => abort(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
    listeners.push(() => signal.removeEventListener('abort', listener));
  }
  if (!controller.signal.aborted && timeoutMs !== undefined)
    timer = setTimeout(
      () => abort(new DOMException('Request timed out', 'TimeoutError')),
      timeoutMs,
    );
  return { signal: controller.signal, dispose };
}
