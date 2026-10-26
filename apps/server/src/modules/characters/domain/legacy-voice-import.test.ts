import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  LegacyVoiceImportInput,
  classifyVoiceKey,
  normalizeVoiceInput,
  planLegacyVoices,
  resolveSamplePath,
  voiceCandidatesOf,
  voiceKeyId,
  type LegacyVoiceImportInput as Input,
  type VoiceExisting,
} from './legacy-voice-import.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const QWEN_KEY_A = 'qwen-audio-3.0-tts-plus-wb-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const QWEN_KEY_B = 'qwen-audio-3.0-tts-plus-wb-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const QWEN_KEY_C = 'qwen-audio-3.0-tts-plus-wb-cccccccccccccccccccccccccccccccc';
const QWEN_MODEL = 'qwen-audio-3.0-tts-plus';

function row(
  id: string,
  values: {
    qwen?: string;
    voiceJson?: Record<string, unknown>;
    samplePath?: string;
    sampleUrl?: string;
    bindings?: Array<Record<string, unknown>>;
  } = {},
) {
  return {
    id,
    display_name: `角色-${id.slice(0, 1)}`,
    voice_json: JSON.stringify(values.voiceJson ?? { provider: 'qwen' }),
    qwen_voice_id: values.qwen ?? '',
    mimo_voice_sample_path: values.samplePath ?? '/old/voice-samples/a.mp3',
    mimo_voice_sample_url: values.sampleUrl ?? '/generated/voice-samples/a.mp3',
    ...(values.bindings ? { bindings: values.bindings } : {}),
  };
}

function existing(overrides: Partial<VoiceExisting> = {}): VoiceExisting {
  return {
    characterIds: new Set([A, B, C]),
    boundVoiceIds: new Map(),
    voicesByKey: new Map(),
    registeredModels: new Set([QWEN_MODEL]),
    ...overrides,
  };
}

function input(characters: unknown[], bindings: unknown[] = []): Input {
  return { version: 1, characters, bindings } as Input;
}

describe('旧卡音色映射（dry-run 纯逻辑）', () => {
  it('qwen_voice_id / voice_json / 已就绪绑定三种来源都能映射', () => {
    const plan = planLegacyVoices(
      input([
        row(A, { qwen: QWEN_KEY_A }),
        row(B, {
          voiceJson: { provider: 'qwen', qwen_voice_id: QWEN_KEY_B },
        }),
        row(C, {
          voiceJson: { provider: 'qwen' },
          bindings: [
            { provider: 'qwen', voice_id: QWEN_KEY_C, model: QWEN_MODEL, status: 'ready' },
          ],
        }),
      ]),
      existing(),
      { sampleExists: () => true },
    );
    expect(plan.counts).toMatchObject({
      total: 3,
      mapped: 3,
      unmapped: 0,
      wouldCreateVoices: 3,
      wouldBind: 3,
      cloneSampleMissing: 0,
    });
    expect(plan.items.map((item) => item.candidate?.source)).toEqual([
      'qwen_voice_id',
      'voice_json',
      'binding',
    ]);
    expect(plan.modelNotRegistered).toEqual([]);
    expect(plan.issues).toEqual([]);
  });

  it('已绑定角色的跳过；同 provider+key 已有音色复用而不是新建', () => {
    const key = voiceKeyId(QWEN_MODEL, QWEN_KEY_A);
    const plan = planLegacyVoices(
      input([row(A, { qwen: QWEN_KEY_A })]),
      existing({
        boundVoiceIds: new Map([[B, '00000000-0000-4000-8000-000000000001']]),
        voicesByKey: new Map([
          [key, { id: '00000000-0000-4000-8000-000000000002', enabled: true }],
        ]),
      }),
      { sampleExists: () => true },
    );
    expect(plan.counts).toMatchObject({ mapped: 1, wouldCreateVoices: 0, reuseVoices: 1 });
    expect(plan.items[0]?.existingVoiceId).toBe('00000000-0000-4000-8000-000000000002');

    const bound = planLegacyVoices(
      input([row(B, { qwen: QWEN_KEY_B })]),
      existing({ boundVoiceIds: new Map([[B, '00000000-0000-4000-8000-000000000001']]) }),
      { sampleExists: () => true },
    );
    expect(bound.counts).toMatchObject({ alreadyBound: 1, mapped: 0, wouldCreateVoices: 0 });
    expect(bound.items[0]?.status).toBe('already_bound');
  });

  it('缺 key、flash 退役、只有 realtime、供应商不支持都逐条报告', () => {
    const noKey = planLegacyVoices(
      input([row(A, { voiceJson: { provider: 'qwen' } })]),
      existing(),
      { sampleExists: () => true },
    );
    expect(noKey.counts.noKey).toBe(1);
    expect(noKey.issues[0]).toMatchObject({ characterId: A, code: 'no_voice_key' });

    const retired = planLegacyVoices(
      input([row(B, { qwen: 'qwen-audio-3.0-tts-flash-wb-1234' })]),
      existing(),
      { sampleExists: () => true },
    );
    expect(retired.counts.providerRetired).toBe(1);

    const realtime = planLegacyVoices(
      input([row(C, { qwen: 'qwen-audio-3.0-realtime-plus-wbar-1234' })]),
      existing(),
      { sampleExists: () => true },
    );
    expect(realtime.counts.realtimeOnly).toBe(1);

    const unsupported = planLegacyVoices(
      input([
        row(D, {
          voiceJson: { provider: 'cartesia', voice_id: 'cartesia-voice-1' },
          samplePath: '',
          sampleUrl: '',
        }),
      ]),
      existing({ characterIds: new Set([D]) }),
      { sampleExists: () => true },
    );
    expect(unsupported.counts.unsupportedProvider).toBe(1);
  });

  it('克隆音色缺样本报告 clone_sample_missing，不静默当成系统音色', () => {
    const plan = planLegacyVoices(
      input([row(A, { qwen: QWEN_KEY_A, samplePath: '', sampleUrl: '' })]),
      existing(),
      { sampleExists: () => false },
    );
    expect(plan.counts.cloneSampleMissing).toBe(1);
    expect(plan.counts.mapped).toBe(0);
    expect(plan.issues[0]).toMatchObject({ characterId: A, code: 'clone_sample_missing' });
  });

  it('已有音色被停用时报告，不把角色绑到无声音色', () => {
    const key = voiceKeyId(QWEN_MODEL, QWEN_KEY_A);
    const plan = planLegacyVoices(
      input([row(A, { qwen: QWEN_KEY_A })]),
      existing({
        voicesByKey: new Map([
          [key, { id: '00000000-0000-4000-8000-000000000002', enabled: false }],
        ]),
      }),
      { sampleExists: () => true },
    );
    expect(plan.counts).toMatchObject({ existingVoiceDisabled: 1, mapped: 0 });
    expect(plan.issues[0]).toMatchObject({ code: 'existing_voice_disabled' });
  });

  it('目录没登记 qwen TTS 模型时仍然映射，但给出 modelNotRegistered', () => {
    const plan = planLegacyVoices(
      input([row(A, { qwen: QWEN_KEY_A })]),
      existing({ registeredModels: new Set() }),
      { sampleExists: () => true },
    );
    expect(plan.counts.mapped).toBe(1);
    expect(plan.items[0]?.modelRegistered).toBe(false);
    expect(plan.modelNotRegistered).toEqual([QWEN_MODEL]);
  });

  it('角色不存在、行 id 非法、MiMo 克隆缺样本分别计数', () => {
    const plan = planLegacyVoices(
      input([
        row(D, { qwen: QWEN_KEY_A }),
        { id: 'not-a-uuid', display_name: '坏行' },
        row(B, {
          voiceJson: { provider: 'mimo_voiceclone', voice_id: 'mimo-voice-1' },
          qwen: '',
          samplePath: '',
          sampleUrl: '',
        }),
      ]),
      existing(),
      { sampleExists: () => false },
    );
    expect(plan.counts.total).toBe(3);
    expect(plan.counts.characterMissing).toBe(1);
    expect(plan.counts.invalidRow).toBe(1);
    expect(plan.counts.cloneSampleMissing).toBe(1);
  });

  it('sample-root 把旧绝对路径映射到新机同名样本', () => {
    const old = {
      samplePath: '/opt/weiban-server/public/generated/voice-samples/朱志鑫_1.mp3',
      sampleUrl: '/generated/voice-samples/朱志鑫_1.mp3',
    };
    const staged = path.join('/stage', '朱志鑫_1.mp3');
    expect(resolveSamplePath(old, '/stage', (file) => file === staged)).toBe(staged);
    expect(resolveSamplePath(old, null, () => false)).toBeNull();
  });

  it('候选去重、qwen_voice_id 优先，并有稳定的 provider+key 复用键', () => {
    const character = normalizeVoiceInput(
      input([
        row(A, {
          qwen: QWEN_KEY_A,
          voiceJson: { provider: 'qwen', qwen_voice_id: QWEN_KEY_A, voice_id: QWEN_KEY_B },
        }),
      ]),
    ).characters[0]!;
    const candidates = voiceCandidatesOf(character);
    expect(candidates.map((candidate) => candidate.key)).toEqual([QWEN_KEY_A, QWEN_KEY_B]);
    expect(classifyVoiceKey(QWEN_KEY_A)).toMatchObject({ kind: 'qwen_tts', clone: true });
    expect(voiceKeyId(QWEN_MODEL, QWEN_KEY_A)).toContain(QWEN_KEY_A);
  });

  it('输入清单只接受 characters 数组', () => {
    expect(LegacyVoiceImportInput.safeParse({ characters: [] }).success).toBe(false);
    expect(LegacyVoiceImportInput.safeParse({ characters: [{}] }).success).toBe(true);
  });
});
