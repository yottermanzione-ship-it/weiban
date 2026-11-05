import 'reflect-metadata';
import { expect, it } from 'vitest';
import { ScenarioModeOption, type AdminScenarioMode } from '@weiban/contracts';
import { ScenarioCatalog } from './scenario-catalog.js';

const preset = (patch: Partial<AdminScenarioMode> = {}): AdminScenarioMode => ({
  id: 'gentle',
  name: '温柔倾听',
  description: '先倾听再回应',
  presetPrompt: 'SCENE_ONLY_CANARY',
  appliesTo: 'all',
  hasRomanceContent: false,
  hasAdultContent: false,
  isBuiltin: false,
  enabled: true,
  sortOrder: 9,
  updatedAt: '2026-11-05T00:00:00.000Z',
  ...patch,
});

it('旧模式列表仍能被旧枚举解析，自定义提示词不泄露到公开选择列表', async () => {
  const catalog = new ScenarioCatalog({ listScenarioModes: async () => [preset()] });
  const options = catalog.options(await catalog.list());
  expect(ScenarioModeOption.array().safeParse(options.items).success).toBe(true);
  expect(options.items.map((mode) => mode.id)).not.toContain('gentle');
  expect(options.customItems).toContainEqual(
    expect.objectContaining({ id: 'daily', presetId: 'gentle', aiReady: true }),
  );
  expect(JSON.stringify(options)).not.toContain('SCENE_ONLY_CANARY');
});

it('停用或无提示词的新增模式不可选；修改和删除不需要等待目录缓存过期', async () => {
  let rows = [
    preset(),
    preset({ id: 'empty', presetPrompt: ' ' }),
    preset({ id: 'off', enabled: false }),
  ];
  const catalog = new ScenarioCatalog({ listScenarioModes: async () => rows });
  expect((await catalog.list()).filter((m) => m.custom).map((m) => m.modeId)).toEqual(['gentle']);
  const settings = { scenarioMode: 'daily' as const, scenarioPresetId: 'gentle' };
  expect(await catalog.prompt(settings, 'normal')).toContain('SCENE_ONLY_CANARY');
  rows = [preset({ presetPrompt: 'REVISED_SCENE' })];
  expect(await catalog.prompt(settings, 'normal')).toContain('REVISED_SCENE');
  rows = [];
  expect(await catalog.prompt(settings, 'normal')).toBeNull();
});

it('适用范围合入资格检查；私密预设不能注入普通范围', async () => {
  const catalog = new ScenarioCatalog({
    listScenarioModes: async () => [
      preset({ id: 'grown', appliesTo: 'non_minor' }),
      preset({ id: 'fictional_adult', appliesTo: 'adult_eligible' }),
      preset({ id: 'private_scene', hasAdultContent: true }),
    ],
  });
  const modes = await catalog.list();
  expect(modes.find((m) => m.modeId === 'grown')?.containsRomance).toBe(true);
  expect(modes.find((m) => m.modeId === 'fictional_adult')?.containsAdultContent).toBe(true);
  expect(modes.find((m) => m.modeId === 'private_scene')?.baseMode).toBe('adult');
  const settings = { scenarioMode: 'adult' as const, scenarioPresetId: 'private_scene' };
  expect(await catalog.prompt(settings, 'normal')).toBeNull();
  expect(await catalog.prompt(settings, 'adult')).toContain('平台边界优先');
});
