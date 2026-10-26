import { expect, it } from 'vitest';
import { AdminVoiceWrite, Voice, VoiceAdminEndpoints } from '../src/http/assets.js';

const historical = {
  voiceId: '11111111-1111-4111-8111-111111111111',
  name: '旧'.repeat(25),
  tags: ['legacy'],
  sampleMediaId: null,
  sampleUrl: null,
  enabled: true,
  providerVoiceKey: 'fictional-test-voice',
  modelKey: 'test/tts',
  careFallbackMediaId: null,
  updatedAt: '2026-10-27T00:00:00.000Z',
};

it('第376条历史长名称不再阻断整库，名称和供应商绑定原样保留', () => {
  const items = Array.from({ length: 376 }, (_, i) => ({
    ...historical,
    name: i === 375 ? historical.name : '测试音色',
  }));
  const result = VoiceAdminEndpoints.listVoices.response.parse({ items });
  expect(result.items[375]!.name).toBe(historical.name);
  expect(result.items[375]!.providerVoiceKey).toBe(historical.providerVoiceKey);
  expect(Voice.parse(historical).name).toBe(historical.name);
});

it('读取兼容不放宽新建/编辑20字约束，也不改供应商代号64字约束', () => {
  expect(AdminVoiceWrite.safeParse(historical).success).toBe(false);
  expect(AdminVoiceWrite.safeParse({ ...historical, name: '新'.repeat(20) }).success).toBe(true);
  expect(AdminVoiceWrite.partial().safeParse({ name: '新'.repeat(21) }).success).toBe(false);
  expect(
    VoiceAdminEndpoints.listVoices.response.safeParse({
      items: [{ ...historical, providerVoiceKey: 'x'.repeat(65) }],
    }).success,
  ).toBe(false);
});
