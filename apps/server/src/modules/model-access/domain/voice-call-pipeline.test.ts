import { describe, expect, it } from 'vitest';
import { parseVoiceCallPipeline } from './voice-call-pipeline.js';

describe('voice call pipeline setting', () => {
  it('accepts three distinct model keys', () => {
    expect(
      parseVoiceCallPipeline({
        asrModelKey: 'siliconflow/sensevoice-small',
        textModelKey: 'deepseek/deepseek-v4.1-flash',
        ttsModelKey: 'xiaomi/mimo-v2.5-tts',
      }),
    ).toEqual({
      ok: true,
      value: {
        asrModelKey: 'siliconflow/sensevoice-small',
        textModelKey: 'deepseek/deepseek-v4.1-flash',
        ttsModelKey: 'xiaomi/mimo-v2.5-tts',
      },
    });
  });

  it.each([
    [{}, 'pipeline_invalid'],
    [{ asrModelKey: 'a/b' }, 'pipeline_invalid'],
    [{ asrModelKey: 'Bad Key', textModelKey: 'a/b', ttsModelKey: 'c/d' }, 'pipeline_invalid'],
    [
      { asrModelKey: 'a/b', textModelKey: 'a/b', ttsModelKey: 'c/d' },
      'pipeline_duplicate_components',
    ],
    [{ asrModelKey: 'a/b', textModelKey: 'c/d', ttsModelKey: 'e/f', extra: 1 }, 'pipeline_invalid'],
  ])('rejects %j', (input, error) => {
    expect(parseVoiceCallPipeline(input)).toEqual({ ok: false, error });
  });
});
