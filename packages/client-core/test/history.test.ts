import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ProtocolVector, type Message } from '@weiban/contracts';
import { SyncEngine } from '../src/index.js';
const vector = ProtocolVector.parse(
  JSON.parse(
    readFileSync(
      new URL('../../contracts/test-vectors/recall-before-history.json', import.meta.url),
      'utf8',
    ),
  ),
);
const cid = vector.initialState.conversations[0]!.conversationId;
const op = vector.steps[2]!.operation;
if (op.type !== 'update' || op.update.type !== 'message.created')
  throw new Error('shared fixture changed');
const original: Message = op.update.data.message;
it('用户加载历史不会复活先到的撤回；历史越界失败保持状态', () => {
  const engine = new SyncEngine(vector.initialState);
  engine.apply(vector.steps[0]!.operation);
  engine.history(cid, 3, { items: [original], hasMore: false });
  expect(engine.state.messages[0]!.status).toBe('recalled');
  expect(engine.state.messages[0]!.content).toBeNull();
  const before = engine.state;
  expect(() => engine.history(cid, 1, { items: [original], hasMore: false })).toThrow(
    '历史消息越界',
  );
  expect(engine.state).toEqual(before);
});
it('历史扫描的隐藏负记录删除旧缓存正文与引用，不等待更新日志补齐', () => {
  const engine = new SyncEngine(vector.initialState);
  engine.history(cid, 3, { items: [original], hasMore: false });
  engine.history(cid, 3, {
    items: [],
    hasMore: false,
    coverage: {
      fromSeq: 1,
      throughSeq: 1,
      excludedRanges: [{ fromSeq: 1, throughSeq: 1, reason: 'hidden' }],
    },
  });
  expect(engine.state.messages).toEqual([]);
  expect(engine.state.excluded).toHaveLength(1);
});
