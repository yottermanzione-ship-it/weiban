import type { ReactNode } from 'react';
import { CharacterStatus } from './character-status.js';
import { ScenarioModeBadge } from './scenario-badge.js';
/**
 * 供聊天与开发样例共用，备注由原 Name 链路提供；群聊不读取个人心情。
 * 旧版 chat_page.dart 只在单聊把整条标题换成「对方正在输入...」，不是标题下的小字；
 * 群聊标题始终是群名（旧版 isGroup 分支不读 typing，2026-10-23 也确认群聊不显示输入提示）。
 * mode 由聊天页传入（当前情景模式），仅在「显示情景模式」开关打开时渲染为昵称旁的徽标。
 */
export function ChatHeading({
  name,
  characterId,
  mode,
  active,
  group,
  typing,
}: {
  name: ReactNode;
  characterId?: string;
  mode?: string;
  active: boolean;
  group: boolean;
  typing: boolean;
}) {
  const showTyping = typing && !group;
  return (
    // 常驻 live region：状态切换只改这一行标题，读屏完整播报一次，不因重新挂载重复播报。
    <span className="wx-chat-title" aria-live="polite" aria-atomic="true">
      <h1>
        {showTyping ? (
          <>
            对方正在输入
            <TypingDots />
          </>
        ) : (
          <>
            <span className="wx-chat-name">{name}</span>
            <ScenarioModeBadge mode={mode} />
            {!group && characterId && (
              <CharacterStatus key={characterId} characterId={characterId} enabled={active} />
            )}
          </>
        )}
      </h1>
    </span>
  );
}

/**
 * 「正在输入」三点（U5）：全站同一节奏——三个点依次轻跳，一轮 --wb-motion-duration-typing-cycle（1.2 秒）。
 * 读屏只读「对方正在输入」，点本身不读。
 */
export function TypingDots() {
  return (
    <span className="typing-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}
