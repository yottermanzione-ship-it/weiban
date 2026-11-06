import { afterEach, expect, it, vi } from 'vitest';
import { linkedAbort } from '../src/abort-signals.js';

afterEach(() => vi.useRealTimers());

it('forwards an already cancelled lifetime and installs no deadline', () => {
  vi.useFakeTimers();
  const lifetime = new AbortController();
  lifetime.abort(new DOMException('cancelled', 'AbortError'));
  const linked = linkedAbort([lifetime.signal], 100);
  expect(linked.signal.aborted).toBe(true);
  expect(linked.signal.reason).toBe(lifetime.signal.reason);
  expect(vi.getTimerCount()).toBe(0);
});

it('either owner or request cancellation aborts once and removes listeners from both', () => {
  for (const cancelOwner of [true, false]) {
    const owner = new AbortController();
    const request = new AbortController();
    const removeOwner = vi.spyOn(owner.signal, 'removeEventListener');
    const removeRequest = vi.spyOn(request.signal, 'removeEventListener');
    const linked = linkedAbort([owner.signal, request.signal]);
    const observed = vi.fn();
    linked.signal.addEventListener('abort', observed);
    (cancelOwner ? owner : request).abort();
    expect(linked.signal.aborted).toBe(true);
    expect(removeOwner).toHaveBeenCalledTimes(1);
    expect(removeRequest).toHaveBeenCalledTimes(1);
    (cancelOwner ? request : owner).abort();
    expect(observed).toHaveBeenCalledTimes(1);
  }
});

it('a completed operation removes the deadline and no longer follows its old owner', () => {
  vi.useFakeTimers();
  const owner = new AbortController();
  const linked = linkedAbort([owner.signal], 100);
  linked.dispose();
  linked.dispose();
  owner.abort();
  vi.advanceTimersByTime(100);
  expect(linked.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('timeouts keep their distinct error and remove owner listeners', () => {
  vi.useFakeTimers();
  const owner = new AbortController();
  const removed = vi.spyOn(owner.signal, 'removeEventListener');
  const linked = linkedAbort([owner.signal], 20_000);
  vi.advanceTimersByTime(19_999);
  expect(linked.signal.aborted).toBe(false);
  vi.advanceTimersByTime(1);
  expect(linked.signal.reason).toMatchObject({ name: 'TimeoutError' });
  expect(removed).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
