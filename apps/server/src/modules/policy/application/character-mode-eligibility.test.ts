import 'reflect-metadata';
import { expect, it } from 'vitest';
import { PolicyService } from './policy.js';
const modes = [
  { modeId: 'daily', containsAdultContent: false, containsRomance: false },
  { modeId: 'adult', containsAdultContent: true, containsRomance: true },
  { modeId: 'romance', containsAdultContent: false, containsRomance: true },
];
async function allowed(change: Record<string, unknown> = {}) {
  const service = new PolicyService(
    {
      getForRuntime: async () => ({
        profile: { kind: 'preset' },
        card: null,
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult',
          childAppearance: false,
          childFeaturesDetected: false,
          ...change,
        },
      }),
    } as never,
    { record: async () => {} } as never,
  );
  return (
    await service.listAllowedScenarioModes({
      userId: 'fixture-user',
      characterId: 'fixture-role',
      adminAllowlist: ['daily'],
      candidates: modes,
    })
  ).map((m) => m.modeId);
}
it('合格成年虚构角色私密资格不再被人物卡允许列表二次否定', async () => {
  expect(await allowed()).toEqual(['daily', 'adult']);
});
it('允许列表不绕过未成年、儿童外貌、儿童特征或真人资格门禁', async () => {
  for (const flags of [
    { ageSetting: 'minor' },
    { childAppearance: true },
    { childFeaturesDetected: true },
    { basis: 'real_person', realPersonKind: 'celebrity' },
  ])
    expect(await allowed(flags)).toEqual(['daily']);
});
