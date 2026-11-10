import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => native);
import { compatibleBrowserAudio, needsCompatibleAudio } from './browser-audio.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1';
const DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15';
const ogg = () => ({ body: Buffer.from('OggS-synthetic-test-audio'), mimeType: 'audio/ogg' });
const mp3 = () => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200)]);
function processStub() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  native.spawn.mockReturnValueOnce(child);
  return child;
}
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('签名下载后的浏览器语音兼容', () => {
  it('覆盖iOS18.1、主屏幕、iOS其他浏览器及桌面Safari，只转换Ogg音频', () => {
    for (const ua of [
      IPHONE,
      IPHONE.replace('Version/18.1 ', ''),
      IPHONE.replace('Version/18.1', 'CriOS/130.0'),
      DESKTOP,
    ]) {
      expect(needsCompatibleAudio('audio/ogg', ua)).toBe(true);
      expect(needsCompatibleAudio('image/webp', ua)).toBe(false);
      expect(needsCompatibleAudio('audio/mpeg', ua)).toBe(false);
      expect(needsCompatibleAudio('audio/wav', ua)).toBe(false);
    }
    for (const ua of [
      '',
      'Mozilla/5.0 Android AppleWebKit Chrome/130.0 Safari/537.36 WeibanShell/3.0.0',
      DESKTOP.replace('Version/18.1', 'Chrome/130.0'),
    ]) {
      expect(needsCompatibleAudio('audio/ogg', ua)).toBe(false);
    }
  });

  it('兼容播放只走本机内存管道，原语音不变；其他客户端不启动转码', async () => {
    const original = ogg();
    const child = processStub();
    const result = compatibleBrowserAudio(original, IPHONE);
    expect(native.spawn).toHaveBeenCalledWith(
      '/usr/bin/ffmpeg',
      expect.arrayContaining([
        '-protocol_whitelist',
        'pipe',
        '-f',
        'ogg',
        '-i',
        'pipe:0',
        '-f',
        'mp3',
        'pipe:1',
      ]),
      { shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    expect(child.stdin.read().equals(original.body)).toBe(true);
    child.stdout.emit('data', mp3());
    child.emit('close', 0, null);
    expect(await result).toEqual({ body: mp3(), mimeType: 'audio/mpeg' });
    expect(original).toEqual(ogg());
    native.spawn.mockClear();
    expect(await compatibleBrowserAudio(original, 'Android Chrome/130')).toBe(original);
    expect(native.spawn).not.toHaveBeenCalled();
  });

  it('转码失败不伪装成功，不向用户或日志回传诊断内容', async () => {
    const child = processStub();
    const result = compatibleBrowserAudio(ogg(), IPHONE);
    const check = expect(result).rejects.toMatchObject({
      code: 'service_unavailable',
      message: '语音暂时无法播放，请稍后重试',
    });
    child.stderr.emit('data', Buffer.from('SYNTHETIC_PRIVATE_AUDIO_METADATA'));
    child.emit('close', 1, null);
    await check;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('限制并发、超时和输出大小，结束后释放处理名额', async () => {
    vi.useFakeTimers();
    const first = processStub();
    const a = compatibleBrowserAudio(ogg(), IPHONE);
    const second = processStub();
    const b = compatibleBrowserAudio(ogg(), IPHONE);
    const checkA = expect(a).rejects.toMatchObject({ code: 'service_unavailable' });
    const checkB = expect(b).rejects.toMatchObject({ code: 'service_unavailable' });
    await expect(compatibleBrowserAudio(ogg(), IPHONE)).rejects.toMatchObject({
      code: 'rate_limited',
    });
    first.stdout.emit('data', Buffer.alloc(6 * 1024 * 1024 + 1));
    await checkA;
    await vi.advanceTimersByTimeAsync(12_001);
    await checkB;
    expect(first.kill).toHaveBeenCalled();
    expect(second.kill).toHaveBeenCalled();
    const third = processStub();
    const c = compatibleBrowserAudio(ogg(), IPHONE);
    third.stdout.emit('data', mp3());
    third.emit('close', 0, null);
    expect((await c).mimeType).toBe('audio/mpeg');
  });
});
