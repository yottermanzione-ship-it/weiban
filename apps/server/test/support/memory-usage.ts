import type { GenerateTextInput } from '@weiban/contracts';
import { UsageRecorder } from '../../src/modules/model-access/testing.js';
import { newId, type Clock, type Database } from '../../src/platform/index.js';

/** A gateway substitute still needs an owned usage row for the real adoption receipt. */
export async function fixtureMemoryUsage(db: Database, clock: Clock, input: GenerateTextInput) {
  if (!input.taskKey) return newId();
  const recorder = new UsageRecorder(db, clock);
  const { record } = await recorder.start({
    input,
    modelKey: 'test/memory',
    upstreamId: newId(),
    upstreamModelId: 'fixture',
    countsAsBackground: true,
  });
  await recorder.finish(record.id, {
    status: 'succeeded',
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 10,
    estimated: false,
    latencyMs: 1,
    retryCount: 0,
  });
  return record.id;
}
