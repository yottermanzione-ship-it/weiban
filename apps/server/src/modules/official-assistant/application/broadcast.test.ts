import { describe, expect, it, vi } from 'vitest';
import type {
  ChatAdminPort,
  ChatParticipantPort,
  IdentityAccountStatusPort,
} from '@weiban/contracts';
import type { Database } from '../../../platform/index.js';
import { OFFICIAL_REF_ID } from '@weiban/contracts';
import { AppError } from '../../../platform/index.js';
import { OfficialBroadcastService } from './broadcast.js';

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const BROADCAST_ID = '33333333-3333-4333-8333-333333333333';

function buildService(
  opts: {
    broadcastEnabled?: boolean;
    accountStatus?: (userId: string) => Promise<string | null>;
    postResult?: unknown;
  } = {},
) {
  const chatAdmin = {
    ensureOfficialConversation: vi.fn(async () => ({
      conversationId: '44444444-4444-4444-8444-444444444444',
      participants: [{ participantId: 'p-official', kind: 'official', refId: OFFICIAL_REF_ID }],
    })),
  };
  const participants = {
    postMessage: vi.fn(
      async (_input: { content: { text: string }; idempotencyKey: string }) =>
        (opts.postResult ?? { ok: true, value: { messageId: 'm1' } }) as never,
    ),
  };
  const accounts = {
    getAccountStatus: vi.fn(async (userId: string) =>
      opts.accountStatus ? opts.accountStatus(userId) : 'active',
    ),
  };
  const database = {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const config = {
    officialAssistant: { enabled: true, broadcastEnabled: opts.broadcastEnabled ?? true },
  };
  const service = new OfficialBroadcastService(
    database as unknown as Database,
    chatAdmin as unknown as ChatAdminPort,
    participants as unknown as ChatParticipantPort,
    accounts as unknown as IdentityAccountStatusPort,
    config as never,
    audit as never,
  );
  return { service, chatAdmin, participants, accounts, audit };
}

describe('公告群发开关与受众', () => {
  it('未开启群发时拒绝', async () => {
    const { service } = buildService({ broadcastEnabled: false });
    await expect(
      service.broadcast(ADMIN_ID, {
        broadcastId: BROADCAST_ID,
        body: '公告正文',
        audience: { kind: 'user_ids', userIds: [USER_A] },
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('全量受众被拒绝（受众规则待定，不擅自定）', async () => {
    const { service } = buildService();
    await expect(
      service.broadcast(ADMIN_ID, {
        broadcastId: BROADCAST_ID,
        body: '公告正文',
        audience: { kind: 'all_users' },
      }),
    ).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('公告群发执行', () => {
  it('向显式列表逐条发送：标题拼进正文、幂等键按广播+用户', async () => {
    const { service, participants, audit } = buildService();
    const result = await service.broadcast(ADMIN_ID, {
      broadcastId: BROADCAST_ID,
      title: '维护通知',
      body: '今晚升级。',
      audience: { kind: 'user_ids', userIds: [USER_A] },
    });
    expect(result).toEqual({ broadcastId: BROADCAST_ID, delivered: 1, skipped: 0 });
    const posted = participants.postMessage.mock.calls[0]![0] as {
      content: { text: string };
      idempotencyKey: string;
    };
    expect(posted.content.text).toBe('\n今晚升级。');
    expect(posted.idempotencyKey).toBe(`official:broadcast:${BROADCAST_ID}:${USER_A}`);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('账号失效的用户跳过、单用户失败不影响其他人', async () => {
    const { service } = buildService({
      accountStatus: async (userId) => (userId === USER_B ? 'deleting' : 'active'),
      postResult: { ok: true, value: { messageId: 'm1' } },
    });
    const result = await service.broadcast(ADMIN_ID, {
      broadcastId: BROADCAST_ID,
      body: '公告正文',
      audience: { kind: 'user_ids', userIds: [USER_A, USER_B, USER_A] },
    });
    expect(result.delivered).toBe(1);
    expect(result.skipped).toBe(1);
  });
});
