import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs/promises', () => ({ access: vi.fn(async () => undefined) }));
import { prepareCloneSample } from './realtime-clone-sample.js';

function processResult(inputCode: string | null, exitCode = 0, size = 120429) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    kill: vi.fn(),
    stdin: new Writable({
      write(_chunk, _encoding, done) {
        done(
          inputCode ? Object.assign(new Error('controlled pipe error'), { code: inputCode }) : null,
        );
      },
    }),
  });
  mocks.spawn.mockImplementation(() => {
    setImmediate(() => {
      stdout.write(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(size - 3)]));
      child.emit('close', exitCode, null);
    });
    return child;
  });
  return child;
}
const sample = { bytes: new Uint8Array(180684), mimeType: 'audio/mpeg' };
beforeEach(() => {
  vi.clearAllMocks();
});
describe('实时音色样本有界转换', () => {
  it('截满十五秒后输入管道提前关闭，成功退出且音频完整仍应接受', async () => {
    const child = processResult('EPIPE');
    const result = await prepareCloneSample(sample, false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sample.bytes.length).toBe(120429);
    expect(child.kill).not.toHaveBeenCalled();
  });
  it('输入提前关闭不能掩盖转换进程失败', async () => {
    processResult('EPIPE', 1);
    expect(await prepareCloneSample(sample, true)).toEqual({ ok: false, reason: 'invalid' });
  });
  it('输入提前关闭不能把过短的输出当作可复刻音频', async () => {
    processResult('EPIPE', 0, 200);
    expect(await prepareCloneSample(sample, false)).toEqual({ ok: false, reason: 'invalid' });
  });
  it('其他管道错误仍中止子进程', async () => {
    const child = processResult('EIO');
    expect(await prepareCloneSample(sample, false)).toEqual({ ok: false, reason: 'invalid' });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
