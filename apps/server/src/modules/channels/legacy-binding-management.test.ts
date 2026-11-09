import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ChannelsService } from './application/channels.service.js';
import { loadConfig } from '../../platform/config/config.js';
import type { ChannelId } from '@weiban/contracts';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ROLE = '33333333-3333-4333-8333-333333333333';
function fixture(channel: ChannelId) {
  let enabled = true;
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    const matches = enabled && args[0] === OWNER && args[1] === channel;
    if (sql.startsWith('UPDATE channels.legacy_bindings')) {
      if (matches) enabled = false;
      return { rows: [], rowCount: matches ? 2 : 0 };
    }
    if (sql.startsWith('SELECT character_id'))
      return {
        rows: matches ? [{ character_id: ROLE }, { character_id: ROLE }] : [],
        rowCount: matches ? 2 : 0,
      };
    if (sql.startsWith('SELECT 1 FROM channels.legacy_bindings'))
      return { rows: matches ? [{}] : [], rowCount: matches ? 1 : 0 };
    throw new Error('UNEXPECTED_QUERY');
  });
  const db = {
    query,
    transaction: async (work: (tx: { query: typeof query }) => Promise<unknown>) => work({ query }),
  };
  const store = {
    bindingsOf: vi.fn(async () => []),
    bindingOf: vi.fn(async () => null),
    pendingAttempt: vi.fn(async () => null),
    unbind: vi.fn(async () => undefined),
  };
  const vendor = vi.fn(async () => {
    throw new Error('PROVIDER_MUST_NOT_BE_CONTACTED');
  });
  const service = new ChannelsService(
    db as never,
    {} as never,
    vendor as never,
    store as never,
    loadConfig({
      DATABASE_URL: 'postgres://unused',
      CHANNEL_WECHAT_ENABLED: '1',
      CHANNEL_WECHAT_PUBLIC_ACCESS: '1',
      CHANNEL_WEIBO_ENABLED: '1',
      CHANNEL_WEIBO_PUBLIC_ACCESS: '1',
      CHANNEL_QQ_ENABLED: '1',
      CHANNEL_QQ_PUBLIC_ACCESS: '1',
    }),
    { now: () => new Date('2026-11-09T12:00:00Z') } as never,
    { warn: vi.fn() } as never,
    {} as never,
    { isProPlus: vi.fn(async () => false) } as never,
    { listActiveContacts: vi.fn(async () => []) } as never,
    { getDisplayName: vi.fn(async () => 'synthetic role') } as never,
    { send: vi.fn(async () => undefined) } as never,
  );
  return { service, query, store, vendor, enabled: () => enabled };
}

describe('legacy binding management remains owned by the signed-in user', () => {
  it.each(['wechat', 'weibo', 'qq'] as const)(
    '%s shows all preserved links and blocks a replacement before provider access',
    async (channel) => {
      const f = fixture(channel);
      const listed = await f.service.list(OWNER);
      expect(listed.items.find((item) => item.channel === channel)).toMatchObject({
        status: 'active',
        accountName: '原有连接',
        characterId: null,
      });
      expect(listed.items.find((item) => item.channel === channel)?.description).toContain(
        '2个连接',
      );
      if (channel === 'wechat') {
        await expect(f.service.wechatQr(OWNER, ROLE)).rejects.toMatchObject({ code: 'conflict' });
        await expect(f.service.wechatQrStatus(OWNER, ROLE)).rejects.toMatchObject({
          code: 'conflict',
        });
      } else if (channel === 'weibo')
        await expect(
          f.service.weiboConnect(OWNER, { appId: 'fake', appSecret: 'fake', characterId: ROLE }),
        ).rejects.toMatchObject({ code: 'conflict' });
      else {
        await expect(
          f.service.qqConnect(OWNER, { appId: 'fake', appSecret: 'fake', characterId: ROLE }),
        ).rejects.toMatchObject({ code: 'conflict' });
        await expect(f.service.qqPairing(OWNER, ROLE)).rejects.toMatchObject({ code: 'conflict' });
      }
      await expect(f.service.setCharacter(OWNER, channel, ROLE)).rejects.toMatchObject({
        code: 'conflict',
      });
      expect(f.vendor).not.toHaveBeenCalled();
    },
  );

  it('unbind disables every legacy slot for this owner/channel and leaves another owner untouched', async () => {
    const f = fixture('weibo');
    await f.service.unbind(OTHER, 'weibo');
    expect(f.enabled()).toBe(true);
    const result = await f.service.unbind(OWNER, 'weibo');
    expect(result.status).toBe('unbound');
    expect(f.enabled()).toBe(false);
    expect(
      f.query.mock.calls.some(
        ([sql, args]) =>
          sql.startsWith('UPDATE channels.legacy_bindings') &&
          args?.[0] === OWNER &&
          args?.[1] === 'weibo',
      ),
    ).toBe(true);
  });
});
