/*
 * 情景预设（docs/refactor/02 第 5 节）：聊天「+」面板与私聊副标题打开同一个弹层。
 * 顺序、资格、说明都以服务器 listModes 为准；私密与普通预设使用同一种行样式（没资格的不返回）。
 */
import { useState } from 'react';
import { OldIcon } from './old-icons.js';
import {
  CompanionEndpoints,
  GroupCompanionEndpoints,
  type ScenarioMode,
  type ScenarioModeOption,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { api } from '../data/client.js';
import {
  loadPlatformPrivateModel,
  type PlatformPrivateModel,
} from '../data/platform-private-model.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import {
  getLastNormalMode,
  isNormalScenarioMode,
  rememberLastNormalMode,
  scenarioTargetKey,
  useScenarioBadgeVisible,
} from '../data/scenario-prefs.js';
import { multiplierText } from './points.js';
import { IconTile, MenuGroup, MenuRow, Sheet, SwitchRow, type Tint } from './shell-kit.js';
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
  adult: '私密模式',
};
/** 情景预设图标（5.3）：40 彩色方块 + 白图标；情侣暧昧是唯一用心形的地方。 */
const presetLook: Record<string, { icon: string; tint: Tint }> = {
  auto: { icon: 'drawn/scenario_sparkle', tint: 'green' },
  daily: { icon: 'wechat/smile', tint: 'orange' },
  romance: { icon: 'wechat/heart', tint: 'red' },
  treehole: { icon: 'wechat/note', tint: 'purple' },
  tsundere: { icon: 'wechat/chat', tint: 'gold' },
  cheer: { icon: 'wechat/star', tint: 'blue' },
  adult: { icon: 'wechat/chat_pair', tint: 'purple' },
};
/** 私聊副标题：日常聊天不显示；成人内容显示「私密」。 */
export function presetSubtitle(mode: string | undefined): string | null {
  if (!mode || mode === 'daily') return null;
  return presetNames[mode] ?? null;
}

function discountText(rate: number) {
  const tenth = Math.round(rate * 100) / 10;
  return `限时 ${Number.isInteger(tenth) ? tenth.toFixed(0) : tenth.toFixed(1)} 折`;
}

/** private-model 的 displayMultiplier 已经含折扣；discountRate 只用于「限时几折」文案。 */
function actualMultiplier(model: PlatformPrivateModel): string | null {
  if (model.displayMultiplier == null) return null;
  return multiplierText({ displayMultiplier: model.displayMultiplier }) || null;
}

/**
 * 私密模式确认框（纯展示）。
 * 模型信息由上层按平台权威源解析后传入；这里不读取用户/角色自己的 adult 选择，也不给选模型入口。
 */
export function PrivateModeConfirmDialog({
  model,
  onCancel,
  onConfirm,
}: {
  model: PlatformPrivateModel;
  onCancel(): void;
  onConfirm(): void;
}) {
  const multiplier = actualMultiplier(model);
  const discount =
    model.discountRate != null && model.discountRate < 1 ? discountText(model.discountRate) : null;
  return (
    <Dialog
      title="开启私密模式"
      actions={[
        { label: '取消', onClick: onCancel },
        { label: '开启私密模式', tone: 'primary', onClick: onConfirm },
      ]}
    >
      <p className="hint">
        {`将切换到平台统一的私密模型「${model.displayName || '私密模型'}」`}
        {multiplier
          ? `，当前实际倍率 ${multiplier}${discount ? `（${discount}）` : ''}，可能增加积分消耗。`
          : '，当前倍率暂时读不到，实际按所选模型用量扣费。'}
      </p>
      <p className="hint">私密模式仅支持文字和图片聊天。</p>
    </Dialog>
  );
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

export function ScenarioSheet({
  target,
  current,
  privateModel,
  onClose,
  onChanged,
}: {
  target: ScenarioTarget;
  current: string | undefined;
  /**
   * 平台固定私密模型信息（由权威源解析后传入）。undefined = 让本组件走默认读取器；
   * null = 暂不可用。普通用户/角色自己的 adult 选择永远不会从这里或默认读取器回退。
   */
  privateModel?: PlatformPrivateModel | null;
  onClose(): void;
  onChanged(mode: ScenarioMode): void;
}) {
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
  const { session } = useAuth();
  const userId = session?.user.userId;
  const [badgeVisible, setBadgeVisible] = useScenarioBadgeVisible();
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [prompt, setPrompt] = useState<
    'not-configured' | 'unavailable' | 'unreadable' | 'intro' | null
  >(null);
  const [quote, setQuote] = useState<PlatformPrivateModel | null>(null);
  const items = modes.data?.items ?? [];

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
      if (e instanceof ApiFailure && e.code === 'adult_model_missing') setPrompt('unavailable');
      else if (e instanceof ApiFailure && e.code === 'adult_mode_not_eligible')
        showToast('群里有成员不能使用这个预设');
      else if (e instanceof ApiFailure && e.code === 'romance_not_allowed')
        showToast('有成员不能使用情侣暧昧');
      else showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }

  /** 退出私密：回到上次普通模式；没有记录或已不可用时用自动，再退到第一个可用普通模式。 */
  async function exitPrivate() {
    const key = scenarioTargetKey(target);
    const allowed = items.filter((m) => m.id !== 'adult').map((m) => m.id);
    const last = getLastNormalMode(userId, key);
    const next: ScenarioMode =
      last && allowed.includes(last)
        ? last
        : allowed.includes('auto')
          ? 'auto'
          : ((allowed[0] as ScenarioMode | undefined) ?? 'auto');
    await apply(next);
  }

  function enterPrivate() {
    if (current && current !== 'adult' && isNormalScenarioMode(current))
      rememberLastNormalMode(userId, scenarioTargetKey(target), current);
    setPrompt(null);
    void apply('adult');
  }

  async function choose(option: ScenarioModeOption) {
    if (pending || checking) return;
    if (option.id === current) {
      // 再点已选私密 = 关闭并恢复上一次普通模式；普通模式重复点只关闭，不重复保存。
      if (option.id === 'adult') return exitPrivate();
      onClose();
      return;
    }
    if (option.id !== 'adult') return apply(option.id);
    setChecking(true);
    try {
      // 平台固定模型：优先用上层按权威源解析好的结果；否则读 private-model 只读接口。
      const next = privateModel !== undefined ? privateModel : await loadPlatformPrivateModel();
      if (!next) {
        setPrompt('not-configured');
        return;
      }
      if (!next.available) {
        setPrompt('unavailable');
        return;
      }
      setQuote(next);
      setPrompt('intro');
    } catch {
      // 读不到权威配置时明确不可用，不退回用户/角色自己的成人模型。
      setPrompt('unreadable');
    } finally {
      setChecking(false);
    }
  }
  const row = (option: ScenarioModeOption) => {
    const look = presetLook[option.id] ?? presetLook.daily!;
    const selected = option.id === (current ?? 'daily');
    return (
      <MenuRow
        key={option.id}
        disabled={pending || checking}
        chevron={false}
        onClick={() => void choose(option)}
        label={
          <>
            <IconTile icon={look.icon} tint={look.tint} size="md" />
            <span className="row-name">
              {option.id === 'adult'
                ? '私密模式'
                : option.name || presetNames[option.id] || option.id}
              {option.recommended && <span className="mini-tag">推荐</span>}
            </span>
          </>
        }
        subtitle={option.description || undefined}
        right={
          selected ? <OldIcon name="wechat/check" size={22} className="ink-brand" /> : undefined
        }
      />
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
      {/* 私密和普通预设同一张列表、同一种行样式（图标 / 标题 / 副标题 / 选中勾）。 */}
      <MenuGroup className="preset-list" guideId="scenario-options">
        {items.map((option) => row(option))}
      </MenuGroup>
      <MenuGroup className="scenario-display-pref">
        <SwitchRow
          label="显示情景模式"
          subtitle="在聊天顶部昵称旁显示当前模式"
          checked={badgeVisible}
          onChange={setBadgeVisible}
        />
      </MenuGroup>
      {prompt === 'not-configured' && (
        <Dialog
          title="私密模式暂不可用"
          actions={[{ label: '知道了', tone: 'primary', onClick: () => setPrompt(null) }]}
        >
          <p className="hint">平台还没有配置固定的私密模型，暂时不能开启。</p>
        </Dialog>
      )}
      {prompt === 'unavailable' && (
        <Dialog
          title="私密模式暂不可用"
          actions={[{ label: '知道了', tone: 'primary', onClick: () => setPrompt(null) }]}
        >
          <p className="hint">平台固定的私密模型暂时不可用，稍后再试。</p>
        </Dialog>
      )}
      {prompt === 'unreadable' && (
        <Dialog
          title="私密模式暂不可用"
          actions={[{ label: '知道了', tone: 'primary', onClick: () => setPrompt(null) }]}
        >
          <p className="hint">暂时读不到平台的私密模型配置，稍后再试。</p>
        </Dialog>
      )}
      {prompt === 'intro' && quote && (
        <PrivateModeConfirmDialog
          model={quote}
          onCancel={() => setPrompt(null)}
          onConfirm={enterPrivate}
        />
      )}
    </Sheet>
  );
}
