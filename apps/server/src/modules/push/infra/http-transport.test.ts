import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
  agentOptions: undefined as unknown,
  mode: 'success' as 'success' | 'hang' | 'oversize' | 'stalled',
}));
vi.mock('node:dns/promises', () => ({ lookup: fixture.lookup }));
vi.mock('node:https', () => ({
  Agent: class {
    constructor(options: unknown) {
      fixture.agentOptions = options;
    }
    destroy() {}
  },
  request: fixture.request,
}));
import { PushHttpTransport } from './http-transport.js';
const input = {
  url: new URL('https://fcm.googleapis.com/fcm/send/fixture'),
  headers: {},
  body: Buffer.from('ciphertext'),
};
beforeEach(() => {
  fixture.lookup.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  fixture.request.mockReset().mockImplementation((_url, _options, respond) => {
    const req = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (error: Error) => void;
    };
    req.destroy = (error) => {
      req.emit('error', error);
      req.emit('close');
    };
    req.end = () => {
      if (fixture.mode === 'hang') return;
      const response = new EventEmitter() as EventEmitter & { statusCode: number };
      response.statusCode = 201;
      respond(response);
      queueMicrotask(() => {
        response.emit('data', Buffer.alloc(fixture.mode === 'oversize' ? 4097 : 2, 65));
        if (fixture.mode === 'success') {
          response.emit('end');
          req.emit('close');
        }
      });
    };
    return req;
  });
  fixture.mode = 'success';
});
afterEach(() => {
  vi.useRealTimers();
});
it('公共DNS地址固定在此次HTTPS连接，TLS原主机及禁止重定向由原生request保持', async () => {
  expect(await new PushHttpTransport().post(input)).toEqual({ status: 201, body: 'AA' });
  expect(fixture.request.mock.calls[0]![0]).toEqual(input.url);
  const options = fixture.request.mock.calls[0]![1];
  expect(options.family).toBe(4);
  expect(options.rejectUnauthorized).toBeUndefined();
  const agent = fixture.agentOptions as {
    lookup: (host: string, options: unknown, callback: (...args: unknown[]) => void) => void;
  };
  const callback = vi.fn();
  agent.lookup('fcm.googleapis.com', {}, callback);
  expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
});
it('私网/混合DNS与非HTTPS在任何网络请求前拒绝', async () => {
  fixture.lookup.mockResolvedValue([
    { address: '8.8.8.8', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]);
  await expect(new PushHttpTransport().post(input)).rejects.toThrow('push_private_address');
  await expect(
    new PushHttpTransport().post({ ...input, url: new URL('http://fcm.googleapis.com/fixture') }),
  ).rejects.toThrow('push_https_required');
  expect(fixture.request).not.toHaveBeenCalled();
});
it('DNS限1秒、连接和缓慢响应总预算1.5秒、回包大于4KiB拒绝', async () => {
  vi.useFakeTimers();
  fixture.lookup.mockImplementation(() => new Promise(() => {}));
  const dns = expect(new PushHttpTransport().post(input)).rejects.toThrow('push_dns_timeout');
  await vi.advanceTimersByTimeAsync(1000);
  await dns;
  expect(fixture.request).not.toHaveBeenCalled();
  fixture.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  for (const mode of ['hang', 'stalled'] as const) {
    fixture.mode = mode;
    const pending = expect(new PushHttpTransport().post(input)).rejects.toThrow(
      'push_request_timeout',
    );
    await vi.advanceTimersByTimeAsync(1500);
    await pending;
  }
  fixture.mode = 'oversize';
  await expect(new PushHttpTransport().post(input)).rejects.toThrow('push_response_too_large');
  expect(vi.getTimerCount()).toBe(0);
});
