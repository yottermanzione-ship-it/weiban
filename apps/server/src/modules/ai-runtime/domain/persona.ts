import type { ScenarioModeTraits, ScenarioMode } from '@weiban/contracts';
import { SCENARIO_DEFAULT_PROMPTS as MODES } from '../../characters/index.js';
/**
 * 情景预设（docs/refactor/02 第 5.3 节），顺序即弹层顺序。
 * 三个新预设（auto / treehole / cheer）的 AI 策略见 domain/scenario.ts（2026-10-13 实现，aiReady = true）；
 * allowlistFallback 让旧角色卡的管理员允许列表按 daily 判断它们。「自动」是新账号默认预设（settings.ts）。
 * 显示名「私密」等改名待产品更新 MODE-01 确认。
 */
export const INITIAL_MODES: (ScenarioModeTraits & {
  modeId: ScenarioMode;
  name: string;
  description: string;
  section: 'preset' | 'private';
  recommended: boolean;
  aiReady: boolean;
})[] = [
  {
    modeId: 'auto',
    name: '自动',
    description: 'TA 看你当下的状态自己调整',
    section: 'preset',
    recommended: true,
    aiReady: true,
    containsRomance: false,
    containsAdultContent: false,
    allowlistFallback: 'daily',
  },
  {
    modeId: 'daily',
    name: '日常聊天',
    description: '像朋友一样聊',
    section: 'preset',
    recommended: false,
    aiReady: true,
    containsRomance: false,
    containsAdultContent: false,
  },
  {
    modeId: 'romance',
    name: '情侣暧昧',
    description: '甜一点、黏一点',
    section: 'preset',
    recommended: false,
    aiReady: true,
    containsRomance: true,
    containsAdultContent: false,
  },
  {
    modeId: 'treehole',
    name: '树洞分享',
    description: '多听少说，不评判',
    section: 'preset',
    recommended: false,
    aiReady: true,
    containsRomance: false,
    containsAdultContent: false,
    allowlistFallback: 'daily',
  },
  {
    modeId: 'tsundere',
    name: '傲娇斗嘴',
    description: '嘴硬心软，爱怼你',
    section: 'preset',
    recommended: false,
    aiReady: true,
    containsRomance: false,
    containsAdultContent: false,
  },
  {
    modeId: 'cheer',
    name: '加油打气',
    description: '给你打气，也会督促你',
    section: 'preset',
    recommended: false,
    aiReady: true,
    containsRomance: false,
    containsAdultContent: false,
    allowlistFallback: 'daily',
  },
  {
    modeId: 'adult',
    name: '私密',
    description: '不可描述的情景',
    section: 'private',
    recommended: false,
    aiReady: true,
    containsRomance: true,
    containsAdultContent: true,
  },
];

/**
 * 3.27（H1，总经理 10-21：有好感度机制就不要手选恋爱）：用户能选的预设去掉「情侣暧昧」，恋爱表达只随好感度阶段。
 * INITIAL_MODES 仍保留 romance 定义，只为旧数据与资格判断不报错（迁移 0128 已把旧设置改为自动 / 日常）。
 */
export const SELECTABLE_MODES = INITIAL_MODES.filter((mode) => mode.modeId !== 'romance');

/** 情景预设弹层一项（listModes 响应）。 */
export function modeOption(mode: (typeof INITIAL_MODES)[number]) {
  return {
    id: mode.modeId,
    name: mode.name,
    description: mode.description,
    section: mode.section,
    recommended: mode.recommended,
    aiReady: mode.aiReady,
  };
}
const FIT = [
  '尽量满足用户合理要求，不唱反调，不冷落用户。',
  '可以表达不同意见，但尽快让步，不冷落用户。',
  '保持角色性格，合理要求答应，冲突要求可拒绝或协商。',
  '坚持角色立场，明确拒绝与性格冲突的要求。',
  '完全保持角色性格，不为了迎合改变身份、价值观或说话方式。',
];
/** 群聊等只需要一句话描述当前预设的地方用。 */
export function scenarioText(mode: ScenarioMode): string {
  return MODES[mode] ?? MODES.daily;
}
export function personaPrompt(input: {
  fit: number;
  mode: ScenarioMode;
  /** 3.25：好感度阶段一段（relationshipStageText）。给了就由它决定恋爱表达，不再一律「不要表白」。 */
  stageText?: string;
  /** 配置中的预设已在独立段落提供，不能再叠加不可编辑的默认风格。 */
  configuredScenario?: boolean;
}): string {
  // 3.27（H1，总经理 10-21）：关系类型选择已删除，恋爱表达只随好感度阶段（stageText）。
  const romanceRule =
    input.stageText !== undefined
      ? `\n${input.stageText}`
      : '不要主动表白、暗示恋爱或使用恋爱称呼。';
  return `人设贴合度${input.fit}/5：${FIT[input.fit - 1] ?? FIT[2]}\n情景模式：${input.configuredScenario ? '按下方当前情景预设执行' : MODES[input.mode]}\n你们的关系由相处中的好感度阶段决定，不自称升级关系。${romanceRule}`;
}
