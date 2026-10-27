import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cloneDashscopeRealtimeVoice,
  clonedVoiceOf,
  customizationUrl,
  realtimeCloneBody,
  realtimeCloneProtocol,
} from './dashscope-voice-clone.js';
import { cloneSampleArgs, looksLikeMp3 } from './realtime-clone-sample.js';

const ROLE = '33333333-3333-4333-8333-333333333333';
const sha1 = createHash('sha1').update(ROLE).digest('hex');
const AUDIO = 'data:audio/mpeg;base64,AAAA';
const target = (model: string) => ({
  kind: 'dashscope',
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  apiKey: 'sk-test-not-real',
  model,
});
const sample = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/mpeg' };

afterEach(() => vi.restoreAllMocks());

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('复刻协议与请求体（对照旧版 prepareRealtimeVoice 与官方文档）', () => {
  it('按型号选协议：Realtime Plus = voice-enrollment，Omni 实时 = qwen-voice-enrollment', () => {
    expect(realtimeCloneProtocol('qwen-audio-3.0-realtime-plus')).toBe('voice-enrollment');
    expect(realtimeCloneProtocol('qwen-audio-3.1-realtime-plus')).toBe('voice-enrollment');
    expect(realtimeCloneProtocol('qwen3.5-omni-plus-realtime')).toBe('qwen-voice-enrollment');
    expect(realtimeCloneProtocol('qwen3.8-omni-flash-realtime')).toBe('qwen-voice-enrollment');
    expect(realtimeCloneProtocol('qwen-audio-3.0-tts-plus')).toBeNull();
    expect(realtimeCloneProtocol('qwen3.5-omni-plus')).toBeNull();
  });

  it('Omni 3.5：与旧版字段一致（create / preferred_name wb_+10 位 / audio.data / language zh）', () => {
    expect(realtimeCloneBody('qwen3.5-omni-plus-realtime', ROLE, AUDIO)).toEqual({
      model: 'qwen-voice-enrollment',
      input: {
        action: 'create',
        target_model: 'qwen3.5-omni-plus-realtime',
        preferred_name: `wb_${sha1.slice(0, 10)}`,
        audio: { data: AUDIO },
        language: 'zh',
      },
    });
  });

  it('Omni 3.8：官方要求带 voice_clone_mode', () => {
    expect(realtimeCloneBody('qwen3.8-omni-flash-realtime', ROLE, AUDIO)).toMatchObject({
      input: { target_model: 'qwen3.8-omni-flash-realtime' },
      parameters: { voice_clone_mode: 'normal' },
    });
  });

  it('Realtime Plus：create_voice / prefix wb+8 位（≤ 10 位字母数字）/ audio 为 Data URI 字符串', () => {
    const body = realtimeCloneBody('qwen-audio-3.0-realtime-plus', ROLE, AUDIO);
    expect(body).toEqual({
      model: 'voice-enrollment',
      input: {
        action: 'create_voice',
        target_model: 'qwen-audio-3.0-realtime-plus',
        prefix: `wb${sha1.slice(0, 8)}`,
        audio: AUDIO,
      },
    });
    expect((body!.input as { prefix: string }).prefix).toMatch(/^[a-z0-9]{1,10}$/);
  });

  it('地址与旧版 customizationUrl 相同；非 https 拒绝；音色代号两种字段都认', () => {
    expect(customizationUrl('https://dashscope.aliyuncs.com/api/v1')).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization',
    );
    expect(customizationUrl('https://ws1.cn-beijing.maas.aliyuncs.com')).toBe(
      'https://ws1.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization',
    );
    expect(customizationUrl('http://dashscope.aliyuncs.com/api/v1')).toBeNull();
    expect(clonedVoiceOf({ output: { voice_id: 'qwen-audio-3.0-realtime-plus-wb1-x' } })).toBe(
      'qwen-audio-3.0-realtime-plus-wb1-x',
    );
    expect(clonedVoiceOf({ output: { voice: 'qwen-tts-vc-wb_1' } })).toBe('qwen-tts-vc-wb_1');
    expect(clonedVoiceOf({ output: { voice: 'bad voice' } })).toBeNull();
  });
});

describe('复刻调用（假供应商：替换 fetch，不联网、不收费）', () => {
  it('Omni：一次 POST，带 Bearer，不跟随重定向，返回 output.voice', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(respond(200, { output: { voice: 'qwen-tts-vc-wb_x' } }));
    const result = await cloneDashscopeRealtimeVoice(target('qwen3.5-omni-plus-realtime'), {
      characterId: ROLE,
      sample,
    });
    expect(result).toEqual({ ok: true, value: { voice: 'qwen-tts-vc-wb_x' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization');
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-not-real');
    const body = JSON.parse(String(init!.body)) as { input: { audio: { data: string } } };
    expect(body.input.audio.data).toBe('data:audio/mpeg;base64,AQID');
  });

  it('Realtime Plus：创建后查审核状态，DEPLOYING 等待、OK 才返回', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(respond(200, { output: { voice_id: 'qwen-audio-rt-wb1' } }))
      .mockResolvedValueOnce(respond(200, { output: { status: 'DEPLOYING' } }))
      .mockResolvedValueOnce(respond(200, { output: { status: 'OK' } }));
    const result = await cloneDashscopeRealtimeVoice(
      target('qwen-audio-3.0-realtime-plus'),
      { characterId: ROLE, sample },
      { wait: async () => undefined },
    );
    expect(result).toEqual({ ok: true, value: { voice: 'qwen-audio-rt-wb1' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toEqual({
      model: 'voice-enrollment',
      input: { action: 'query_voice', voice_id: 'qwen-audio-rt-wb1' },
    });
  });

  it('审核不通过 / 鉴权失败 / 非 https 基址都按失败返回', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(respond(200, { output: { voice_id: 'qwen-audio-rt-wb1' } }))
      .mockResolvedValueOnce(respond(200, { output: { status: 'UNDEPLOYED' } }))
      .mockResolvedValueOnce(respond(401, { code: 'InvalidApiKey' }));
    expect(
      await cloneDashscopeRealtimeVoice(
        target('qwen-audio-3.0-realtime-plus'),
        { characterId: ROLE, sample },
        { wait: async () => undefined },
      ),
    ).toMatchObject({ ok: false, category: 'content_rejected' });
    expect(
      await cloneDashscopeRealtimeVoice(target('qwen3.5-omni-plus-realtime'), {
        characterId: ROLE,
        sample,
      }),
    ).toMatchObject({ ok: false, category: 'invalid_key' });
    expect(
      await cloneDashscopeRealtimeVoice(
        { ...target('qwen3.5-omni-plus-realtime'), baseUrl: 'http://x/api/v1' },
        { characterId: ROLE, sample },
      ),
    ).toEqual({ ok: false, category: 'bad_request', zeroCost: true });
  });
});

describe('样本转码参数（官方：≥ 24 kHz 单声道、10～20 秒）', () => {
  it('只读管道、截 15 秒、24 kHz 单声道 MP3；Realtime Plus 另做旧版的去静音 + 响度归一', () => {
    const plain = cloneSampleArgs(false);
    expect(plain).toEqual(expect.arrayContaining(['-protocol_whitelist', 'pipe', 'pipe:0']));
    const pairs = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
    expect(pairs(plain, '-t')).toBe('15');
    expect(pairs(plain, '-ar')).toBe('24000');
    expect(pairs(plain, '-ac')).toBe('1');
    expect(pairs(plain, '-f')).toBe('mp3');
    expect(plain).not.toContain('-af');
    expect(pairs(cloneSampleArgs(true), '-af')).toMatch(/^silenceremove=.*loudnorm=/);
  });

  it('MP3 粗检', () => {
    expect(looksLikeMp3(new Uint8Array([0x49, 0x44, 0x33, 4]))).toBe(true);
    expect(looksLikeMp3(new Uint8Array([0xff, 0xfb, 0x90, 0]))).toBe(true);
    expect(looksLikeMp3(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(false);
  });
});
