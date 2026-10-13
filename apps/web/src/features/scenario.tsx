/*
 * 情景预设（docs/refactor/02 第 5 节）：聊天「+」面板与私聊副标题打开同一个弹层。
 * 顺序、资格、说明都以服务器 listModes 为准（section = private 放底部「私密」一栏；没资格的不返回）。
 */
import { useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowFatUp,
  Check,
  Heart,
  Lightning,
  LockSimple,
  Moon,
  Sparkle,
  Sun,
  type IconProps,
} from './old-icons.js';
import {
  CompanionEndpoints,
  GroupCompanionEndpoints,
  ModelAccessEndpoints,
  type ScenarioMode,
  type ScenarioModeOption,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { Sheet } from './shell-kit.js';
import { Dialog, showToast } from './toast.js';

export type ScenarioTarget =
  { kind: 'character'; characterId: string } | { kind: 'group'; conversationId: string };

/** 显示名（服务器没给名字时兜底；系统提示「已切换到…」也用它）。 */
export const presetNames: Record<string, string> = {
  auto: '自动',
  daily: '日常聊天',
  romance: '情侣暧昧',
  treehole: '树洞分享',
  tsundere: '傲娇斗嘴',
  cheer: '加油打气',
  adult: '私密',
};
const presetIcons: Record<string, ComponentType<IconProps>> = {
  auto: Sparkle,
  daily: Sun,
  romance: Heart,
  treehole: Moon,
  tsundere: Lightning,
  cheer: ArrowFatUp,
  adult: LockSimple,
};
/** 私聊副标题：日常聊天不显示；成人内容显示「私密」。 */
export function presetSubtitle(mode: string | undefined): string | null {
  if (!mode || mode === 'daily') return null;
  return presetNames[mode] ?? null;
}

/** 当前预设（私聊读陪伴设置，群聊读群设置）。 */
export function useCurrentPreset(target: ScenarioTarget | null) {
  const character = useRemote(
    CompanionEndpoints.getForCharacter,
    {
      params: { characterId: target?.kind === 'character' ? target.characterId : '' },
    },
    target?.kind === 'character',
  );
  const group = useRemote(
    GroupCompanionEndpoints.getSettings,
    {
      params: { conversationId: target?.kind === 'group' ? target.conversationId : '' },
    },
    target?.kind === 'group',
  );
  const mode = target?.kind === 'group' ? group.data?.scenarioMode : character.data?.scenarioMode;
  return {
    mode: mode as ScenarioMode | undefined,
    refresh: target?.kind === 'group' ? group.refresh : character.refresh,
  };
}

const ADULT_INTRO_SEEN = 'weiban:private-preset-intro-seen';
function introSeen() {
  try {
    return localStorage.getItem(ADULT_INTRO_SEEN) === '1';
  } catch {
    return false;
  }
}

export function ScenarioSheet({
  target,
  current,
  onClose,
  onChanged,
}: {
  target: ScenarioTarget;
  current: string | undefined;
  onClose(): void;
  onChanged(mode: ScenarioMode): void;
}) {
  const navigate = useNavigate();
  const characterModes = useRemote(
    CompanionEndpoints.listModes,
    {
      params: { characterId: target.kind === 'character' ? target.characterId : '' },
    },
    target.kind === 'character',
  );
  const groupModes = useRemote(
    GroupCompanionEndpoints.listModes,
    {
      params: { conversationId: target.kind === 'group' ? target.conversationId : '' },
    },
    target.kind === 'group',
  );
  const modes = target.kind === 'group' ? groupModes : characterModes;
  const [pending, setPending] = useState(false);
  const [prompt, setPrompt] = useState<'model' | 'intro' | null>(null);
  const items = modes.data?.items ?? [];
  const presets = items.filter(
    (m) => (m.section ?? (m.id === 'adult' ? 'private' : 'preset')) === 'preset',
  );
  const privates = items.filter(
    (m) => (m.section ?? (m.id === 'adult' ? 'private' : 'preset')) === 'private',
  );

  async function apply(id: ScenarioMode) {
    setPending(true);
    try {
      if (target.kind === 'group')
        await api.call(GroupCompanionEndpoints.updateSettings, {
          params: { conversationId: target.conversationId },
          body: { scenarioMode: id },
        });
      else
        await api.call(CompanionEndpoints.updateForCharacter, {
          params: { characterId: target.characterId },
          body: { scenarioMode: id },
        });
      onChanged(id);
      onClose();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'adult_model_missing') setPrompt('model');
      else if (e instanceof ApiFailure && e.code === 'adult_mode_not_eligible')
        showToast('群里有成员不能使用这个预设');
      else if (e instanceof ApiFailure && e.code === 'romance_not_allowed')
        showToast('有成员不能使用情侣暧昧');
      else showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  async function choose(option: ScenarioModeOption) {
    if (option.id === current) {
      onClose();
      return;
    }
    if (option.id !== 'adult') return apply(option.id);
    try {
      const selection = await api.call(ModelAccessEndpoints.getSelection);
      if (!selection.adult) return setPrompt('model');
    } catch {
      // 读不到时交给服务器判断
    }
    if (!introSeen()) return setPrompt('intro');
    return apply('adult');
  }
  const card = (option: ScenarioModeOption, wide = false) => {
    const Icon = presetIcons[option.id] ?? Sun;
    const selected = option.id === (current ?? 'daily');
    return (
      <button
        key={option.id}
        type="button"
        role="radio"
        aria-checked={selected}
        className={`preset-card ${wide ? 'wide' : ''}`}
        disabled={pending}
        onClick={() => void choose(option)}
      >
        <strong>
          <Icon size={20} aria-hidden />
          {option.name || presetNames[option.id]}
          {option.recommended && <span className="tag">推荐</span>}
        </strong>
        {option.description && <small>{option.description}</small>}
        {selected && <Check size={18} weight="bold" className="preset-check" aria-hidden />}
      </button>
    );
  };
  return (
    <Sheet title="情景预设" onClose={onClose} closeLabel="✕">
      {modes.loading && !modes.data && <div className="skeleton-row" role="status" />}
      {modes.error && !modes.data && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={modes.refresh}>重试</button>
        </div>
      )}
      <div className="preset-grid" role="radiogroup" aria-label="情景预设">
        {presets.map((option) => card(option, option.id === 'auto'))}
      </div>
      {privates.length > 0 && (
        <>
          <h3 className="preset-section">私密</h3>
          <div className="menu-group">
            {privates.map((option) => (
              <button
                key={option.id}
                type="button"
                className="menu-row"
                disabled={pending}
                onClick={() => void choose(option)}
              >
                <LockSimple size={20} aria-hidden />
                <span className="menu-label">成人内容</span>
                <span className="menu-value">{option.id === current ? '已开启' : '未开启'}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {prompt === 'model' && (
        <Dialog
          title="还没有选择成人模式模型"
          actions={[
            { label: '取消', onClick: () => setPrompt(null) },
            { label: '去选择', primary: true, onClick: () => navigate('/models') },
          ]}
        >
          <p className="hint">开启前，请先在「服务 › 模型」中选择成人模式模型</p>
        </Dialog>
      )}
      {prompt === 'intro' && (
        <Dialog
          title="只在你们俩之间"
          actions={[
            { label: '取消', onClick: () => setPrompt(null) },
            {
              label: '开启',
              primary: true,
              onClick: () => {
                try {
                  localStorage.setItem(ADULT_INTRO_SEEN, '1');
                } catch {
                  // 无法记住时下次再说明一次
                }
                setPrompt(null);
                void apply('adult');
              },
            },
          ]}
        >
          <p className="hint">
            这里的内容只留在你和 TA 之间：不会出现在朋友圈、其他角色那里、分享图和推送里。
          </p>
        </Dialog>
      )}
    </Sheet>
  );
}
