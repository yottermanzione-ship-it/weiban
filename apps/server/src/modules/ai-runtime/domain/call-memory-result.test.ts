import { expect, it } from 'vitest';
import { parseCallMemoryResult } from './call-memory-result.js';

const source = '00000000-0000-4000-8000-000000000001';
const fact = {
  action: 'ADD',
  content: '喜欢风车',
  category: 'preference',
  importance: 5,
  sourceMessageIds: [source],
};
it('额外字段不导致合法事实丢失，未知操作不擅自转换成新增或删除', () => {
  const result = parseCallMemoryResult(
    {
      operations: [
        { ...fact, reason: 'PRIVATE_EXTRA' },
        { ...fact, action: 'UNSUPPORTED' },
      ],
      episode: '聊了风车',
      explanation: 'PRIVATE_EXTRA',
    },
    source,
  );
  expect(result).toEqual({ operations: [fact], episode: '聊了风车', ignoredOperations: 1 });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_EXTRA');
});
it('空操作不强迫模型编造事实；更新或标记过去必须有记忆ID', () => {
  expect(
    parseCallMemoryResult(
      {
        operations: [
          { action: 'NOOP' },
          { ...fact, action: 'UPDATE' },
          { ...fact, action: 'MARK_PAST' },
        ],
        episode: '',
      },
      source,
    ),
  ).toEqual({ operations: [], episode: '', ignoredOperations: 2 });
});
it.each([
  [
    { ...fact, action: 'UNSUPPORTED', sourceMessageIds: ['00000000-0000-4000-8000-000000000002'] },
    'invalid_source_reference',
  ],
  [{ ...fact, action: 'UNSUPPORTED', content: '经期记录' }, 'restricted_content'],
])('不能借坏操作绕过来源和隐私过滤', (operation, reason) => {
  try {
    parseCallMemoryResult({ operations: [operation], episode: '' }, source);
    throw new Error('accepted');
  } catch (error) {
    expect(error).toMatchObject({ reason });
  }
});
it('损坏顶层、过长经历和超过条数上限仍拒绝，不从无关字段推断事实', () => {
  for (const raw of [
    { operations: 'bad', episode: '' },
    { operations: [], episode: '长'.repeat(121) },
    { operations: Array(21).fill(fact), episode: '' },
  ])
    expect(() => parseCallMemoryResult(raw, source)).toThrow();
});
