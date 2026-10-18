/*
 * 情景预设（docs/refactor/02 第 5 节）：聊天「+」面板与私聊副标题打开同一个弹层。
 * 顺序、资格、说明都以服务器 listModes 为准（section = private 放底部「私密」一栏；没资格的不返回）。
 */
import { useState } from 'react';
import { OldIcon } from './old-icons.js';
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
import {
  GroupHeader,
  IconTile,
  MenuGroup,
  MenuRow,
  Sheet,
  type Tint,
} from './shell-kit.js';
import { Dialog, showToast } from './toast.js';

export type ScenarioTarget =
  | { kind: 'character'; characterId: string }
  | { kind: 'group'; conversationId: string };

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
  adult: { icon: 'wechat/info', tint: 'gray' },
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
      params: {
        characterId: target?.kind === 'character' ? target.characterId : '',
      },
    },
    target?.kind === 'character',
  );
  const group = useRemote(
    GroupCompanionEndpoints.getSettings,
    {
      params: {
        conversationId: target?.kind === 'group' ? target.conversationId : '',
      },
    },
    target?.kind === 'group',
  );
  const mode =
    target?.kind === 'group'
      ? group.data?.scenarioMode
      : character.data?.scenarioMode;
  return {
    mode: mode as ScenarioMode | undefined,
    refresh: target?.kind === 'group' ? group.refresh : character.refresh,
  };
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
  const characterModes = useRemote(
    CompanionEndpoints.listModes,
    {
      params: {
        characterId: target.kind === 'character' ? target.characterId : '',
      },
    },
    target.kind === 'character',
  );
  const groupModes = useRemote(
    GroupCompanionEndpoints.listModes,
    {
      params: {
        conversationId: target.kind === 'group' ? target.conversationId : '',
      },
    },
    target.kind === 'group',
  );
  const modes = target.kind === 'group' ? groupModes : characterModes;
  const [pending, setPending] = useState(false);
  const [prompt, setPrompt] = useState<'model' | 'intro' | null>(null);
  const items = modes.data?.items ?? [];
  const presets = items.filter(
    (m) =>
      (m.section ?? (m.id === 'adult' ? 'private' : 'preset')) === 'preset',
  );
  const privates = items.filter(
    (m) =>
      (m.section ?? (m.id === 'adult' ? 'private' : 'preset')) === 'private',
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
      if (e instanceof ApiFailure && e.code === 'adult_model_missing')
        setPrompt('model');
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
    return setPrompt('intro');
  }
  const row = (option: ScenarioModeOption) => {
    const look = presetLook[option.id] ?? presetLook.daily!;
    const selected = option.id === (current ?? 'daily');
    return (
      <MenuRow
        key={option.id}
        disabled={pending}
        chevron={false}
        onClick={() => void choose(option)}
        label={
          <>
            <IconTile icon={look.icon} tint={look.tint} size="md" />
            <span className="row-name">
              {option.name || presetNames[option.id]}
              {option.recommended && <span className="mini-tag">推荐</span>}
            </span>
          </>
        }
        subtitle={option.description || undefined}
        right={
          selected ? (
            <OldIcon name="wechat/check" size={22} className="ink-brand" />
          ) : undefined
        }
      />
    );
  };
  return (
    <Sheet title="情景预设" onClose={onClose} closeLabel="✕">
      {modes.loading && !modes.data && (
        <div className="skeleton-row" role="status" />
      )}
      {modes.error && !modes.data && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={modes.refresh}>重试</button>
        </div>
      )}
      <MenuGroup className="preset-list">
        {presets.map((option) => row(option))}
      </MenuGroup>
      {privates.length > 0 && (
        <>
          <GroupHeader>私密模式</GroupHeader>
          <MenuGroup>
            {privates.map((option) => (
              <MenuRow
                key={option.id}
                disabled={pending}
                label="私密模式"
                value={option.id === current ? '已开启' : '未开启'}
                onClick={() => void choose(option)}
              />
            ))}
          </MenuGroup>
        </>
      )}
      {prompt === 'model' && (
        <Dialog
          title="暂时无法开启私密模式"
          actions={[
            { label: '知道了', primary: true, onClick: () => setPrompt(null) },
          ]}
        >
          <p className="hint">
            尚未设置私密模式模型，当前无法开启。私密模式模型的选择入口暂未开放。
          </p>
        </Dialog>
      )}
      {prompt === 'intro' && (
        <Dialog
          title="开启私密模式"
          actions={[
            { label: '取消', onClick: () => setPrompt(null) },
            {
              label: '开启',
              primary: true,
              onClick: () => {
                setPrompt(null);
                void apply('adult');
              },
            },
          ]}
        >
          <p className="hint">
            开启后将切换到付费模型，按实际用量消耗积分。这里的内容只留在你和 TA
            之间：不会出现在朋友圈、其他角色那里、分享图和推送里。
          </p>
        </Dialog>
      )}
    </Sheet>
  );
}
