import type { ReactNode } from 'react';
import { CharacterStatus } from './character-status.js';
/**
 * 供聊天与开发样例共用，备注由原 Name 链路提供；群聊不读取个人心情。
 * 旧版 chat_page.dart 只在单聊把整条标题换成「对方正在输入...」，不是标题下的小字；
 * 群聊标题始终是群名（旧版 isGroup 分支不读 typing，2026-10-23 也确认群聊不显示输入提示）。
 */
export function ChatHeading({
  name,
  characterId,
  active,
  group,
  typing,
}: {
  name: ReactNode;
  characterId?: string;
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
          '对方正在输入...'
        ) : (
          <>
            {name}
            {!group && characterId && (
              <CharacterStatus key={characterId} characterId={characterId} enabled={active} />
            )}
          </>
        )}
      </h1>
    </span>
  );
}
