/**
 * T-20261103g：照片硬规则（私聊）与群聊表情包防刷屏规则（纯函数）。
 */
import { describe, expect, it } from 'vitest';
import type { Message, MessageContent } from '@weiban/contracts';
import { photoRoom, stickerRoom } from './reply-media-rules.js';

let seq = 0;
function msg(
  sender: 'user' | 'character',
  content: MessageContent,
  participant = sender === 'user' ? 'user-p' : 'char-a',
): Message {
  seq++;
  return {
    messageId: `m${seq}`,
    conversationId: 'c',
    seq,
    senderParticipantId: participant,
    senderKind: sender,
    content,
    status: 'normal',
    scope: 'normal',
    quote: null,
    clientMsgId: null,
    createdAt: new Date(seq * 1000).toISOString(),
    recalledAt: null,
  };
}
const text = (t = '普通消息'): MessageContent => ({ type: 'text', text: t });
const image = (mediaId: string): MessageContent => ({
  type: 'image',
  mediaId,
  width: null,
  height: null,
});
const sticker = (stickerId = 's1'): MessageContent => ({
  type: 'sticker',
  source: 'library',
  stickerId,
  mediaId: `${stickerId}-media`,
  description: '表情 1',
});
const texts = (n: number, participant?: string) =>
  Array.from({ length: n }, () => msg('character', text(), participant));

describe('photoRoom：私聊照片硬规则', () => {
  it('普通聊天记录里可以发', () => {
    expect(photoRoom(texts(10), '').open(1)).toBe(true);
  });

  it('用户说过不要图片就不发；后来明确要了恢复', () => {
    const history = [msg('user', text('别发照片了')), ...texts(5)];
    expect(photoRoom(history, '').open(1)).toBe(false);
    expect(photoRoom(history, '发张你的照片给我看看').open(1)).toBe(true);
  });

  it('软上限：20 条角色消息里已有 2 张就不发，挤出窗口后又能发', () => {
    const two = [
      msg('character', image('a')),
      ...texts(5),
      msg('character', image('b')),
      ...texts(5),
    ];
    expect(photoRoom(two, '').open(1)).toBe(false);
    const old = [msg('character', image('a')), msg('character', image('b')), ...texts(25)];
    expect(photoRoom(old, '').open(1)).toBe(true);
  });

  it('只有 1 张时还能发；按本轮文字条数算窗口', () => {
    const one = [...texts(2), msg('character', image('a')), ...texts(5)];
    expect(photoRoom(one, '').open(1)).toBe(true);
    expect(photoRoom(one, '').quota(4)).toBe(1);
  });

  it('不连发：上一条角色消息就是图片', () => {
    expect(photoRoom([...texts(10), msg('character', image('a'))], '').open(1)).toBe(false);
  });

  it('聊天记录里角色发过的图记为收到过', () => {
    const room = photoRoom(
      [msg('character', image('a')), ...texts(3), msg('user', image('u'))],
      '',
    );
    expect([...room.received]).toEqual(['a']);
  });
});

describe('stickerRoom：群聊防刷屏', () => {
  it('同一轮（触发消息之后）已有别的角色带过表情：这轮不再配', () => {
    const trigger = msg('user', text('大家好'));
    const history = [
      ...texts(5, 'char-b'),
      trigger,
      msg('character', text('你好呀'), 'char-b'),
      msg('character', sticker(), 'char-b'),
    ];
    const room = stickerRoom(history, '大家好', {
      participantId: 'char-a',
      roundAfterSeq: trigger.seq,
    });
    expect(room.roundTaken).toBe(true);
    expect(room.open(1)).toBe(false);
  });

  it('上一轮别人带过表情不影响这一轮', () => {
    const history = [msg('character', sticker(), 'char-b'), msg('user', text('再聊聊'))];
    const trigger = history.at(-1)!;
    expect(
      stickerRoom(history, '再聊聊', { participantId: 'char-a', roundAfterSeq: trigger.seq }).open(
        1,
      ),
    ).toBe(true);
  });

  it('每个角色只数自己的：别人发了 3 个不占我的名额，我自己 10 条里 3 个就不配', () => {
    const others = [
      msg('character', sticker('x1'), 'char-b'),
      ...texts(1, 'char-b'),
      msg('character', sticker('x2'), 'char-b'),
      ...texts(1, 'char-b'),
      msg('character', sticker('x3'), 'char-b'),
      ...texts(1, 'char-b'),
    ];
    const trigger = msg('user', text('哈哈'));
    expect(
      stickerRoom([...others, trigger], '哈哈', {
        participantId: 'char-a',
        roundAfterSeq: trigger.seq,
      }).open(1),
    ).toBe(true);
    const mine = [
      msg('character', sticker('a1')),
      ...texts(1),
      msg('character', sticker('a2')),
      ...texts(1),
      msg('character', sticker('a3')),
      ...texts(1),
    ];
    const trigger2 = msg('user', text('哈哈'));
    expect(
      stickerRoom([...mine, trigger2], '哈哈', {
        participantId: 'char-a',
        roundAfterSeq: trigger2.seq,
      }).open(1),
    ).toBe(false);
  });

  it('不连发：这个角色上一条就是表情', () => {
    const history = [...texts(3), msg('character', sticker()), msg('user', text('嗯嗯'))];
    expect(
      stickerRoom(history, '嗯嗯', { participantId: 'char-a', roundAfterSeq: seq }).open(1),
    ).toBe(false);
  });

  it('20 条内不重复同一张按全群算：别的角色刚发过的那张也排除', () => {
    const history = [msg('character', sticker('shared'), 'char-b'), msg('user', text('好'))];
    const room = stickerRoom(history, '好', { participantId: 'char-a', roundAfterSeq: seq });
    expect([...room.excludedIds]).toEqual(['shared']);
  });

  it('用户在群里说过别发表情包：不配', () => {
    const history = [msg('user', text('别发表情包了')), ...texts(3)];
    expect(stickerRoom(history, '', { participantId: 'char-a', roundAfterSeq: seq }).open(1)).toBe(
      false,
    );
  });
});
