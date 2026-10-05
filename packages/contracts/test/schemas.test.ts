/**
 * 契约基本单元测试：关键 schema 接受合法数据、拒绝非法数据；
 * 并覆盖质量问题 Q-001、Q-003、Q-006 的修复（编号见 docs/quality/issues.md）。
 */
import { describe, expect, it } from 'vitest';
import {
  AdminAlert,
  AdminAlertFacts,
  AdminCatalogEntryWrite,
  AdminCharacterUpdate,
  AdminCharacterWrite,
  AdminUsageSummaryRequest,
  ApiError,
  CreateInviteRequest,
  INVITE_BONUS_MAX_MICROS,
  IdentityAdminEndpoints,
  IdentityEndpoints,
  Invite,
  PendingAccountDeletion,
  PushAdminEndpoints,
  ReconciliationRun,
  BACKGROUND_PURPOSES,
  BUDGET_EXEMPT_PURPOSES,
  CONTRACT_VERSION,
  LedgerEntry,
  ModelPurpose,
  SAFETY_OVERDRAFT_PURPOSES,
  CharacterClassification,
  CharacterClassificationInput,
  ClientFrame,
  ErrorCode,
  Events,
  Message,
  MessageContent,
  NotificationPayload,
  SendMessageRequest,
  ServerFrame,
  ServerFrameStrict,
  UpdateProfileRequest,
  UpdateUserPreferencesRequest,
  UserPreferences,
  UserUpdate,
  UserUpdatePayload,
} from '../src/index.js';

const ID = '01920000-0000-7000-8000-000000000001';
const ID2 = '01920000-0000-7000-8000-000000000002';
const NOW = '2026-10-05T08:30:00.000Z';

const textMessage = {
  messageId: ID,
  conversationId: ID2,
  seq: 1,
  senderParticipantId: ID,
  senderKind: 'user',
  content: { type: 'text', text: '你好' },
  quote: null,
  status: 'normal',
  scope: 'normal',
  clientMsgId: ID,
  createdAt: NOW,
  recalledAt: null,
};

const classification = {
  basis: 'fictional',
  realPersonKind: null,
  ageSetting: 'adult',
  childAppearance: false,
};

const adminCharacter = {
  name: '林夏予',
  tagline: '一句话介绍',
  intro: '简介',
  categoryId: null,
  avatar: {
    imageMediaId: null,
    display: { supportColors: [], avatarText: null, avatarPattern: 'star', themeColor: null },
  },
  birthday: null,
  fanName: null,
  classification,
  card: { cardSchemaVersion: 1, data: {} },
};

describe('契约版本', () => {
  it('为 2.0', () => {
    expect(CONTRACT_VERSION).toBe('2.0');
  });
});

describe('消息与发送', () => {
  it('合法的发送请求通过；用户不能发系统提示', () => {
    expect(
      SendMessageRequest.safeParse({ clientMsgId: ID, content: { type: 'text', text: 'hi' } })
        .success,
    ).toBe(true);
    expect(
      SendMessageRequest.safeParse({
        clientMsgId: ID,
        content: { type: 'system', code: 'contact_accepted' },
      }).success,
    ).toBe(false);
  });

  it('拒绝空文本、超长文本和非 UUID 的 clientMsgId', () => {
    const send = (text: string, clientMsgId = ID) =>
      SendMessageRequest.safeParse({ clientMsgId, content: { type: 'text', text } }).success;
    expect(send('')).toBe(false);
    expect(send('字'.repeat(4001))).toBe(false);
    expect(send('hi', 'not-a-uuid')).toBe(false);
  });

  it('合法消息通过；时间不是 ISO UTC 格式时拒绝', () => {
    expect(Message.safeParse(textMessage).success).toBe(true);
    expect(Message.safeParse({ ...textMessage, createdAt: '2026/10/05 08:30' }).success).toBe(
      false,
    );
  });
});

describe('Q-003 接收端容忍未知类型，发送端保持严格', () => {
  it('未知消息类型解析为 unsupported，保留原类型名', () => {
    const parsed = Message.parse({ ...textMessage, content: { type: 'image', mediaId: ID } });
    expect(parsed.content).toEqual({ type: 'unsupported', originalType: 'image' });
  });

  it('已知类型但内容非法时仍然报错（不掩盖服务器错误）', () => {
    expect(Message.safeParse({ ...textMessage, content: { type: 'text', text: '' } }).success).toBe(
      false,
    );
  });

  it('严格的 MessageContent 拒绝未知类型（服务器写入用）', () => {
    expect(MessageContent.safeParse({ type: 'image', mediaId: ID }).success).toBe(false);
  });

  it('未知更新类型解析为 unsupported，整页补拉不失败', () => {
    const update = UserUpdate.parse({
      updateSeq: 7,
      occurredAt: NOW,
      type: 'moment.created',
      data: { momentId: ID },
    });
    expect(update).toMatchObject({
      updateSeq: 7,
      type: 'unsupported',
      data: { originalType: 'moment.created' },
    });
  });

  it('已知更新类型照常解析；未知设置分块变为 unsupported', () => {
    const update = UserUpdate.parse({
      updateSeq: 8,
      occurredAt: NOW,
      type: 'settings.updated',
      data: { section: 'achievements', characterId: null },
    });
    expect(update).toMatchObject({ type: 'settings.updated', data: { section: 'unsupported' } });
  });

  it('服务器写入更新日志用的严格联合类型拒绝未知类型', () => {
    expect(UserUpdatePayload.safeParse({ type: 'moment.created', data: {} }).success).toBe(false);
  });

  it('WebSocket：未知帧类型解析为 unsupported；帧里的未知消息类型也能解析', () => {
    expect(ServerFrame.parse({ v: 1, type: 'call.ringing', data: { callId: ID } })).toEqual({
      v: 1,
      type: 'unsupported',
      data: { originalType: 'call.ringing' },
    });
    const frame = ServerFrame.parse({
      v: 1,
      type: 'update',
      data: {
        updateSeq: 9,
        occurredAt: NOW,
        type: 'message.created',
        data: { message: { ...textMessage, content: { type: 'sticker', stickerId: 's1' } } },
      },
    });
    expect(frame.type).toBe('update');
    expect(ServerFrameStrict.safeParse({ v: 1, type: 'call.ringing', data: {} }).success).toBe(
      false,
    );
  });

  it('客户端发出的帧仍然严格', () => {
    expect(ClientFrame.safeParse({ v: 1, type: 'call.answer', data: {} }).success).toBe(false);
    expect(ClientFrame.safeParse({ v: 1, type: 'ping', data: {} }).success).toBe(true);
  });

  it('未知错误码、未知通知种类变为 unsupported', () => {
    const error = ApiError.parse({
      error: { code: 'some_new_code', message: 'x', requestId: 'r1' },
    });
    expect(error.error.code).toBe('unsupported');
    expect(ErrorCode.safeParse('some_new_code').success).toBe(false);
    const payload = NotificationPayload.parse({
      v: 1,
      kind: 'moment',
      collapseKey: 'k',
      title: 't',
      body: 'b',
      count: 1,
      deepLink: '/moments',
      conversationId: null,
      sound: true,
      sentAt: NOW,
    });
    expect(payload.kind).toBe('unsupported');
  });
});

describe('Q-001 修改请求不补默认值', () => {
  it('只改角色名字时，别名、作品、标签、备用开场白不出现', () => {
    expect(AdminCharacterUpdate.parse({ name: '新名字' })).toEqual({ name: '新名字' });
  });

  it('新建角色时这些字段仍默认为空数组', () => {
    const created = AdminCharacterWrite.parse(adminCharacter);
    expect(created.aliases).toEqual([]);
    expect(created.fallbackGreetings).toEqual([]);
  });

  it('只改昵称时，性别不会被补成 unspecified', () => {
    expect(UpdateProfileRequest.parse({ nickname: '小予' })).toEqual({ nickname: '小予' });
  });

  it('修改请求仍然校验字段本身', () => {
    expect(AdminCharacterUpdate.safeParse({ name: '' }).success).toBe(false);
    expect(UpdateProfileRequest.safeParse({ gender: 'unknown' }).success).toBe(false);
  });
});

describe('Q-006 角色分类组合校验', () => {
  it('合法组合通过', () => {
    expect(CharacterClassificationInput.safeParse(classification).success).toBe(true);
    expect(
      CharacterClassificationInput.safeParse({
        ...classification,
        basis: 'real_person',
        realPersonKind: 'celebrity',
      }).success,
    ).toBe(true);
  });

  it('真人角色缺少真人类型时拒绝', () => {
    expect(
      CharacterClassificationInput.safeParse({ ...classification, basis: 'real_person' }).success,
    ).toBe(false);
  });

  it('原创 / 虚构角色带真人类型时拒绝', () => {
    expect(
      CharacterClassificationInput.safeParse({
        ...classification,
        basis: 'original',
        realPersonKind: 'celebrity',
      }).success,
    ).toBe(false);
  });

  it('读取的分类与角色库请求体也执行同样的校验', () => {
    const derived = {
      isMinor: false,
      adultModeEligible: false,
      romanceAllowed: true,
      portraitPolicy: 'forbidden',
      publicStatementGuard: true,
    };
    expect(
      CharacterClassification.safeParse({
        ...classification,
        basis: 'real_person',
        childFeaturesDetected: false,
        derived,
      }).success,
    ).toBe(false);
    expect(
      AdminCharacterUpdate.safeParse({
        classification: { ...classification, basis: 'real_person' },
      }).success,
    ).toBe(false);
  });
});

describe('界面偏好（主题多设备同步）', () => {
  it('只接受 green / pink', () => {
    expect(UpdateUserPreferencesRequest.safeParse({ theme: 'pink' }).success).toBe(true);
    expect(UpdateUserPreferencesRequest.safeParse({ theme: 'blue' }).success).toBe(false);
  });

  it('客户端读到不认识的主题时变为 unsupported（按默认主题显示）', () => {
    expect(UserPreferences.parse({ theme: 'blue', updatedAt: NOW }).theme).toBe('unsupported');
  });
});

describe('领域事件', () => {
  it('余额恢复事件带触发原因（Q-008）', () => {
    const base = {
      eventId: ID,
      type: 'billing.balance_restored',
      version: 1,
      producer: 'billing',
      occurredAt: NOW,
    };
    expect(
      Events.BalanceRestored.safeParse({
        ...base,
        payload: { userId: ID, availableMicros: 500, trigger: 'topped_up_after_rejection' },
      }).success,
    ).toBe(true);
    expect(Events.BalanceRestored.safeParse({ ...base, payload: { userId: ID } }).success).toBe(
      false,
    );
  });

  it('事件汇总不再包含年龄确认', () => {
    const types = Events.DomainEvent.options.map((o) => o.shape.type.value);
    expect(types).not.toContain('identity.age_confirmed');
    expect(types).toContain('identity.preferences_updated');
  });
});

describe('v1.1（T-020）', () => {
  const derived = {
    isMinor: false,
    adultModeEligible: false,
    romanceAllowed: true,
    publicStatementGuard: true,
  };
  const historical = {
    ...classification,
    basis: 'real_person',
    realPersonKind: 'historical',
    childFeaturesDetected: false,
  };

  it('历史人物的形象策略 classical_art_only 可以解析；不认识的策略变为 unsupported', () => {
    const ok = CharacterClassification.parse({
      ...historical,
      derived: { ...derived, portraitPolicy: 'classical_art_only' },
    });
    expect(ok.derived.portraitPolicy).toBe('classical_art_only');
    const future = CharacterClassification.parse({
      ...historical,
      derived: { ...derived, portraitPolicy: 'cartoon_only' },
    });
    expect(future.derived.portraitPolicy).toBe('unsupported');
  });

  it('流水用途分组新增 planning；不认识的分组变为 unsupported', () => {
    const entry = {
      entryId: ID,
      type: 'charge',
      amountMicros: -1200,
      balanceAfterMicros: 5000,
      category: 'planning',
      modelKey: 'deepseek/deepseek-v4-flash',
      characterId: ID2,
      note: null,
      createdAt: NOW,
    };
    expect(LedgerEntry.parse(entry).category).toBe('planning');
    expect(LedgerEntry.parse({ ...entry, category: 'games' }).category).toBe('unsupported');
  });

  it('安全关怀跟进不受后台预算限制，且可以使用安全优先透支；行为规划不是默认的后台用途', () => {
    expect(ModelPurpose.options).toContain('safety_followup');
    expect(ModelPurpose.options).toContain('behavior_planning');
    expect(BUDGET_EXEMPT_PURPOSES).toContain('safety_followup');
    expect(BACKGROUND_PURPOSES).not.toContain('safety_followup');
    expect(BACKGROUND_PURPOSES).not.toContain('behavior_planning');
    expect([...SAFETY_OVERDRAFT_PURPOSES].sort()).toEqual(
      ['chat_reply', 'safety_check', 'safety_followup'].sort(),
    );
  });

  it('管理后台用量汇总：1～2 个不重复的分组维度', () => {
    const filter = { from: NOW, to: '2026-10-06T08:30:00.000Z' };
    expect(
      AdminUsageSummaryRequest.safeParse({ filter, groupBy: ['user', 'purpose'] }).success,
    ).toBe(true);
    expect(AdminUsageSummaryRequest.safeParse({ filter, groupBy: [] }).success).toBe(false);
    expect(AdminUsageSummaryRequest.safeParse({ filter, groupBy: ['user', 'user'] }).success).toBe(
      false,
    );
    expect(
      AdminUsageSummaryRequest.safeParse({ filter, groupBy: ['user', 'model', 'day'] }).success,
    ).toBe(false);
    expect(
      AdminUsageSummaryRequest.safeParse({
        filter: { ...filter, purposes: ['not_a_purpose'] },
        groupBy: ['day'],
      }).success,
    ).toBe(false);
  });

  it('默认识图模型可以在目录中标记', () => {
    const entry = {
      modelKey: 'qwen/qwen-vl-plus',
      displayName: '通义千问 VL',
      vendorName: '阿里云',
      upstreamId: ID,
      upstreamModelId: 'qwen-vl-plus',
      capabilities: ['vision'],
      tags: [],
      leaderboardRank: null,
      sortOrder: 0,
      defaultFor: ['vision'],
      enabled: true,
    };
    expect(AdminCatalogEntryWrite.safeParse(entry).success).toBe(true);
  });
});

describe('v1.2（T-024）', () => {
  it('生成邀请码：赠送余额可省略（默认 0），不能为负、不能超过上限', () => {
    expect(CreateInviteRequest.parse({ expiresInDays: 7 }).bonusMicros).toBe(0);
    expect(
      CreateInviteRequest.parse({ expiresInDays: null, bonusMicros: 20_000_000 }).bonusMicros,
    ).toBe(20_000_000);
    expect(CreateInviteRequest.safeParse({ expiresInDays: 7, bonusMicros: -1 }).success).toBe(
      false,
    );
    expect(CreateInviteRequest.safeParse({ expiresInDays: 7, bonusMicros: 1.5 }).success).toBe(
      false,
    );
    expect(
      CreateInviteRequest.safeParse({
        expiresInDays: 7,
        bonusMicros: INVITE_BONUS_MAX_MICROS + 1,
      }).success,
    ).toBe(false);
    expect(IdentityAdminEndpoints.createInvite.body).toBe(CreateInviteRequest);
  });

  it('邀请码响应带赠送金额；兼容 1.1 服务器不带该字段', () => {
    const invite = { code: 'ABCD2345EFGH6789', createdAt: NOW, expiresAt: null, usedAt: null };
    expect(Invite.parse({ ...invite, bonusMicros: 5_000_000 }).bonusMicros).toBe(5_000_000);
    expect(Invite.safeParse(invite).success).toBe(true);
    expect(Invite.safeParse({ ...invite, bonusMicros: -1 }).success).toBe(false);
  });

  it('注册事件可带注册赠送，金额必须为正', () => {
    const base = {
      eventId: ID,
      type: 'identity.user_registered',
      version: 1,
      producer: 'identity',
      occurredAt: NOW,
    };
    expect(Events.UserRegistered.safeParse({ ...base, payload: { userId: ID } }).success).toBe(
      true,
    );
    expect(
      Events.UserRegistered.safeParse({
        ...base,
        payload: { userId: ID, signupBonus: { amountMicros: 10_000_000, grantedByUserId: ID2 } },
      }).success,
    ).toBe(true);
    expect(
      Events.UserRegistered.safeParse({
        ...base,
        payload: { userId: ID, signupBonus: { amountMicros: 10_000_000, grantedByUserId: null } },
      }).success,
    ).toBe(true);
    expect(
      Events.UserRegistered.safeParse({
        ...base,
        payload: { userId: ID, signupBonus: { amountMicros: 0, grantedByUserId: null } },
      }).success,
    ).toBe(false);
    // 事件不带邀请码本身
    expect(
      Events.UserRegistered.parse({
        ...base,
        payload: { userId: ID, inviteCode: 'ABCD2345EFGH6789' },
      }).payload,
    ).not.toHaveProperty('inviteCode');
  });

  it('注销未完成列表：模块进度，管理后台不认识的模块名不报错', () => {
    const pending = {
      userId: ID,
      username: 'demo_user',
      requestedAt: NOW,
      lastRetriggeredAt: null,
      modules: [
        { module: 'identity', purged: true, deletedRows: 6, purgedAt: NOW },
        { module: 'billing', purged: false, deletedRows: null, purgedAt: null },
        { module: 'future_module', purged: false, deletedRows: null, purgedAt: null },
      ],
    };
    const parsed = PendingAccountDeletion.parse(pending);
    expect(parsed.modules.map((m) => m.module)).toEqual(['identity', 'billing', 'unsupported']);
    expect(PendingAccountDeletion.safeParse({ ...pending, requestedAt: 'yesterday' }).success).toBe(
      false,
    );
  });

  it('注销管理接口：列表与重新触发', () => {
    const list = IdentityAdminEndpoints.listPendingDeletions;
    expect([list.method, list.path, list.auth]).toEqual([
      'GET',
      '/api/v1/admin/account-deletions',
      'admin',
    ]);
    const retry = IdentityAdminEndpoints.retryDeletion;
    expect([retry.method, retry.path, retry.auth]).toEqual([
      'POST',
      '/api/v1/admin/account-deletions/:userId/retry',
      'admin',
    ]);
    expect(retry.params?.safeParse({ userId: 'not-a-uuid' }).success).toBe(false);
    expect(retry.response).toBe(PendingAccountDeletion);
  });

  it('注销时密码错误的返回写在接口说明里（403 invalid_credentials）', () => {
    expect(IdentityEndpoints.deleteAccount.summary).toContain('403 invalid_credentials');
    expect(ErrorCode.options).toContain('invalid_credentials');
  });
});

describe('v1.3（T-026）', () => {
  it('管理员提醒事件：任何模块可发，载荷不接受未知种类', () => {
    const base = {
      eventId: ID,
      type: 'platform.admin_alert_raised',
      version: 1,
      producer: 'billing',
      occurredAt: NOW,
    };
    const payload = {
      kind: 'platform_budget_warning',
      severity: 'warning',
      dedupeKey: 'platform_budget_warning:2026-10-06',
      summary: '平台今日成本已达上限的 80%（25.60 / 32.00 元）',
      refs: { day: '2026-10-06' },
    };
    expect(Events.AdminAlertRaised.safeParse({ ...base, payload }).success).toBe(true);
    expect(
      Events.AdminAlertRaised.safeParse({ ...base, producer: 'model_access', payload }).success,
    ).toBe(true);
    expect(
      Events.AdminAlertRaised.safeParse({ ...base, payload: { ...payload, kind: 'whatever' } })
        .success,
    ).toBe(false);
    expect(AdminAlertFacts.safeParse({ ...payload, dedupeKey: '' }).success).toBe(false);
    const types = Events.DomainEvent.options.map((o) => o.shape.type.value);
    expect(types).toContain('platform.admin_alert_raised');
    expect(types).toContain('model_access.usage_reconciled');
  });

  it('管理后台读提醒：不认识的种类不报错', () => {
    const alert = AdminAlert.parse({
      alertId: ID,
      kind: 'future_kind',
      severity: 'critical',
      dedupeKey: 'future_kind:1',
      summary: '说明',
      occurrences: 2,
      firstRaisedAt: NOW,
      lastRaisedAt: NOW,
      acknowledgedAt: null,
      acknowledgedByUserId: null,
    });
    expect(alert.kind).toBe('unsupported');
    const list = PushAdminEndpoints.listAdminAlerts;
    expect([list.method, list.path, list.auth]).toEqual(['GET', '/api/v1/admin/alerts', 'admin']);
    expect(list.query?.parse({})).toMatchObject({ status: 'open', limit: 50 });
  });

  it('对账第 ② 层结果事件与对账记录的新字段（可选）', () => {
    expect(
      Events.UsageReconciled.safeParse({
        eventId: ID,
        type: 'model_access.usage_reconciled',
        version: 1,
        producer: 'model_access',
        occurredAt: NOW,
        payload: {
          day: '2026-10-05',
          usageWithoutCharge: 0,
          chargeWithoutUsage: 1,
          amountMismatch: 0,
          snapshotsRepaired: 2,
          checkedAt: NOW,
        },
      }).success,
    ).toBe(true);
    const run = {
      runId: ID,
      date: '2026-10-05',
      ledgerConsistent: true,
      staleHolds: 0,
      usageWithoutCharge: 0,
      chargeWithoutUsage: 0,
      upstreamDiffs: [],
      absorbedMicros: 0,
      createdAt: NOW,
    };
    expect(ReconciliationRun.safeParse(run).success).toBe(true);
    expect(
      ReconciliationRun.safeParse({ ...run, usageReconciledAt: null, usageAmountMismatch: 0 })
        .success,
    ).toBe(true);
  });

  it('通知种类新增 admin_alert', () => {
    expect(NotificationPayload.shape.kind.parse('admin_alert')).toBe('admin_alert');
  });
});
