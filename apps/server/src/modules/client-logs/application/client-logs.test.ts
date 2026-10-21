/** Implementation fixtures. Run together in the final consolidated self-review. */
import { describe, expect, it } from 'vitest';
import { ClientRuntimeEvent, ClientLogBatch, clientLogRoute } from '@weiban/contracts';
import { safeEvent, fingerprint } from './client-logs.service.js';
const id = '019f7f00-0000-7000-8000-000000000001';
const event = () =>
  ClientRuntimeEvent.parse({
    clientEventId: id,
    sessionId: id,
    occurredAt: '2026-10-22T00:00:00.000Z',
    kind: 'api_failure',
    appKind: 'web',
    version: '1.0.0',
    build: '123',
    page: '/chat/:id',
    code: 'server_error',
    frames: [{ file: 'app.js', line: 1, column: 20, asset: 'abcdef12' }],
    environment: {
      os: 'android',
      browser: 'chrome',
      major: 120,
      screen: 'small',
      language: 'zh',
      network: 'wifi',
    },
    count: 1,
    api: {
      route: '/api/v1/conversations/:id/messages',
      method: 'POST',
      status: 500,
      durationMs: 20,
      requestId: id,
    },
  });
describe('client diagnostics privacy boundary', () => {
  it('rejects raw exception, chat, device and network payloads instead of trying to redact prose', () => {
    for (const key of [
      'message',
      'stack',
      'input',
      'body',
      'headers',
      'phone',
      'email',
      'deviceId',
      'token',
    ])
      expect(
        ClientRuntimeEvent.safeParse({ ...event(), [key]: 'CANARY_PRIVATE_VALUE' }).success,
      ).toBe(false);
    expect(
      ClientRuntimeEvent.safeParse({
        ...event(),
        environment: { ...event().environment, deviceId: 'CANARY_DEVICE' },
      }).success,
    ).toBe(false);
    expect(
      ClientRuntimeEvent.safeParse({ ...event(), api: { ...event().api, body: 'CANARY_CHAT' } })
        .success,
    ).toBe(false);
  });
  it('drops unknown paths and all query / fragments on both sides', () => {
    expect(clientLogRoute('/chat/alice@example.com?token=CANARY#private')).toBe('/chat/:id');
    const parsed = event();
    parsed.page = '/chat/private-name';
    parsed.api!.route = '/api/v1/conversations/private-name/messages';
    expect(safeEvent(parsed)).toMatchObject({
      page: '/chat/:id',
      api: { route: '/api/v1/conversations/:id/messages' },
    });
    expect(
      ClientRuntimeEvent.safeParse({ ...event(), page: '/chat/:id?token=CANARY' }).success,
    ).toBe(false);
  });
  it('accepts only fixed error classes, bounded coordinates and short code identifiers', () => {
    expect(ClientRuntimeEvent.safeParse({ ...event(), code: 'CANARY_CHAT' }).success).toBe(false);
    expect(
      ClientRuntimeEvent.safeParse({
        ...event(),
        frames: [{ file: 'app.js', line: 1, column: 1, asset: 'file-with-user-email.js' }],
      }).success,
    ).toBe(false);
    expect(ClientRuntimeEvent.safeParse({ ...event(), components: ['CANARY_NAME'] }).success).toBe(
      false,
    );
    expect(
      ClientLogBatch.safeParse({
        sessionId: id,
        appKind: 'web',
        version: '1.0.0',
        build: '123',
        events: Array.from({ length: 21 }, event),
      }).success,
    ).toBe(false);
  });
  it('groups the technical problem across times / versions but separates code locations and routes', () => {
    const before = event();
    const after = {
      ...event(),
      count: 5,
      version: '2.0.0',
      occurredAt: '2026-10-22T01:00:00.000Z',
    };
    expect(fingerprint(before)).toBe(fingerprint(after));
    expect(
      fingerprint({
        ...before,
        frames: [{ file: 'app.js', line: 2, column: 20, asset: 'abcdef12' }],
      }),
    ).not.toBe(fingerprint(before));
    expect(
      fingerprint({ ...before, api: { ...before.api!, route: '/api/v1/me/profile' } }),
    ).not.toBe(fingerprint(before));
  });
});
