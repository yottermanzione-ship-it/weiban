/*
 * 情景模式的本机界面偏好（不跟账号同步、不改后端契约）：
 * - 「显示情景模式」开关按账号隔离，默认关闭；
 * - 上次普通模式按账号 + 会话（角色 / 群）隔离，用于从私密退出时恢复。
 * 写法跟 display-prefs / seen 一致：localStorage + 自定义事件，跨组件立即刷新。
 */
import { useCallback, useEffect, useState } from 'react';
import type { ScenarioMode } from '@weiban/contracts';
import { useAuth } from '../app/auth.js';

const EVENT = 'weiban:scenario-prefs';
const BADGE_PREFIX = 'weiban:scenario-badge:';
const LAST_PREFIX = 'weiban:scenario-last-normal:';

/** 可恢复的普通模式；私密与已下架的情侣暧昧不参与「上次普通模式」。 */
const NORMAL_MODES = new Set<string>(['auto', 'daily', 'tsundere', 'treehole', 'cheer']);

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 无痕模式等：只在本次页面内由 React 状态维持。
  }
  window.dispatchEvent(new Event(EVENT));
}

export function scenarioBadgeKey(userId: string | null | undefined) {
  return `${BADGE_PREFIX}${userId || 'anon'}`;
}

export function getScenarioBadgeVisible(userId: string | null | undefined) {
  return read(scenarioBadgeKey(userId)) === 'on';
}

export function setScenarioBadgeVisible(userId: string | null | undefined, visible: boolean) {
  write(scenarioBadgeKey(userId), visible ? 'on' : 'off');
}

/** 开关状态；换账号自动切到该账号自己的值。 */
export function useScenarioBadgeVisible() {
  const { session } = useAuth();
  const userId = session?.user.userId ?? null;
  const [visible, setVisible] = useState(() => getScenarioBadgeVisible(userId));
  useEffect(() => {
    const refresh = () => setVisible(getScenarioBadgeVisible(userId));
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [userId]);
  const update = useCallback(
    (next: boolean) => {
      setVisible(next);
      setScenarioBadgeVisible(userId, next);
    },
    [userId],
  );
  return [visible, update] as const;
}

export function scenarioTargetKey(
  target: { kind: 'character'; characterId: string } | { kind: 'group'; conversationId: string },
) {
  return target.kind === 'character'
    ? `character:${target.characterId}`
    : `group:${target.conversationId}`;
}

export function isNormalScenarioMode(value: string | null | undefined): value is ScenarioMode {
  return !!value && NORMAL_MODES.has(value);
}

function lastNormalKey(userId: string | null | undefined, targetKey: string) {
  return `${LAST_PREFIX}${userId || 'anon'}:${targetKey}`;
}

/** 上次普通模式；没有记录或记录已不可用时返回 null，由调用方按可用列表兜底。 */
export function getLastNormalMode(
  userId: string | null | undefined,
  targetKey: string,
): ScenarioMode | null {
  const value = read(lastNormalKey(userId, targetKey));
  return isNormalScenarioMode(value) ? value : null;
}

export function rememberLastNormalMode(
  userId: string | null | undefined,
  targetKey: string,
  mode: string | null | undefined,
) {
  if (!isNormalScenarioMode(mode)) return;
  write(lastNormalKey(userId, targetKey), mode);
}
