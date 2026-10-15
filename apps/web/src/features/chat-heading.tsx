import type { ReactNode } from 'react';
import { CharacterStatus } from './character-status.js';
/** 供聊天与开发样例共用，备注由原 Name 链路提供；群聊不读取个人心情。 */
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
  return (
    <span className="wx-chat-title">
      <h1>
        {name}
        {!group && characterId && (
          <CharacterStatus key={characterId} characterId={characterId} enabled={active} />
        )}
      </h1>
      {typing && (
        <small className="nav-subtitle" role="status">
          对方正在输入…
        </small>
      )}
    </span>
  );
}
