import { describe, expect, it } from 'vitest';
import { AdminModelWrite, CONTRACT_VERSION, type RouteBillingBounds } from '@weiban/contracts';
import { contractMismatchNotice } from '../../app/contract-version.js';
import { parseAdminModels } from './list-parse.js';
import { editableServiceRates, toWrite } from './shared.js';
import { REALTIME_ROWS, ROW_WITH_FUTURE_UNIT } from './realtime-fixture.js';

describe('V3：实时通话模型的编辑保存', () => {
  it('编辑表单只放页面认识的服务单价；页面不认识的单位不回写（服务器上原样保留）', () => {
    const [m] = parseAdminModels([ROW_WITH_FUTURE_UNIT]).models;
    expect(m!.serviceRates?.map((r) => r.unit)).toEqual([
      'audio_input_tokens_per_million',
      'audio_output_tokens_per_million',
      'voice_clone',
      'unsupported',
    ]);
    expect(editableServiceRates(m!.serviceRates).map((r) => r.unit)).toEqual([
      'audio_input_tokens_per_million',
      'audio_output_tokens_per_million',
      'voice_clone',
    ]);
    expect(editableServiceRates(undefined)).toEqual([]);
  });

  it('四个实时模型按编辑抽屉的保存方式（计费上限走高级 JSON 原样回写）都能通过 AdminModelWrite', () => {
    for (const m of parseAdminModels(REALTIME_ROWS).models) {
      const routes = (m.routes ?? []).map((r, index) => ({
        upstreamId: r.upstreamId,
        upstreamModelId: r.upstreamModelId,
        priority: index + 1,
        weight: r.weight,
        enabled: r.enabled,
        // 抽屉里实时计费上限显示成 JSON 草稿，保存时 JSON.parse 回来
        billingBounds: JSON.parse(JSON.stringify(r.billingBounds)) as RouteBillingBounds,
      }));
      const tokenMode = AdminModelWrite.safeParse({
        ...toWrite(m),
        billingBounds: routes[0]!.billingBounds,
        rates: m.rates,
        costRates: m.costRates ?? undefined,
        displayMultiplierManual: null,
        routes,
      });
      expect(tokenMode.success, `${m.modelKey}: ${tokenMode.error?.message}`).toBe(true);
      const serviceMode = AdminModelWrite.safeParse({
        ...toWrite(m),
        rates: null,
        serviceRates: editableServiceRates(m.serviceRates).map((r) => ({
          unit: r.unit,
          price: r.price,
          cost: r.cost ?? null,
        })),
        routes,
      });
      expect(serviceMode.success, `${m.modelKey}: ${serviceMode.error?.message}`).toBe(true);
    }
  });
});

describe('V3：后台页面与服务器契约版本不一致时提示刷新', () => {
  it('版本一致、拿不到、格式不对都不提示', () => {
    expect(contractMismatchNotice({ status: 'ok', contractVersion: CONTRACT_VERSION })).toBeNull();
    expect(contractMismatchNotice(null)).toBeNull();
    expect(contractMismatchNotice('<!doctype html>')).toBeNull();
    expect(contractMismatchNotice({ contractVersion: 46 })).toBeNull();
  });

  it('服务器版本不同 → 提示刷新页面', () => {
    expect(contractMismatchNotice({ contractVersion: '4.6' }, '4.5')).toContain('请刷新页面');
    expect(contractMismatchNotice({ contractVersion: '4.6' }, '4.5')).toContain('4.6');
  });
});
