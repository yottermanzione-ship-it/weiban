import { Inject, Injectable } from '@nestjs/common';
import type {
  CompanionSettings,
  ScenarioMode,
  ScenarioModeReadPort,
  ScenarioModeTraits,
  Tx,
} from '@weiban/contracts';
import { SCENARIO_MODE_READ_PORT } from '../../characters/index.js';
import { INITIAL_MODES, SELECTABLE_MODES, modeOption } from '../domain/persona.js';

export interface RuntimeScenario extends ScenarioModeTraits {
  baseMode: ScenarioMode;
  name: string;
  description: string;
  prompt: string | null;
  custom: boolean;
  order: number;
}

/** 不缓存目录，确保停用、资格收紧和提示词修改在下一次使用前可见。 */
@Injectable()
export class ScenarioCatalog {
  constructor(@Inject(SCENARIO_MODE_READ_PORT) private readonly reader: ScenarioModeReadPort) {}

  async list(tx?: Tx): Promise<RuntimeScenario[]> {
    const rows = await this.reader.listScenarioModes(tx);
    const builtins = SELECTABLE_MODES.flatMap((mode, index) => {
      const row = rows.find((item) => item.id === mode.modeId);
      // 日常是停用后的安全回落，不能被管理员关闭。
      if (row?.enabled === false && mode.modeId !== 'daily') return [];
      return [
        {
          ...mode,
          baseMode: mode.modeId,
          custom: false,
          name: row?.name ?? mode.name,
          description: row?.description ?? mode.description,
          prompt: row?.presetPrompt?.trim() || null,
          order: row?.sortOrder ?? index,
        },
      ];
    });
    const custom: RuntimeScenario[] = rows
      .filter(
        (row) =>
          !row.isBuiltin &&
          row.enabled &&
          !!row.presetPrompt?.trim() &&
          !INITIAL_MODES.some((mode) => mode.modeId === row.id),
      )
      .map((row) => ({
        modeId: row.id,
        baseMode: row.hasAdultContent ? 'adult' : 'daily',
        name: row.name,
        description: row.description,
        prompt: row.presetPrompt!.trim(),
        custom: true,
        order: row.sortOrder,
        containsRomance: row.hasRomanceContent || row.appliesTo === 'non_minor',
        containsAdultContent: row.hasAdultContent || row.appliesTo === 'adult_eligible',
        allowlistFallback: row.hasAdultContent ? 'adult' : 'daily',
      }));
    return [...builtins, ...custom].sort(
      (a, b) => a.order - b.order || a.modeId.localeCompare(b.modeId),
    );
  }

  options(modes: RuntimeScenario[]) {
    const option = (mode: RuntimeScenario) => ({
      ...modeOption(INITIAL_MODES.find((m) => m.modeId === mode.baseMode)!),
      name: mode.name,
      description: mode.description,
    });
    return {
      items: modes.filter((m) => !m.custom).map(option),
      customItems: modes.filter((m) => m.custom).map((m) => ({ ...option(m), presetId: m.modeId })),
    };
  }

  async prompt(
    settings: Pick<CompanionSettings, 'scenarioMode' | 'scenarioPresetId'>,
    scope: 'normal' | 'adult',
    tx?: Tx,
  ): Promise<string | null> {
    const mode = (await this.list(tx)).find(
      (m) => m.modeId === (settings.scenarioPresetId ?? settings.scenarioMode ?? 'daily'),
    );
    if (!mode?.prompt || (mode.baseMode === 'adult' && scope !== 'adult')) return null;
    return `【当前情景预设：${mode.name}】\n只调整本次对话的表达和互动方式，不改变角色身份、记忆、关系阶段或用户意愿；角色和平台边界优先。自然体现新情景，不解释“进入模式”，不延续上一预设的特殊口吻。\n${mode.prompt}`;
  }
}
