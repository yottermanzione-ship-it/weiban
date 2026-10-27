import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { AuthResponse, IdentityEndpoints, ClientLogEndpoints } from '@weiban/contracts';
import {
  ApiClient,
  ApiFailure,
  IndexedLocalStore,
  yuanToMicros,
  formatMoney,
} from '../src/index.js';
const id = '11111111-1111-4111-8111-111111111111';
function session(username = 'test_user') {
  return AuthResponse.parse({
    user: {
      userId: username === 'test_user' ? id : '22222222-2222-4222-8222-222222222222',
      username,
      role: 'user',
      profileCompleted: false,
      createdAt: '2026-10-05T12:00:00.000Z',
    },
    session: {
      sessionId: id,
      kind: 'app',
      token: 'CANARY-TOKEN-' + username.padEnd(32, 'x'),
      expiresAt: '2027-01-01T00:00:00.000Z',
    },
  });
}
const store = () => new IndexedLocalStore('weiban-test', new IDBFactory());
it('运行记录观察器仅收到技术模板；不传正文、令牌，且遥测失败不递归', async () => {
  const observer = vi.fn();
  const client = new ApiClient(store(), async () =>
    Response.json(
      { error: { code: 'internal_error', message: 'CANARY_CHAT', requestId: id } },
      { status: 500, headers: { 'x-request-id': id } },
    ),
  );
  client.observeFailures(observer);
  await client.authenticate(session());
  await expect(client.call(IdentityEndpoints.me, { networkOnly: true })).rejects.toBeInstanceOf(
    ApiFailure,
  );
  expect(observer).toHaveBeenCalledTimes(1);
  expect(observer.mock.calls[0]?.[0]).toEqual({
    route: '/api/v1/me',
    method: 'GET',
    status: 500,
    durationMs: expect.any(Number),
    requestId: id,
  });
  expect(JSON.stringify(observer.mock.calls)).not.toContain('CANARY');
  await expect(
    client.call(ClientLogEndpoints.report, {
      body: { sessionId: id, appKind: 'web', version: '1.0.0', build: '123', events: [] },
    }),
  ).rejects.toBeInstanceOf(ApiFailure);
  expect(observer).toHaveBeenCalledTimes(1);
});
it('账号观察器在退出和切换时立即获知归属，观察器故障不影响会话', async () => {
  const owners: Array<string | null> = [];
  const client = new ApiClient(store());
  client.observeOwner((id) => {
    owners.push(id);
  });
  await client.restore();
  await client.authenticate(session());
  await client.authenticate(session('another_user'));
  await client.forget();
  expect(owners).toEqual([null, null, id, null, '22222222-2222-4222-8222-222222222222', null]);
  client.observeOwner(() => {
    throw new Error('telemetry only');
  });
  await expect(client.authenticate(session())).resolves.toBeUndefined();
});
it('保留服务器的错误说明和逐项拒绝原因', async () => {
  const details = { rejected: [{ id, reason: 'health_label' }] };
  const client = new ApiClient(store(), async () =>
    Response.json(
      {
        error: {
          code: 'share_content_not_allowed',
          message: '所选内容不能分享',
          requestId: id,
          details,
        },
      },
      { status: 422 },
    ),
  );
  await client.authenticate(session());
  await expect(
    client.call(IdentityEndpoints.getProfile, { networkOnly: true }),
  ).rejects.toMatchObject({
    code: 'share_content_not_allowed',
    message: '所选内容不能分享',
    status: 422,
    details,
  });
});
it('令牌只存本地库；请求头携带，路径不带；响应先落库；断网从本地读', async () => {
  const db = store();
  const auth = session();
  let offline = false;
  let requested = '';
  let headers = new Headers();
  const client = new ApiClient(db, async (url, init) => {
    if (offline) throw new TypeError('offline');
    requested = String(url);
    headers = new Headers(init?.headers);
    return Response.json(auth.user);
  });
  await client.authenticate(auth);
  expect(await client.call(IdentityEndpoints.me)).toEqual(auth.user);
  expect(headers.get('Authorization')).toBe(`Bearer ${auth.session.token}`);
  expect(requested).not.toContain(auth.session.token);
  expect(await client.cached(IdentityEndpoints.me)).toEqual(auth.user);
  offline = true;
  expect(await client.call(IdentityEndpoints.me)).toEqual(auth.user);
  await client.forget();
  expect(await db.get('session')).toBeUndefined();
  expect(await client.cached(IdentityEndpoints.me)).toBeUndefined();
});
it('invalid_credentials与未知错误不清登录；只按unauthenticated清理', async () => {
  const db = store();
  let code = 'invalid_credentials';
  let expired = 0;
  const client = new ApiClient(
    db,
    async () =>
      Response.json({ error: { code, message: '未完成', requestId: 'req' } }, { status: 403 }),
    () => {
      expired++;
    },
  );
  await client.authenticate(session());
  await expect(
    client.call(IdentityEndpoints.deleteAccount, {
      body: { password: 'valid password', confirm: 'DELETE' },
    }),
  ).rejects.toMatchObject({ code: 'invalid_credentials' });
  expect(await db.get('session')).toBeDefined();
  code = 'new_server_error';
  await expect(client.call(IdentityEndpoints.me)).rejects.toMatchObject({ code: 'unsupported' });
  expect(expired).toBe(0);
  code = 'unauthenticated';
  await expect(client.call(IdentityEndpoints.me)).rejects.toBeInstanceOf(ApiFailure);
  expect(expired).toBe(1);
  expect(await db.get('session')).toBeUndefined();
});
it('退出/换账号后，迟到的旧响应不能变成新账号缓存或清掉新会话', async () => {
  const db = store();
  let release!: (value: Response) => void;
  const client = new ApiClient(
    db,
    async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await client.authenticate(session());
  const response = client.call(IdentityEndpoints.me);
  await client.authenticate(session('another_user'));
  release(Response.json(session().user));
  await expect(response).rejects.toMatchObject({ code: 'session_changed' });
  expect(await client.cached(IdentityEndpoints.me)).toBeUndefined();
  expect(AuthResponse.parse(await db.get('session')).user.username).toBe('another_user');
});
it('后台模式不缓存响应；损坏服务器资料不写入本地', async () => {
  const db = store();
  const admin = new ApiClient(
    db,
    async () => Response.json(session().user),
    () => {},
    false,
  );
  await admin.authenticate(session());
  await admin.call(IdentityEndpoints.me);
  expect(await admin.cached(IdentityEndpoints.me)).toBeUndefined();
  const client = new ApiClient(db, async () => Response.json({ username: 'invalid' }));
  await client.restore();
  await expect(client.call(IdentityEndpoints.me)).rejects.toThrow();
  expect(await client.cached(IdentityEndpoints.me)).toBeUndefined();
});
it('微元输入保留六位小数并拒绝科学计数、负数和额外小数', () => {
  expect(yuanToMicros('0.000001')).toBe(1);
  expect(yuanToMicros('12.345678')).toBe(12345678);
  expect(formatMoney(-1000000)).toBe('¥ -1.00');
  for (const bad of ['-1', '1e3', '0.0000001', 'NaN']) expect(() => yuanToMicros(bad)).toThrow();
});
it('浏览器原生fetch保持全局接收者；更新用户状态不改变会话归属', async () => {
  const db = store();
  const client = new ApiClient(db, async function (this: unknown) {
    expect(this).toBe(globalThis);
    return Response.json(session().user);
  });
  await client.authenticate(session());
  await client.call(IdentityEndpoints.me);
  await client.updateUser({ ...session().user, profileCompleted: true });
  expect((await client.restore())?.user.profileCompleted).toBe(true);
  await expect(client.updateUser(session('another_user').user)).rejects.toMatchObject({
    code: 'session_changed',
  });
});
it('同步请求断网不能返回旧游标；networkOnly也不覆盖页面缓存', async () => {
  const db = store();
  let offline = false;
  let profileCompleted = false;
  const client = new ApiClient(db, async () => {
    if (offline) throw new TypeError('offline');
    return Response.json({ ...session().user, profileCompleted });
  });
  await client.authenticate(session());
  await client.call(IdentityEndpoints.me);
  profileCompleted = true;
  expect((await client.call(IdentityEndpoints.me, { networkOnly: true })).profileCompleted).toBe(
    true,
  );
  expect((await client.cached(IdentityEndpoints.me))?.profileCompleted).toBe(false);
  offline = true;
  await expect(client.call(IdentityEndpoints.me, { networkOnly: true })).rejects.toMatchObject({
    code: 'network_error',
  });
  expect((await client.call(IdentityEndpoints.me)).profileCompleted).toBe(false);
});
it('停止同步驱动会取消请求，不回退缓存，也不保存迟到响应', async () => {
  const db = store();
  let late = false;
  const controller = new AbortController();
  const client = new ApiClient(db, async (_url, init) => {
    if (late) {
      expect(init?.signal?.aborted).toBe(true);
      return Response.json({ ...session().user, profileCompleted: true });
    }
    return Response.json(session().user);
  });
  await client.authenticate(session());
  await client.call(IdentityEndpoints.me);
  late = true;
  controller.abort();
  await expect(
    client.call(IdentityEndpoints.me, { signal: controller.signal }),
  ).rejects.toMatchObject({ code: 'request_cancelled' });
  expect((await client.cached(IdentityEndpoints.me))?.profileCompleted).toBe(false);
  const failed = new ApiClient(db, async () => {
    throw new TypeError('aborted');
  });
  await failed.restore();
  await expect(
    failed.call(IdentityEndpoints.me, { signal: controller.signal }),
  ).rejects.toMatchObject({ code: 'request_cancelled' });
});
it('同步持久化事务核对账号和会话，清库与迟到写交错不恢复旧数据', async () => {
  const db = store();
  const client = new ApiClient(db);
  const auth = session();
  const owner = { userId: auth.user.userId, sessionId: auth.session.sessionId };
  await client.authenticate(auth);
  expect(await db.setOwned(owner, 'sync-state', { cursor: 10, outbox: ['pending'] })).toBe(true);
  expect(await db.get('sync-state')).toEqual({ cursor: 10, outbox: ['pending'] });
  await Promise.all([client.forget(), db.setOwned(owner, 'sync-state', { cursor: 11 })]);
  expect(await db.get('sync-state')).toBeUndefined();
  expect(await db.setOwned(owner, 'sync-state', { cursor: 12 })).toBe(false);
  await client.authenticate(session('another_user'));
  expect(await db.setOwned(owner, 'sync-state', { cursor: 13 })).toBe(false);
  await client.authenticate({
    ...auth,
    session: { ...auth.session, sessionId: '33333333-3333-4333-8333-333333333333' },
  });
  expect(await db.setOwned(owner, 'sync-state', { cursor: 14 })).toBe(false);
  await expect(db.setOwned(owner, 'session', auth)).rejects.toThrow('驱动不能改写');
  expect(await db.get('sync-state')).toBeUndefined();
});
it('旧连接的unauthenticated不会退出后来登录的新会话', async () => {
  const db = store();
  const expired = vi.fn();
  const client = new ApiClient(db, fetch, expired);
  const auth = session();
  await client.authenticate(auth);
  await client.authenticate(session('another_user'));
  expect(
    await client.forgetIf({ userId: auth.user.userId, sessionId: auth.session.sessionId }),
  ).toBe(false);
  expect((await client.restore())?.user.username).toBe('another_user');
  expect(expired).not.toHaveBeenCalled();
  const current = session('another_user');
  expect(
    await client.forgetIf({ userId: current.user.userId, sessionId: current.session.sessionId }),
  ).toBe(true);
  expect(await db.get('session')).toBeUndefined();
  expect(expired).toHaveBeenCalledOnce();
});

it('账号UI多记录事务失败全部回滚，旧会话也不能清除新账号草稿', async () => {
  const db = store();
  const auth = session();
  await db.set('session', auth);
  const owner = { userId: auth.user.userId, sessionId: auth.session.sessionId };
  await db.setOwnedValues(owner, {
    'ui:onboarding': true,
    'ui:onboardingDraft': { greeting: '保留' },
  });
  await expect(
    db.setOwnedValues(owner, { 'ui:onboarding': false, 'ui:onboardingDraft': () => {} }),
  ).rejects.toThrow();
  expect(await db.get('ui:onboarding')).toBe(true);
  expect(await db.get('ui:onboardingDraft')).toEqual({ greeting: '保留' });
  const replacement = session('other_user');
  await db.set('session', replacement);
  expect(
    await db.setOwnedValues(owner, { 'ui:onboarding': false, 'ui:onboardingDraft': null }),
  ).toBe(false);
  expect(await db.get('ui:onboardingDraft')).toEqual({ greeting: '保留' });
  await expect(
    db.setOwnedValues(owner, { session: auth, 'ui:onboarding': false }),
  ).rejects.toThrow();
  expect(await db.get('session')).toEqual(replacement);
});

it('引导完成后同账号迟到草稿写入也不能复原，标记与清草稿同事务提交', async () => {
  const db = store();
  const auth = session();
  await db.set('session', auth);
  const owner = { userId: auth.user.userId, sessionId: auth.session.sessionId };
  await db.setOwnedValues(owner, {
    'ui:onboarding': true,
    'ui:onboardingDraft': { greeting: '你好' },
  });
  expect(
    await db.setOwnedValues(owner, { 'ui:onboarding': false, 'ui:onboardingDraft': null }),
  ).toBe(true);
  expect(
    await db.setOwnedValues(
      owner,
      { 'ui:onboardingDraft': { greeting: '迟到' } },
      { key: 'ui:onboarding', value: true },
    ),
  ).toBe(false);
  expect(await db.get('ui:onboarding')).toBe(false);
  expect(await db.get('ui:onboardingDraft')).toBeNull();
});
it('U8：prime 把本机结果读进内存，只有 allowStale 才拿到；超过 4 分钟的结果也只给 allowStale', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const db = store();
    const auth = session();
    let served = 0;
    const fetcher = async () => {
      served++;
      return Response.json(auth.user);
    };
    const first = new ApiClient(db, fetcher);
    await first.authenticate(auth);
    await first.call(IdentityEndpoints.me);
    // 重新打开：内存是空的，本机库里有上次的结果。
    const next = new ApiClient(db, fetcher);
    await next.restore();
    expect(next.peek(IdentityEndpoints.me)).toBeUndefined();
    expect(await next.prime(IdentityEndpoints.me)).toBe(true);
    expect(next.peek(IdentityEndpoints.me)).toBeUndefined();
    expect(next.peek(IdentityEndpoints.me, {}, { allowStale: true })).toMatchObject({
      value: auth.user,
      stale: true,
    });
    expect(served).toBe(1);
    // networkOnly 从不读内存，也不能 prime。
    expect(await next.prime(IdentityEndpoints.me, { networkOnly: true })).toBe(false);
    expect(
      next.peek(IdentityEndpoints.me, { networkOnly: true }, { allowStale: true }),
    ).toBeUndefined();
    // 回源后是新结果；过了 4 分钟默认不给，allowStale 仍可先画。
    await next.call(IdentityEndpoints.me);
    expect(next.peek(IdentityEndpoints.me)?.stale).toBe(false);
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    expect(next.peek(IdentityEndpoints.me)).toBeUndefined();
    expect(next.peek(IdentityEndpoints.me, {}, { allowStale: true })?.stale).toBe(true);
    // 换账号清空内存。
    await next.authenticate(session('another_user'));
    expect(next.peek(IdentityEndpoints.me, {}, { allowStale: true })).toBeUndefined();
    expect(await next.prime(IdentityEndpoints.me)).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
