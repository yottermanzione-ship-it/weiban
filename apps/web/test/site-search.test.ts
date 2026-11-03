import { describe, expect, it } from 'vitest';
import type { SiteSearchResult } from '@weiban/contracts';
import {
  RequestGate,
  SuggestRunner,
  allowWebSearch,
  siteActionLabel,
  siteIdentityText,
  siteQueryMode,
  siteResultHref,
  siteSuggestionNote,
  type SuggestState,
} from '../src/features/site-search-logic.js';

const result = (patch: Partial<SiteSearchResult>): SiteSearchResult => ({
  candidateId: 'official:c1',
  source: 'official',
  action: 'add',
  name: '李晨',
  match: 'exact',
  matchedTerm: null,
  identity: null,
  unverified: true,
  ambiguous: false,
  entityKey: null,
  sourceUrl: null,
  characterId: '00000000-0000-4000-8000-000000000001',
  workId: null,
  conversationId: null,
  added: false,
  character: null,
  work: null,
  ...patch,
});

/** 手动控制的计时器与请求：测试里决定防抖何时到点、哪个请求先回来。 */
function harness() {
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const pending: Array<{
    q: string;
    resolve: (value: string[]) => void;
    reject: (error: unknown) => void;
  }> = [];
  const states: Array<SuggestState<string[]>> = [];
  const runner = new SuggestRunner<string[]>({
    delay: 250,
    fetch: (q) => new Promise((resolve, reject) => pending.push({ q, resolve, reject })),
    onChange: (state) => states.push(state),
    describeError: () => '网络不可用',
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (t) => {
      (t as unknown as { cleared: boolean }).cleared = true;
    },
  });
  const fire = () => {
    for (const t of timers.splice(0)) if (!t.cleared) t.fn();
  };
  const last = () => states.at(-1)!;
  return { runner, timers, pending, states, fire, last };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('站内搜索输入模式（T-20261104b）', () => {
  it('一个字、空白、超过 64 字只在站内搜，不给联网查找入口', () => {
    expect(siteQueryMode('   ')).toBe('empty');
    expect(siteQueryMode(' 李 ')).toBe('single');
    expect(siteQueryMode('李晨')).toBe('normal');
    expect(siteQueryMode('长'.repeat(65))).toBe('too_long');
    expect(allowWebSearch('李')).toBe(false);
    expect(allowWebSearch('')).toBe(false);
    expect(allowWebSearch('长'.repeat(65))).toBe(false);
    expect(allowWebSearch('长'.repeat(64))).toBe(true);
    // 按字（码点）算，不按 UTF-16 长度。
    expect(siteQueryMode('𠀀')).toBe('single');
  });
});

describe('结果项去哪、显示什么', () => {
  it('已添加去聊天、官方去资料页添加、广场作品进详情、本人角色看资料；未知动作退回资料 / 作品页', () => {
    expect(siteResultHref(result({ action: 'chat', conversationId: 'conv-1' }))).toBe(
      '/chat/conv-1',
    );
    expect(siteResultHref(result({ action: 'add' }))).toBe(
      '/characters/00000000-0000-4000-8000-000000000001',
    );
    expect(
      siteResultHref(
        result({ source: 'plaza', action: 'view_work', characterId: null, workId: 'w1' }),
      ),
    ).toBe('/plaza/works/w1');
    expect(siteResultHref(result({ source: 'own', action: 'open_own' }))).toBe(
      '/characters/00000000-0000-4000-8000-000000000001',
    );
    expect(
      siteResultHref(
        result({ source: 'plaza', action: 'unsupported', characterId: null, workId: 'w2' }),
      ),
    ).toBe('/plaza/works/w2');
    expect(siteActionLabel('unsupported')).toBe('查看');
    expect(siteActionLabel('chat')).toBe('去聊天');
  });

  it('同名多项又没有身份说明时写「暂未核实身份」，不编履历', () => {
    expect(siteIdentityText(result({ ambiguous: true }))).toBe('暂未核实身份');
    expect(siteIdentityText(result({ ambiguous: false }))).toBeNull();
    expect(siteIdentityText(result({ identity: '演员', unverified: false, ambiguous: true }))).toBe(
      '演员',
    );
    expect(
      siteSuggestionNote({
        text: '易烊千玺',
        match: 'exact',
        matchedTerm: { text: 'Jackson Yee', kind: 'alias' },
        sources: ['official'],
      }),
    ).toBe('别名：Jackson Yee');
  });
});

describe('联想请求：防抖、迟到响应、账号切换、断网', () => {
  it('连续输入只在停下 250ms 后请求最后一次', () => {
    const h = harness();
    h.runner.update('u1:s1', '易');
    h.runner.update('u1:s1', '易烊');
    h.runner.update('u1:s1', '易烊千');
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(1);
    expect(h.timers.at(-1)!.ms).toBe(250);
    h.fire();
    expect(h.pending.map((p) => p.q)).toEqual(['易烊千']);
  });

  it('迟到的旧响应不覆盖新结果', async () => {
    const h = harness();
    h.runner.update('u1:s1', '易烊');
    h.fire();
    h.runner.update('u1:s1', '易烊千');
    h.fire();
    h.pending[1]!.resolve(['易烊千玺']);
    await flush();
    h.pending[0]!.resolve(['易烊旧结果']);
    await flush();
    expect(h.last()).toMatchObject({ key: '易烊千', dataKey: '易烊千', data: ['易烊千玺'] });
  });

  it('切换账号后，上一个账号迟到的候选被丢弃，旧结果也清掉', async () => {
    const h = harness();
    h.runner.update('u1:s1', '李晨');
    h.fire();
    h.pending[0]!.resolve(['李晨（我的私人朋友）']);
    await flush();
    expect(h.last().data).toEqual(['李晨（我的私人朋友）']);
    h.runner.update('u1:s1', '李晨阳');
    h.fire();
    // 还没回来就换了账号。
    h.runner.update('u2:s9', '李晨阳');
    h.pending[1]!.resolve(['u1 的结果']);
    await flush();
    expect(h.states.some((s) => s.data?.includes('u1 的结果'))).toBe(false);
    h.fire();
    expect(h.pending.at(-1)!.q).toBe('李晨阳');
    h.pending.at(-1)!.resolve(['u2 的结果']);
    await flush();
    expect(h.last().data).toEqual(['u2 的结果']);
  });

  it('断网：只报错，同一个词已经显示的结果留着；换了词的旧结果不冒充新词', async () => {
    const h = harness();
    h.runner.update('u1:s1', '小狐');
    h.fire();
    h.pending[0]!.resolve(['小狐狸']);
    await flush();
    // 同一个词再查一次（例如重新聚焦）不会重复请求。
    h.runner.update('u1:s1', '小狐');
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(0);
    h.runner.update('u1:s1', '小狐狸');
    h.fire();
    h.pending[1]!.reject(new Error('offline'));
    await flush();
    expect(h.last()).toMatchObject({ key: '小狐狸', dataKey: '', data: null, error: '网络不可用' });
    h.runner.update('u1:s1', '小狐');
    h.fire();
    h.pending[2]!.resolve(['小狐狸']);
    await flush();
    h.runner.update('u1:s1', '小狐 ');
    expect(h.timers.filter((t) => !t.cleared)).toHaveLength(0);
  });

  it('清空输入立刻清空联想，在途请求作废', async () => {
    const h = harness();
    h.runner.update('u1:s1', '王一');
    h.fire();
    h.runner.update('u1:s1', '   ');
    expect(h.last()).toMatchObject({ key: '', data: null, loading: false });
    h.pending[0]!.resolve(['王一博']);
    await flush();
    expect(h.last().data).toBeNull();
  });

  it('请求闸门只认最后一次，且账号与搜索词都要对得上', () => {
    const gate = new RequestGate();
    const a = gate.begin('u1', 'q');
    const b = gate.begin('u1', 'q');
    expect(gate.accept(a, 'u1', 'q')).toBe(false);
    expect(gate.accept(b, 'u2', 'q')).toBe(false);
    expect(gate.accept(b, 'u1', 'other')).toBe(false);
    expect(gate.accept(b, 'u1', 'q')).toBe(true);
    gate.reset();
    expect(gate.accept(b, 'u1', 'q')).toBe(false);
  });
});
