/**
 * 3.9（总对照表 Q11）：把用户「我的状态」写成私聊动态结尾里的一行（docs/refactor/09 第 4 节「动态结尾」）。
 * 只在有未过期状态时出现；放在动态结尾，不影响稳定开头的缓存。
 */
import { USER_STATUS_PRESETS, type UserStatus } from '@weiban/contracts';

function ago(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} 分钟前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

export function userStatusLine(status: UserStatus | null, now: Date): string {
  if (!status) return '';
  const presetLabel = USER_STATUS_PRESETS.find((p) => p.preset === status.preset)?.label;
  const what =
    status.preset === 'custom' || !presetLabel
      ? `「${status.label}」`
      : status.text
        ? `${presetLabel}（${status.text}）`
        : presetLabel;
  const since = ago(now.getTime() - Date.parse(status.setAt));
  const quiet = status.quiet
    ? '对方现在想安静 / 在忙：回复简短温和，不追问、不催对方回消息、不连发。'
    : '';
  return `【用户当前状态】${what}（${since}设置）。如果自然，可以按你的性格关心一句，但不要每轮都提，也不要说你是从状态里看到的以外的细节。${quiet}`;
}
