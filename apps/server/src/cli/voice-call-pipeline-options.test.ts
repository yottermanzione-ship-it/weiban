import { describe, expect, it } from 'vitest';
import {
  assessVoiceCallPipeline,
  compositeEntryWarnings,
  compositeEntryWrite,
  isLoopbackBaseUrl,
  parseVoiceCallPipelineCommand,
  VOICE_CALL_COMPOSITE_ENTRY_NAME,
  VOICE_CALL_COMPOSITE_ENTRY_VENDOR,
  type VoiceCallCatalogFact,
  type VoiceCallUpstreamInfo,
} from './voice-call-pipeline-options.js';
import {
  VOICE_CALL_CASCADE_MODEL_KEY,
  VOICE_CALL_PIPELINE_TAG,
  type VoiceCallPipeline,
} from '../modules/model-access/index.js';

const pipeline: VoiceCallPipeline = {
  asrModelKey: 'asr/sensevoice',
  textModelKey: 'text/deepseek-v4.1-flash',
  ttsModelKey: 'tts/mimo',
};

const SET_ARGS = [
  '--set',
  '--operator-id',
  '7d9c3f6e-1d2a-4b8c-9e0f-0a1b2c3d4e5f',
  '--asr',
  pipeline.asrModelKey,
  '--text',
  pipeline.textModelKey,
  '--tts',
  pipeline.ttsModelKey,
];

function upstream(
  id: string,
  overrides: Partial<VoiceCallUpstreamInfo> = {},
): VoiceCallUpstreamInfo {
  return {
    upstreamId: id,
    name: `账号 ${id}`,
    baseUrl: 'https://text.example.com/v1',
    enabled: true,
    status: 'active',
    deletedAt: null,
    ...overrides,
  };
}

function facts(
  overrides: Record<string, Partial<VoiceCallCatalogFact> | undefined> = {},
): Map<string, VoiceCallCatalogFact> {
  const base: VoiceCallCatalogFact[] = [
    { entry: { enabled: true, upstreamId: 'up-asr' }, upstreamStatus: 'active' },
    { entry: { enabled: true, upstreamId: 'up-text' }, upstreamStatus: 'active' },
    { entry: { enabled: true, upstreamId: 'up-tts' }, upstreamStatus: 'active' },
  ];
  const keys = [pipeline.asrModelKey, pipeline.textModelKey, pipeline.ttsModelKey];
  return new Map(
    keys.map((key, index) => [
      key,
      overrides[key] === undefined
        ? base[index]!
        : { entry: null, upstreamStatus: null, ...overrides[key] },
    ]),
  );
}

const upstreams = [upstream('up-asr'), upstream('up-text'), upstream('up-tts')];

describe('voice-call-pipeline CLI arguments', () => {
  it('accepts --show alone', () => {
    expect(parseVoiceCallPipelineCommand(['--show'])).toEqual({
      ok: true,
      command: { kind: 'show' },
    });
  });

  it('accepts --set with the operator and the three components (pnpm "--" tolerated)', () => {
    const parsed = parseVoiceCallPipelineCommand(['--', ...SET_ARGS, '--create-entry']);
    expect(parsed).toEqual({
      ok: true,
      command: {
        kind: 'set',
        operatorId: '7d9c3f6e-1d2a-4b8c-9e0f-0a1b2c3d4e5f',
        pipeline,
        createEntry: true,
      },
    });
    const withoutEntry = parseVoiceCallPipelineCommand(SET_ARGS);
    expect(withoutEntry.ok && withoutEntry.command.kind === 'set').toBe(true);
    expect(
      withoutEntry.ok && withoutEntry.command.kind === 'set' && withoutEntry.command.createEntry,
    ).toBe(false);
  });

  it('requires exactly one subcommand', () => {
    expect(parseVoiceCallPipelineCommand([])).toMatchObject({
      ok: false,
      code: 'ONE_ACTION_REQUIRED',
    });
    expect(parseVoiceCallPipelineCommand(['--show', '--set'])).toMatchObject({
      ok: false,
      code: 'ACTION_CONFLICT',
    });
  });

  it('rejects unknown arguments, missing values and duplicates', () => {
    expect(parseVoiceCallPipelineCommand(['--show', '--apply'])).toMatchObject({
      ok: false,
      code: 'ARGUMENT_INVALID',
    });
    expect(parseVoiceCallPipelineCommand(['--set', '--asr'])).toMatchObject({
      ok: false,
      code: 'ARGUMENT_INVALID',
    });
    expect(parseVoiceCallPipelineCommand([...SET_ARGS, '--asr', 'asr/other'])).toMatchObject({
      ok: false,
      code: 'ARGUMENT_INVALID',
    });
    expect(
      parseVoiceCallPipelineCommand([...SET_ARGS, '--create-entry', '--create-entry']),
    ).toMatchObject({ ok: false, code: 'ARGUMENT_INVALID' });
  });

  it('keeps --show read-only: write-only flags are refused', () => {
    expect(parseVoiceCallPipelineCommand(['--show', '--create-entry'])).toMatchObject({
      ok: false,
      code: 'ARGUMENT_INVALID',
    });
    expect(parseVoiceCallPipelineCommand(['--show', '--operator-id', 'x'])).toMatchObject({
      ok: false,
      code: 'ARGUMENT_INVALID',
    });
  });

  it('requires every --set flag', () => {
    expect(parseVoiceCallPipelineCommand(['--set', '--asr', 'asr/x'])).toMatchObject({
      ok: false,
      code: 'ARGUMENT_REQUIRED',
    });
    const withoutTts = SET_ARGS.slice(0, SET_ARGS.length - 2);
    expect(parseVoiceCallPipelineCommand(withoutTts)).toMatchObject({
      ok: false,
      code: 'ARGUMENT_REQUIRED',
    });
  });

  it('rejects malformed, repeated and self-referencing model keys before any write', () => {
    expect(
      parseVoiceCallPipelineCommand(
        SET_ARGS.map((arg) => (arg === pipeline.ttsModelKey ? 'TTs/MiMo' : arg)),
      ),
    ).toMatchObject({ ok: false, code: 'PIPELINE_INVALID' });
    expect(
      parseVoiceCallPipelineCommand(
        SET_ARGS.map((arg) => (arg === pipeline.ttsModelKey ? pipeline.textModelKey : arg)),
      ),
    ).toMatchObject({ ok: false, code: 'PIPELINE_INVALID' });
    expect(
      parseVoiceCallPipelineCommand(
        SET_ARGS.map((arg) => (arg === pipeline.ttsModelKey ? VOICE_CALL_CASCADE_MODEL_KEY : arg)),
      ),
    ).toMatchObject({ ok: false, code: 'PIPELINE_SELF_REFERENCE' });
  });
});

describe('voice-call component pre-check', () => {
  it('passes when all three components exist, are enabled and sit on real upstreams', () => {
    const prepared = assessVoiceCallPipeline({ pipeline, facts: facts(), upstreams });
    expect(prepared.ok).toBe(true);
    expect(prepared.problems).toEqual([]);
    expect(prepared.warnings).toEqual([]);
    expect(prepared.components.map((c) => c.component)).toEqual(['asr', 'text', 'tts']);
    expect(prepared.components.map((c) => c.upstreamName)).toEqual([
      '账号 up-asr',
      '账号 up-text',
      '账号 up-tts',
    ]);
  });

  it('reports every missing or disabled component instead of stopping at the first', () => {
    const prepared = assessVoiceCallPipeline({
      pipeline,
      facts: facts({
        [pipeline.asrModelKey]: { entry: null, upstreamStatus: null },
        [pipeline.ttsModelKey]: { entry: { enabled: false, upstreamId: 'up-tts' } },
      }),
      upstreams,
    });
    expect(prepared.ok).toBe(false);
    expect(prepared.problems).toEqual([
      `asr 组件 ${pipeline.asrModelKey}：模型目录里没有这个模型`,
      `tts 组件 ${pipeline.ttsModelKey}：模型已停用`,
    ]);
    expect(prepared.components.find((c) => c.component === 'text')?.problems).toEqual([]);
  });

  it('rejects an upstream that is missing or soft-deleted', () => {
    const missing = assessVoiceCallPipeline({
      pipeline,
      facts: facts({ [pipeline.textModelKey]: { entry: { enabled: true, upstreamId: 'gone' } } }),
      upstreams,
    });
    expect(missing.ok).toBe(false);
    expect(missing.problems).toEqual([
      `text 组件 ${pipeline.textModelKey}：上游账号不存在或已删除`,
    ]);

    const deleted = assessVoiceCallPipeline({
      pipeline,
      facts: facts(),
      upstreams: [
        upstream('up-asr'),
        upstream('up-text', { deletedAt: '2026-10-24T00:00:00.000Z' }),
        upstream('up-tts'),
      ],
    });
    expect(deleted.ok).toBe(false);
    expect(deleted.problems).toEqual([
      `text 组件 ${pipeline.textModelKey}：上游账号不存在或已删除`,
    ]);
  });

  it('rejects loopback upstreams, which cannot reach a real provider in production', () => {
    const prepared = assessVoiceCallPipeline({
      pipeline,
      facts: facts(),
      upstreams: [
        upstream('up-asr', { baseUrl: 'http://127.0.0.1:11434/v1' }),
        upstream('up-text', { baseUrl: 'http://localhost:8000/v1' }),
        upstream('up-tts'),
      ],
    });
    expect(prepared.ok).toBe(false);
    expect(prepared.problems).toEqual([
      `asr 组件 ${pipeline.asrModelKey}：上游地址是本机（loopback），生产环境接不到真实供应商`,
      `text 组件 ${pipeline.textModelKey}：上游地址是本机（loopback），生产环境接不到真实供应商`,
    ]);
  });

  it('only warns (does not block) when the upstream is disabled or not active', () => {
    const prepared = assessVoiceCallPipeline({
      pipeline,
      facts: facts(),
      upstreams: [
        upstream('up-asr', { enabled: false }),
        upstream('up-text', { status: 'quota_exhausted' }),
        upstream('up-tts'),
      ],
    });
    expect(prepared.ok).toBe(true);
    expect(prepared.warnings).toEqual([
      'asr 组件 asr/sensevoice：上游账号已停用，通话会不可用',
      'text 组件 text/deepseek-v4.1-flash：上游状态不是正常（quota_exhausted），通话会不可用',
    ]);
  });

  it('detects loopback hosts but not public endpoints', () => {
    for (const url of [
      'http://127.0.0.1:11434/v1',
      'https://127.0.0.2/v1',
      'http://localhost:8000',
      'http://[::1]:8080/v1',
      'http://0.0.0.0:3000',
    ])
      expect(isLoopbackBaseUrl(url), url).toBe(true);
    for (const url of ['https://api.example.com', 'https://speech.example.com/api/v1', 'not a url'])
      expect(isLoopbackBaseUrl(url), url).toBe(false);
  });
});

describe('voice-call composite catalog payload', () => {
  it('uses the fixed composite key, display name, tag and voice_call scenario', () => {
    expect(compositeEntryWrite({ upstreamId: 'up-text', upstreamModelId: 'mimo' })).toEqual({
      modelKey: VOICE_CALL_CASCADE_MODEL_KEY,
      displayName: VOICE_CALL_COMPOSITE_ENTRY_NAME,
      vendorName: VOICE_CALL_COMPOSITE_ENTRY_VENDOR,
      upstreamId: 'up-text',
      upstreamModelId: 'mimo',
      capabilities: [],
      tags: [VOICE_CALL_PIPELINE_TAG],
      leaderboardRank: null,
      sortOrder: 0,
      defaultFor: [],
      enabled: true,
      scenarios: ['voice_call'],
    });
  });

  it('keeps existing tags, rank and order without duplicating the pipeline tag', () => {
    const write = compositeEntryWrite({
      upstreamId: 'up-text',
      upstreamModelId: 'mimo',
      existing: { tags: ['voice', VOICE_CALL_PIPELINE_TAG], leaderboardRank: 12, sortOrder: 7 },
    });
    expect(write.tags).toEqual([VOICE_CALL_PIPELINE_TAG, 'voice']);
    expect(write.leaderboardRank).toBe(12);
    expect(write.sortOrder).toBe(7);
    expect(write.enabled).toBe(true);
    expect(write.scenarios).toEqual(['voice_call']);
  });

  it('keeps the pipeline tag when the existing entry already has ten tags', () => {
    const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`);
    const write = compositeEntryWrite({
      upstreamId: 'up-text',
      upstreamModelId: 'mimo',
      existing: { tags, leaderboardRank: null, sortOrder: 0 },
    });
    expect(write.tags).toHaveLength(10);
    expect(write.tags[0]).toBe(VOICE_CALL_PIPELINE_TAG);
  });

  it('flags that the 19-character pipeline tag exceeds the admin contract tag limit', () => {
    expect(VOICE_CALL_PIPELINE_TAG).toHaveLength(19);
    expect(compositeEntryWarnings()).toHaveLength(1);
    expect(compositeEntryWarnings()[0]).toContain('超过后台契约 tags 上限 16');
  });
});
