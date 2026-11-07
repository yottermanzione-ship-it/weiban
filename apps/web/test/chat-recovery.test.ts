import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthResponse, SyncEndpoints, WsCloseCode } from '@weiban/contracts';
import { freshSyncState, type ApiClient, type IndexedLocalStore } from '@weiban/client-core';
import { ChatDriver } from '../src/data/chat-driver.js';

vi.mock('../src/data/runtime-logs.js', () => ({ runtimeLogs: { connection: vi.fn() } }));
const id = '11111111-1111-4111-8111-111111111111';
const session = AuthResponse.parse({
  user: {
    userId: id,
    username: 'recovery_fixture',
    role: 'user',
    profileCompleted: true,
    createdAt: '2026-11-05T00:00:00Z',
  },
  session: {
    sessionId: id,
    kind: 'app',
    token: 'synthetic-recovery-session'.padEnd(40, 'x'),
    expiresAt: '2027-01-01T00:00:00Z',
  },
});

/** 只替换传输，真实 ChatDriver + SyncRunner 处理状态；close 故意不完成，模拟握手卡住。 */
class Socket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = Socket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(_url: URL) {
    super();
    Socket.instances.push(this);
  }
  send(_data: string) {}
  close() {
    this.readyState = Socket.CLOSING;
  }
  authenticated() {
    this.readyState = Socket.OPEN;
    this.onopen?.();
    this.onmessage?.({
      data: JSON.stringify({
        v: 1,
        type: 'auth.ok',
        data: {
          userId: id,
          sessionId: id,
          latestUpdateSeq: 0,
          minClientVersion: '2.0',
          serverTime: '2026-11-05T00:00:00Z',
        },
      }),
    });
  }
  closed(code = 1012) {
    this.readyState = Socket.CLOSED;
    this.onclose?.({ code });
    this.dispatchEvent(new Event('close'));
  }
}
let driver: ChatDriver;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
  Socket.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      location: { href: 'https://fixture.invalid/chat' },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    }),
  );
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => {
  driver?.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function start() {
  const state = { ...freshSyncState(), initialized: true };
  const call = vi.fn(async (_endpoint: unknown, _options?: { signal?: AbortSignal }) => ({
    latestUpdateSeq: 0,
  }));
  const forgetIf = vi.fn();
  const connection = vi.fn();
  const error = vi.fn();
  const owns = vi.fn(() => true);
  const api = { owns, call, forgetIf } as unknown as ApiClient;
  const store = {
    get: async () => state,
    setOwned: async () => true,
  } as unknown as IndexedLocalStore;
  driver = new ChatDriver(api, store, session, {
    state: () => {},
    connection,
    error,
    typing: () => {},
  });
  await driver.start();
  Socket.instances.at(-1)!.authenticated();
  await vi.advanceTimersByTimeAsync(1);
  expect(connection).toHaveBeenLastCalledWith(true);
  return { call, forgetIf, connection, error, owns };
}

it('长连接因发布断开后，HTTP对账成功即恢复在线显示，不等新消息或刷新', async () => {
  const { connection, call } = await start();
  Socket.instances[0]!.closed();
  // 后续长连接尚未鉴权；状态序号没有变化，仍必须按成功的 HTTP 路径显示在线。
  await vi.advanceTimersByTimeAsync(5500);
  expect(
    call.mock.calls.filter(([endpoint]) => endpoint === SyncEndpoints.getState).length,
  ).toBeGreaterThan(1);
  expect(connection).toHaveBeenLastCalledWith(true);
});

it('失去心跳且关闭握手不结束时主动换连接，迟到的旧连接不能退出账号', async () => {
  const { forgetIf } = await start();
  const previous = Socket.instances[0]!;
  await vi.advanceTimersByTimeAsync(52_000);
  expect(Socket.instances.length).toBeGreaterThan(1);
  const current = Socket.instances.at(-1)!;
  current.authenticated();
  previous.closed(WsCloseCode.unauthenticated);
  await vi.advanceTimersByTimeAsync(1);
  expect(forgetIf).not.toHaveBeenCalled();
});

it('后台暂停超过请求时限后，卡住的状态读取不会永久挡住后续对账', async () => {
  const { call, connection } = await start();
  let pendingSignal: AbortSignal | undefined;
  call.mockImplementationOnce((_endpoint, options) => {
    pendingSignal = options?.signal;
    // 模拟被冻结的请求尚未结算；驱动须放弃旧轮次，迟到回调也不能改新轮次。
    return new Promise(() => {});
  });
  await vi.advanceTimersByTimeAsync(5000);
  const calls = call.mock.calls.length;
  await vi.advanceTimersByTimeAsync(25_000);
  expect(pendingSignal?.aborted).toBe(true);
  expect(call.mock.calls.length).toBeGreaterThan(calls);
  expect(connection).toHaveBeenLastCalledWith(true);
});

it('真正失效的登录和不兼容版本仍拦截，不借自动恢复绕过验证', async () => {
  const { forgetIf, error } = await start();
  Socket.instances[0]!.closed(WsCloseCode.unauthenticated);
  expect(forgetIf).toHaveBeenCalledWith({ userId: id, sessionId: id });
  driver.stop();
  const second = await start();
  Socket.instances.at(-1)!.closed(WsCloseCode.clientTooOld);
  expect(second.error).toHaveBeenCalledWith('请更新微伴后继续', 'fatal');
  expect(error).not.toHaveBeenCalled();
});

it('连续挂起请求被替换时明确离线，恢复后原页面重新上线', async () => {
  const { call, connection } = await start();
  Socket.instances[0]!.closed();
  call.mockImplementation(() => new Promise(() => {}));
  await vi.advanceTimersByTimeAsync(26_000);
  expect(connection).toHaveBeenLastCalledWith(false);
  call.mockResolvedValue({ latestUpdateSeq: 0 });
  await vi.advanceTimersByTimeAsync(21_000);
  expect(connection).toHaveBeenLastCalledWith(true);
});

it('超时旧轮次的迟到失败不会把已经恢复的页面改回离线', async () => {
  const { call, connection } = await start();
  let rejectPrevious!: (error: Error) => void;
  call.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectPrevious = reject;
      }),
  );
  await vi.advanceTimersByTimeAsync(26_000);
  expect(connection).toHaveBeenLastCalledWith(true);
  rejectPrevious(new Error('obsolete request'));
  await vi.advanceTimersByTimeAsync(1);
  expect(connection).toHaveBeenLastCalledWith(true);
});

it('更新接续失败后恢复聊天，即使旧连接没有完成关闭也能重新鉴权', async () => {
  await start();
  const count = Socket.instances.length;
  const pausing = driver.pause();
  await vi.advanceTimersByTimeAsync(1001);
  await pausing;
  driver.resume();
  await vi.advanceTimersByTimeAsync(1);
  expect(Socket.instances.length).toBe(count + 1);
});

it('从页面缓存唤醒时丢弃过期连接；退出归属后不重建旧账号的连接', async () => {
  const { owns, call } = await start();
  vi.setSystemTime(Date.now() + 60_000);
  window.dispatchEvent(new Event('pageshow'));
  await vi.advanceTimersByTimeAsync(1);
  expect(Socket.instances.length).toBe(2);
  Socket.instances[1]!.authenticated();
  owns.mockReturnValue(false);
  const calls = call.mock.calls.length;
  vi.setSystemTime(Date.now() + 60_000);
  window.dispatchEvent(new Event('pageshow'));
  await vi.advanceTimersByTimeAsync(1001);
  expect(Socket.instances.length).toBe(2);
  expect(call).toHaveBeenCalledTimes(calls);
});
