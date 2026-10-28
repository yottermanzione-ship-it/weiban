/**
 * V3 任务卡第 4 项复现：总经理在后台点「上架」实时模型时提示与契约有关的错误，生产日志里没有任何 PUT 到达。
 * 用服务端真实的 GET 返回形状（realtime-fixture.ts）走一遍后台的两道契约校验：
 * 1. 列表逐行按 AdminModel 校验（list-parse.ts）——不通过的行被藏起来、只显示「不符合契约」警告，根本没有上架按钮；
 * 2. 上架 / 下架的请求体 `{ ...toWrite(m), enabled }` 在 client-core 发请求前按 AdminModelWrite 校验。
 * 修复前（契约里响应的服务单价是严格枚举、最多 5 项）：服务器多了页面不认识的计价单位（4.5 的音频单位之于旧页面、
 * 4.6 的 voice_clone 之于 4.5 页面）时整行被判不符合契约。
 */
import { describe, expect, it } from 'vitest';
import { AdminModelWrite } from '@weiban/contracts';
import { parseAdminModels } from './list-parse.js';
import { toWrite } from './shared.js';
import { REALTIME_ROWS, ROW_WITH_FUTURE_UNIT } from './realtime-fixture.js';

describe('后台「模型」列表：实时通话模型能列出、能上架 / 下架', () => {
  it('四个实时通话模型（含复刻价 voice_clone）全部列出，没有「不符合契约」的行', () => {
    const parsed = parseAdminModels(REALTIME_ROWS);
    expect(parsed.issues).toEqual([]);
    expect(parsed.models.map((m) => m.modelKey)).toEqual([
      'qwen/qwen-audio-3.0-realtime-plus',
      'qwen/qwen-audio-3.1-realtime-plus',
      'qwen/qwen3.5-omni-plus-realtime',
      'qwen/qwen3.8-omni-flash-realtime',
    ]);
  });

  it('上架 / 下架的请求体通过 AdminModelWrite（client-core 发请求前不会拦下）', () => {
    for (const m of parseAdminModels(REALTIME_ROWS).models)
      for (const enabled of [true, false]) {
        const body = AdminModelWrite.safeParse({ ...toWrite(m), enabled });
        expect(body.success, `${m.modelKey} enabled=${enabled}: ${body.error?.message}`).toBe(true);
        // 上架只改启用状态：不回写服务单价（服务器上原样保留），不改 token 价格以外的东西
        expect(body.data && 'serviceRates' in body.data ? body.data.serviceRates : undefined).toBe(
          undefined,
        );
      }
  });

  it('服务器比页面新、多了页面不认识的计价单位：这一行仍然列出，也能上架', () => {
    const parsed = parseAdminModels([ROW_WITH_FUTURE_UNIT]);
    expect(parsed.issues).toEqual([]);
    const [m] = parsed.models;
    expect(m?.modelKey).toBe('qwen/qwen3.5-omni-plus-realtime');
    expect(AdminModelWrite.safeParse({ ...toWrite(m!), enabled: true }).success).toBe(true);
  });
});
