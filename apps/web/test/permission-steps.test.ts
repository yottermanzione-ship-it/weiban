import { describe, expect, it, vi } from 'vitest';
import {
  PermissionFlow,
  plannedSteps,
  type PermissionStep,
  type StepOutcome,
} from '../src/features/permission-steps.js';

/** 每次申请都挂起，由测试手动给结果，模拟系统框等用户决定。 */
function manualRequests() {
  const calls: PermissionStep[] = [];
  const answers: Array<(outcome: StepOutcome) => void> = [];
  const request = vi.fn((step: PermissionStep) => {
    calls.push(step);
    return new Promise<StepOutcome>((resolve) => answers.push(resolve));
  });
  return { calls, answers, request };
}

describe('首次权限逐个申请（T-20261103 第 1 项）', () => {
  it('逐步顺序：先只申请通知，结果回来前不会发麦克风申请；第二次点击才申请麦克风', async () => {
    const { calls, answers, request } = manualRequests();
    const flow = new PermissionFlow(
      plannedSteps({ notification: 'prompt', microphone: 'prompt' }),
      request,
    );
    expect(flow.steps).toEqual(['notification', 'microphone']);
    expect(flow.current).toBe('notification');
    const first = flow.confirm();
    // 系统申请在 confirm 里同步发出（点击的同步调用链内）
    expect(calls).toEqual(['notification']);
    // 结果回来前再点：不会连发第二个申请，也不会前进
    await expect(flow.confirm()).resolves.toBeNull();
    expect(calls).toEqual(['notification']);
    expect(flow.current).toBe('notification');
    answers[0]!('granted');
    await expect(first).resolves.toEqual({ step: 'notification', outcome: 'granted' });
    // 进入第二步也只是显示说明框，没有自动申请
    expect(flow.current).toBe('microphone');
    expect(flow.position).toBe(2);
    expect(calls).toEqual(['notification']);
    const second = flow.confirm();
    expect(calls).toEqual(['notification', 'microphone']);
    answers[1]!('granted');
    await second;
    expect(flow.done).toBe(true);
    expect(flow.current).toBeNull();
  });

  it('第一步被拒绝、关掉或出错后仍能进入第二步', async () => {
    for (const result of ['denied', 'dismissed', 'error'] as const) {
      const calls: PermissionStep[] = [];
      const flow = new PermissionFlow(['notification', 'microphone'], async (step) => {
        calls.push(step);
        if (step === 'notification' && result === 'error') throw new Error('系统框异常');
        return step === 'notification' ? (result as StepOutcome) : 'granted';
      });
      const first = await flow.confirm();
      expect(first?.outcome).toBe(result === 'error' ? 'failed' : result);
      expect(flow.current).toBe('microphone');
      await flow.confirm();
      expect(calls).toEqual(['notification', 'microphone']);
      expect(flow.done).toBe(true);
    }
  });

  it('同步抛错的申请也算这一步有结果，不卡死', async () => {
    const flow = new PermissionFlow(['notification', 'microphone'], (step) => {
      if (step === 'notification') throw new Error('不支持');
      return Promise.resolve('granted');
    });
    await expect(flow.confirm()).resolves.toEqual({ step: 'notification', outcome: 'failed' });
    expect(flow.current).toBe('microphone');
  });

  it('「暂不开启」跳过当前一步，不发系统申请', async () => {
    const { calls, request } = manualRequests();
    const flow = new PermissionFlow(['notification', 'microphone'], request);
    flow.skip();
    expect(calls).toEqual([]);
    expect(flow.current).toBe('microphone');
    flow.skip();
    expect(flow.done).toBe(true);
  });

  it('已授权的跳过对应那一步；浏览器已拒绝或不支持的也不再申请', () => {
    expect(plannedSteps({ notification: 'granted', microphone: 'prompt' })).toEqual(['microphone']);
    expect(plannedSteps({ notification: 'prompt', microphone: 'granted' })).toEqual([
      'notification',
    ]);
    expect(plannedSteps({ notification: 'granted', microphone: 'granted' })).toEqual([]);
    expect(plannedSteps({ notification: 'unsupported', microphone: 'prompt' })).toEqual([
      'microphone',
    ]);
    expect(plannedSteps({ notification: 'denied', microphone: 'unsupported' })).toEqual([]);
  });

  it('全部已授权时流程一开始就结束，不发任何申请', async () => {
    const { calls, request } = manualRequests();
    const flow = new PermissionFlow(
      plannedSteps({ notification: 'granted', microphone: 'granted' }),
      request,
    );
    expect(flow.done).toBe(true);
    await expect(flow.confirm()).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
});
