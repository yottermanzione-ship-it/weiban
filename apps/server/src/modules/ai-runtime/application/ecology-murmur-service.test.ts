/**
 * 碎碎念修正（T-20261103b）的服务层用例：写碎碎念的请求里不含给 Jev 的运营摘要、输出上限放宽到 200、
 * 超长按句末截断、元话语整条丢弃（不重试、不写库，费用照记）。全部用桩，不发起真实模型调用。
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ECOLOGY_CONFIG } from '../domain/ecology.js';
import { EcologyService } from './ecology.js';

const USER = '00000000-0000-4000-8000-000000000001';
const CHAR = '00000000-0000-4000-8000-000000000002';
const CONV = '00000000-0000-4000-8000-000000000003';
const TODAY = '2026-11-03';

/** 线上 11-02 宁静那次喂进去的运营摘要（格式与 jevSummary 相同）。 */
const JEV_SUMMARY = [
  '现在是对方当地时间周一 20:00。',
  '对方上次发消息在 5 分钟前；角色发了还没被回的消息 2 条。',
  '对方刚刚还在聊天。',
  '角色上次主动是 3 小时前。',
  '角色今天已经做过：给你发了条消息。',
].join('\n');

function snapshot(tools: string[] = []) {
  return {
    features: { localHour: 20, unansweredCount: 0, lateNight: false, pointsLow: false },
    summary: JEV_SUMMARY,
    balanceInsufficient: false,
    privateMode: false,
    conversationId: CONV,
    local: { date: TODAY, hour: 20, minute: 0 },
    weekday: 1,
    tools,
    targets: new Map(),
    hasFollowUps: false,
    mainUnreplied: 0,
    absenceGreeted: false,
    autoOff: false,
    followUpDue: null,
  };
}

function service(reply: string, chargedMicros = 30) {
  const generateText = vi.fn((_request: unknown) =>
    Promise.resolve({ ok: true, value: { text: reply, chargedMicros, modelKey: 'm' } }),
  );
  const finish = vi.fn().mockResolvedValue(undefined);
  const where = vi.fn(() => Promise.resolve([{ statusText: '在练琴', signature: '慢慢来' }]));
  const svc = Object.create(EcologyService.prototype) as EcologyService;
  Object.assign(svc, {
    clock: { nowMs: () => Date.parse(`${TODAY}T12:00:00.000Z`), now: () => new Date() },
    db: { db: { select: () => ({ from: () => ({ where }) }) } },
    characters: {
      getForRuntime: vi.fn().mockResolvedValue({
        profile: { name: '宁静' },
        card: null,
        legacyCard: null,
      }),
    },
    policy: {
      getCharacterPolicy: vi.fn().mockResolvedValue({
        isRealPerson: false,
        isMinor: false,
        romanceAllowed: true,
      }),
    },
    moments: {
      listCharacterPosts: vi.fn().mockResolvedValue([
        { author: { kind: 'character', refId: CHAR }, text: '今天的晚霞好看' },
        { author: { kind: 'character', refId: 'someone-else' }, text: '别人的动态' },
      ]),
    },
    simulation: {
      getDailyEvents: vi.fn().mockResolvedValue([{ summary: '上午去琴房练了两小时' }]),
    },
    social: {
      listJointEvents: vi.fn().mockResolvedValue([
        { eventDate: TODAY, summary: '和小林去吃了火锅' },
        { eventDate: '2026-11-01', summary: '前天的事不该出现' },
      ]),
    },
    gateway: { generateText },
    settings: {
      config: vi.fn().mockResolvedValue({ ...DEFAULT_ECOLOGY_CONFIG, decisionModelKey: 'jev' }),
      decisionProblem: vi.fn().mockResolvedValue(null),
    },
    finish,
    buildSnapshot: vi.fn().mockResolvedValue(snapshot()),
  });
  const murmur = (done: string[]) =>
    (
      svc as unknown as {
        generateMurmur(
          run: unknown,
          snap: unknown,
          done: string[],
        ): Promise<{ text: string | null; chargedMicros: number } | null>;
      }
    ).generateMurmur({ id: 'run-1', userId: USER, characterId: CHAR }, snapshot(), done);
  const wake = () =>
    (svc as unknown as { executeWake(r: unknown): Promise<void> }).executeWake({
      id: 'run-1',
      userId: USER,
      characterId: CHAR,
    });
  return { murmur, wake, generateText, finish };
}

type Request = {
  maxOutputTokens: number;
  messages: Array<{ role: string; content: string }>;
};

describe('碎碎念请求：单独组装素材', () => {
  it('不喂运营摘要；素材是角色自己的生活与这次做了什么；输出上限 200', async () => {
    const s = service('今天练琴练到手酸，晚霞倒是很好看。');
    await expect(s.murmur(['给你发了条消息'])).resolves.toEqual({
      text: '今天练琴练到手酸，晚霞倒是很好看。',
      chargedMicros: 30,
    });
    const request = s.generateText.mock.calls[0]![0] as Request;
    expect(request.maxOutputTokens).toBe(200);
    const material = request.messages.find((m) => m.role === 'user')!.content;
    for (const banned of ['对方', '用户', '角色', '还没被回', '分钟前', '上次主动', '已经做过'])
      expect(material).not.toContain(banned);
    expect(material).toContain('现在是周一晚上。');
    expect(material).toContain('我现在的状态：在练琴');
    expect(material).toContain('我的个性签名：慢慢来');
    expect(material).toContain('我最近发的朋友圈：「今天的晚霞好看」');
    expect(material).toContain('今天的事：和小林去吃了火锅');
    expect(material).toContain('今天的事：上午去琴房练了两小时');
    expect(material).toContain('刚才：给你发了条消息');
    expect(material).not.toContain('别人的动态');
    expect(material).not.toContain('前天的事');
    // 整个请求里都不出现运营摘要原文。
    expect(JSON.stringify(request.messages)).not.toContain('还没被回的消息');
  });

  it('超长输出在服务端截到 60 字以内、落在句末', async () => {
    const long =
      '今天一大早就去琴房练琴，练到中午手都酸了。下午和小林去吃火锅，辣得直冒汗！晚上回来看到窗外的晚霞特别好看，想着要是能拍下来就好了可惜手机没电了';
    const s = service(long);
    const out = await s.murmur([]);
    expect(out?.text).toBe(
      '今天一大早就去琴房练琴，练到中午手都酸了。下午和小林去吃火锅，辣得直冒汗！',
    );
    expect([...out!.text!].length).toBeLessThanOrEqual(60);
  });

  it('元话语整条丢弃：不重试、不写碎碎念，费用照记', async () => {
    const s = service('好的，以下是今天的碎碎念：角色今天给对方发了消息。', 41);
    await expect(s.murmur(['给你发了条消息'])).resolves.toEqual({ text: null, chargedMicros: 41 });
    expect(s.generateText).toHaveBeenCalledTimes(1);

    const idle = service('作为宁静，我今天很开心。', 41);
    await idle.wake();
    expect(idle.generateText).toHaveBeenCalledTimes(1);
    expect(idle.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'idle', murmur: null, chargedMicros: 41 }),
    );
  });

  it('正常输出写进运行记录', async () => {
    const s = service('今天风好大，差点把伞吹跑了。', 20);
    await s.wake();
    expect(s.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'idle',
        murmur: { userId: USER, text: '今天风好大，差点把伞吹跑了。' },
        chargedMicros: 20,
      }),
    );
  });
});
