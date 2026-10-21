import type { Message } from '@weiban/contracts';
import { describe, expect, it } from 'vitest';
import { nudgeText, readableMessageText } from './content-text.js';

const target = '00000000-0000-4000-8000-000000000001';

describe('3.27 拍一拍进模型上下文', () => {
  it('私聊按角色视角：用户拍了拍你 / 你拍了拍用户（带用户后缀）', () => {
    expect(nudgeText({ type: 'nudge', targetParticipantId: target, targetKind: 'character' }, 'user')).toContain(
      '用户拍了拍你',
    );
    expect(
      nudgeText(
        { type: 'nudge', targetParticipantId: target, targetKind: 'user', suffix: '的小脑袋' },
        'character',
      ),
    ).toBe('[拍一拍：你拍了拍用户的小脑袋]');
    expect(
      nudgeText(
        { type: 'nudge', targetParticipantId: target, targetKind: 'user', suffix: '的肩膀' },
        'user',
      ),
    ).toBe('[拍一拍：用户拍了拍自己的肩膀]');
  });

  it('群聊带名字；旧消息没有 targetKind 也能读', () => {
    expect(
      nudgeText({ type: 'nudge', targetParticipantId: target }, 'user', {
        sender: '小明',
        target: '阿杰',
      }),
    ).toBe('[拍一拍：小明拍了拍阿杰]');
    const message = {
      senderKind: 'user',
      content: { type: 'nudge', targetParticipantId: target },
    } as unknown as Message;
    expect(readableMessageText(message)).toContain('用户拍了拍你');
  });
});
