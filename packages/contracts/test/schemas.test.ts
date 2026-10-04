/**
 * 契约基本单元测试：关键 schema 接受合法数据、拒绝非法数据；
 * 并覆盖质量问题 Q-001、Q-003、Q-006 的修复（编号见 docs/quality/issues.md）。
 */
import { describe, expect, it } from 'vitest';
import {
  AdminCharacterUpdate,
  AdminCharacterWrite,
  ApiError,
  CONTRACT_VERSION,
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
  card: { cardSchemaVersion: 0, data: {} },
};

describe('契约版本', () => {
  it('为 1.0', () => {
    expect(CONTRACT_VERSION).toBe('1.0');
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
