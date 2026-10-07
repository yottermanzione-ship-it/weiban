import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { AuthResponse, IdentityEndpoints } from '@weiban/contracts';
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
