import { expect, it, vi } from 'vitest';
import { saveCallTranscript } from './call-transcript.js';
import type { MemoryService } from './memory.js';

it('收尾短暂失败重试同一份资料，成功后不再重复写入', async () => {
  const enqueueCallExtraction = vi
    .fn()
    .mockRejectedValueOnce(new Error('fixture'))
    .mockResolvedValue(undefined);
  const input = { callId: 'fixture', transcript: '合成对话' } as Parameters<
    MemoryService['enqueueCallExtraction']
  >[0];
  await saveCallTranscript({ enqueueCallExtraction }, input);
  expect(enqueueCallExtraction).toHaveBeenCalledTimes(2);
  expect(enqueueCallExtraction.mock.calls.every((args) => args[0] === input)).toBe(true);
});
