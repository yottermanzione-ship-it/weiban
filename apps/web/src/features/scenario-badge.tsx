import '../app/scenario.css';
import { useScenarioBadgeVisible } from '../data/scenario-prefs.js';

/** 聊天顶栏用的短名，避免内部 key 和长标题挤掉返回 / 更多按钮。 */
const shortNames: Record<string, string> = {
  auto: '自动',
  daily: '日常',
  romance: '暧昧',
  treehole: '树洞',
  tsundere: '傲娇',
  cheer: '加油',
  adult: '私密',
};

export function scenarioModeShortName(mode: string | null | undefined): string | null {
  return mode ? (shortNames[mode] ?? null) : null;
}

/**
 * 昵称旁的模式徽标；开关关闭或未知模式时不渲染（不占位、不影响标题省略）。
 * 开关关闭是默认状态，同账号刷新后仍保持。
 */
export function ScenarioModeBadge({ mode }: { mode?: string }) {
  const [visible] = useScenarioBadgeVisible();
  const label = scenarioModeShortName(mode);
  if (!visible || !label) return null;
  return (
    <span
      className={`scenario-mode-badge ${mode === 'adult' ? 'private' : ''}`}
      aria-label={`当前情景模式：${label}`}
    >
      {label}
    </span>
  );
}
