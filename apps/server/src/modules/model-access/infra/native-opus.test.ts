import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { constants } from 'node:fs';

const native = vi.hoisted(() => ({ access: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  access: native.access,
}));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: native.spawn,
}));
import { acquireNativeOpusEncoder, type NativeOpusLease } from './native-opus.js';

// Synthetic events only: these tests never execute FFmpeg or contact a provider.
function fakeChild() {
  const pipe = () => Object.assign(new EventEmitter(), { destroy: vi.fn() });
  return Object.assign(new EventEmitter(), {
    stdin: Object.assign(pipe(), { end: vi.fn() }),
    stdout: pipe(),
    stderr: pipe(),
    kill: vi.fn(() => true),
  });
}
// Deliberately NOT decodable audio: exercises only the documented header sanity check.
function headerFixture(offset = 32): Buffer {
  const bytes = Buffer.alloc(Math.max(64, offset + 8));
  bytes.write('OggS');
  bytes.write('OpusHead', offset);
  return bytes;
}
const pcm = Uint8Array.of(0, 1, 255, 127);
let child: ReturnType<typeof fakeChild>;
let leases: NativeOpusLease[];
async function lease(): Promise<NativeOpusLease> {
  const result = await acquireNativeOpusEncoder();
  if (!result.ok) throw new Error(`Expected fixture lease, got ${result.reason}`);
  leases.push(result.lease);
  return result.lease;
}
function finish(bytes = headerFixture(), process = child) {
  process.stdout.emit('data', bytes);
  process.emit('close', 0, null);
}
function expectTerminated(process = child) {
  expect(process.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
  expect(process.stdin.destroy).toHaveBeenCalledTimes(1);
  expect(process.stdout.destroy).toHaveBeenCalledTimes(1);
  expect(process.stderr.destroy).toHaveBeenCalledTimes(1);
}
beforeEach(() => {
  vi.resetAllMocks();
  leases = [];
  child = fakeChild();
  native.access.mockResolvedValue(undefined);
  native.spawn.mockReturnValue(child);
});
afterEach(() => {
  for (const acquired of leases) acquired.release();
  vi.useRealTimers();
});

describe('native Linux Opus encoder leases', () => {
  it('reports unavailable on failed X_OK checks without spawning, and frees the reservation', async () => {
    native.access.mockRejectedValue(new Error('synthetic missing executable'));
    for (let i = 0; i < 3; i++) {
      expect(await acquireNativeOpusEncoder()).toEqual({ ok: false, reason: 'unavailable' });
    }
    expect(native.access).toHaveBeenCalledWith('/usr/bin/ffmpeg', constants.X_OK);
    expect(native.spawn).not.toHaveBeenCalled();
    native.access.mockResolvedValue(undefined);
    await lease();
    await lease();
  });

  it('allows only two leases and makes release idempotent', async () => {
    const first = await lease();
    await lease();
    expect(await acquireNativeOpusEncoder()).toEqual({ ok: false, reason: 'busy' });
    expect(native.access).toHaveBeenCalledTimes(2);
    expect(native.spawn).not.toHaveBeenCalled();
    first.release();
    first.release();
    await lease();
    expect(await acquireNativeOpusEncoder()).toEqual({ ok: false, reason: 'busy' });
  });

  it('reserves slots before asynchronous access completes', async () => {
    let allowAccess!: () => void;
    native.access.mockReturnValue(
      new Promise<void>((resolve) => {
        allowAccess = resolve;
      }),
    );
    const first = lease();
    const second = lease();
    expect(await acquireNativeOpusEncoder()).toEqual({ ok: false, reason: 'busy' });
    expect(native.access).toHaveBeenCalledTimes(2);
    allowAccess();
    await Promise.all([first, second]);
    expect(native.spawn).not.toHaveBeenCalled();
  });

  it('rejects encoding through a released lease without spawning', async () => {
    const acquired = await lease();
    acquired.release();
    await expect(acquired.encode(pcm)).rejects.toThrow('NATIVE_OPUS_LEASE_RELEASED');
    expect(native.spawn).not.toHaveBeenCalled();
  });
});

describe('bounded pipe-only FFmpeg encoding', () => {
  it('uses only the fixed executable/arguments and stdin, returning bytes only after close=0', async () => {
    const acquired = await lease();
    const encoded = acquired.encode(pcm);
    expect(native.spawn).toHaveBeenCalledExactlyOnceWith(
      '/usr/bin/ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-protocol_whitelist',
        'pipe',
        '-f',
        's16le',
        '-ar',
        '24000',
        '-ac',
        '1',
        '-i',
        'pipe:0',
        '-map_metadata',
        '-1',
        '-c:a',
        'libopus',
        '-b:a',
        '24k',
        '-vbr',
        'on',
        '-application',
        'voip',
        '-ar',
        '24000',
        '-ac',
        '1',
        '-f',
        'ogg',
        'pipe:1',
      ],
      { shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    expect(child.stdin.end).toHaveBeenCalledExactlyOnceWith(pcm);
    const bytes = headerFixture();
    child.stdout.emit('data', bytes.subarray(0, 3));
    child.stdout.emit('data', bytes.subarray(3));
    const resolved = vi.fn();
    void encoded.then(resolved);
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    child.emit('close', 0, null);
    expect(await encoded).toEqual(new Uint8Array(bytes));
    expect(child.kill).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', new Uint8Array()],
    ['odd', new Uint8Array(3)],
    ['oversized', new Uint8Array(12_000_002)],
    ['not bytes', null as unknown as Uint8Array],
  ])('rejects %s input before spawning', async (_label, input) => {
    const acquired = await lease();
    await expect(acquired.encode(input as Uint8Array)).rejects.toThrow('NATIVE_OPUS_INVALID_PCM');
    expect(native.spawn).not.toHaveBeenCalled();
  });

  it('accepts the exact PCM byte limit', async () => {
    const acquired = await lease();
    const bytes = new Uint8Array(12_000_000);
    const encoded = acquired.encode(bytes);
    // Reference identity, not a 12 MB element-by-element deep comparison.
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    expect(child.stdin.end.mock.calls[0]![0]).toBe(bytes);
    finish();
    await encoded;
  });

  it('does not let one lease spawn concurrent encoders, but permits sequential reuse', async () => {
    const acquired = await lease();
    const first = acquired.encode(pcm);
    await expect(acquired.encode(pcm)).rejects.toThrow('NATIVE_OPUS_LEASE_IN_USE');
    expect(native.spawn).toHaveBeenCalledTimes(1);
    finish();
    await first;
    const next = fakeChild();
    native.spawn.mockReturnValue(next);
    const second = acquired.encode(pcm);
    finish(headerFixture(), next);
    await second;
    expect(native.spawn).toHaveBeenCalledTimes(2);
  });

  it('returns only a fixed error when spawn throws', async () => {
    native.spawn.mockImplementation(() => {
      throw new Error('synthetic private detail');
    });
    await expect((await lease()).encode(pcm)).rejects.toThrow('NATIVE_OPUS_SPAWN_FAILED');
  });

  it.each([
    [1, null],
    [null, 'SIGTERM'],
    [0, 'SIGTERM'],
  ])('rejects an abnormal close (%s, %s) even with the expected header', async (code, signal) => {
    const acquired = await lease();
    const rejected = expect(acquired.encode(pcm)).rejects.toThrow('NATIVE_OPUS_EXIT_FAILED');
    child.stderr.emit('data', Buffer.from('synthetic private stderr detail'));
    child.stdout.emit('data', headerFixture());
    child.emit('close', code, signal);
    await rejected;
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['non-Ogg', Buffer.from('RIFF-not-Ogg-OpusHead')],
    [
      'high-bit Ogg lookalike',
      Buffer.concat([Buffer.from([0xcf, 0xe7, 0xe7, 0xd3]), headerFixture().subarray(4)]),
    ],
    ['Ogg without Opus', Buffer.from('OggS-not-Opus')],
    ['OpusHead outside the prefix', headerFixture(128)],
    ['OpusHead crossing the prefix boundary', headerFixture(124)],
  ])('rejects %s output on close=0', async (_label, bytes) => {
    const acquired = await lease();
    const rejected = expect(acquired.encode(pcm)).rejects.toThrow('NATIVE_OPUS_INVALID_OUTPUT');
    finish(bytes as Buffer);
    await rejected;
  });

  it('kills and closes pipes on the 15-second deadline', async () => {
    vi.useFakeTimers();
    const acquired = await lease();
    const rejected = expect(acquired.encode(pcm)).rejects.toThrow('NATIVE_OPUS_TIMEOUT');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expectTerminated();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('kills when accumulated stdout exceeds 10,000,000 bytes', async () => {
    const acquired = await lease();
    const rejected = expect(acquired.encode(pcm)).rejects.toThrow('NATIVE_OPUS_OUTPUT_LIMIT');
    child.stdout.emit('data', Buffer.alloc(10_000_000));
    expect(child.kill).not.toHaveBeenCalled();
    child.stdout.emit('data', Buffer.alloc(1));
    await rejected;
    expectTerminated();
    // Late events cannot turn a rejected encoding into success or kill twice.
    child.emit('close', 0, null);
    child.stdin.emit('error', new Error('synthetic late EPIPE'));
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('counts and discards stderr, killing above 64 KiB without exposing its plaintext', async () => {
    const acquired = await lease();
    const rejected = expect(acquired.encode(pcm)).rejects.toThrow(/^NATIVE_OPUS_STDERR_LIMIT$/);
    child.stderr.emit('data', Buffer.alloc(64 * 1024, 'x'));
    expect(child.kill).not.toHaveBeenCalled();
    child.stderr.emit('data', Buffer.from('synthetic private stderr detail'));
    await rejected;
    expectTerminated();
  });

  it.each([
    ['process', 'NATIVE_OPUS_PROCESS_FAILED'],
    ['stdin', 'NATIVE_OPUS_INPUT_FAILED'],
    ['stdout', 'NATIVE_OPUS_OUTPUT_FAILED'],
    ['stderr', 'NATIVE_OPUS_STDERR_FAILED'],
  ])('kills and closes pipes on %s errors', async (source, message) => {
    const acquired = await lease();
    const rejected = expect(acquired.encode(pcm)).rejects.toThrow(message);
    const emitter = source === 'process' ? child : child[source as 'stdin' | 'stdout' | 'stderr'];
    emitter.emit('error', new Error('synthetic private error detail'));
    await rejected;
    expectTerminated();
  });

  it('kills on a synchronous stdin write failure', async () => {
    child.stdin.end.mockImplementation(() => {
      throw new Error('synthetic write failure');
    });
    await expect((await lease()).encode(pcm)).rejects.toThrow('NATIVE_OPUS_INPUT_FAILED');
    expectTerminated();
  });

  it('release cancels an in-flight encoding exactly once and frees capacity', async () => {
    const acquired = await lease();
    const rejected = expect(acquired.encode(pcm)).rejects.toThrow('NATIVE_OPUS_LEASE_RELEASED');
    acquired.release();
    acquired.release();
    await rejected;
    expectTerminated();
    await lease();
    await lease();
    expect(await acquireNativeOpusEncoder()).toEqual({ ok: false, reason: 'busy' });
  });
});
