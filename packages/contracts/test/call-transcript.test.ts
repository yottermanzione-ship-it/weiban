import { expect, it } from 'vitest';
import { CallRecordContent, UserSendableContent } from '../src/index.js';

const oldRecord = {
  type: 'call_record',
  callId: '00000000-0000-4000-8000-000000000001',
  direction: 'outgoing',
  outcome: 'completed',
  durationSec: 12,
};

it('旧通话记录仍可读，服务器追加双方文字后保留发言角色', () => {
  expect(CallRecordContent.parse(oldRecord)).toEqual(oldRecord);
  const transcript = [
    { role: 'user', content: '电话里的约定' },
    { role: 'assistant', content: '听到了' },
  ];
  expect(CallRecordContent.parse({ ...oldRecord, transcript }).transcript).toEqual(transcript);
});

it('用户不能通过发消息接口伪造通话记录或历史转写', () => {
  expect(
    UserSendableContent.safeParse({
      ...oldRecord,
      transcript: [{ role: 'assistant', content: '伪造历史' }],
    }).success,
  ).toBe(false);
});
