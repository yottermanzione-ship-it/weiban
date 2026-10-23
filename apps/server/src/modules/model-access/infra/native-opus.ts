import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';

export type NativeOpusLease = {
  encode(pcm: Uint8Array): Promise<Uint8Array>;
  release(): void;
};

const FFMPEG = '/usr/bin/ffmpeg';
const MAX_LEASES = 2;
const MAX_PCM_BYTES = 12_000_000;
const MAX_OUTPUT_BYTES = 10_000_000;
const MAX_STDERR_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;
// Linux deployment only: no PATH lookup, shell, external input protocol or temporary files.
const FFMPEG_ARGS = [
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
];
let activeLeases = 0;

/** Acquire before a paid provider call; the caller must release in finally. */
export async function acquireNativeOpusEncoder(): Promise<
  { ok: true; lease: NativeOpusLease } | { ok: false; reason: 'unavailable' | 'busy' }
> {
  if (activeLeases >= MAX_LEASES) return { ok: false, reason: 'busy' };
  // Reserve synchronously so concurrent access checks cannot oversubscribe the pool.
  activeLeases++;
  try {
    await access(FFMPEG, constants.X_OK);
  } catch {
    activeLeases--;
    return { ok: false, reason: 'unavailable' };
  }

  let released = false;
  let encoding = false;
  let cancelEncode: (() => void) | undefined;
  return {
    ok: true,
    lease: {
      async encode(pcm) {
        if (released) throw new Error('NATIVE_OPUS_LEASE_RELEASED');
        if (
          !(pcm instanceof Uint8Array) ||
          pcm.length === 0 ||
          pcm.length % 2 !== 0 ||
          pcm.length > MAX_PCM_BYTES
        )
          throw new Error('NATIVE_OPUS_INVALID_PCM');
        if (encoding) throw new Error('NATIVE_OPUS_LEASE_IN_USE');
        encoding = true;
        try {
          return await new Promise<Uint8Array>((resolve, reject) => {
            let child: ChildProcessWithoutNullStreams;
            try {
              child = spawn(FFMPEG, FFMPEG_ARGS, {
                shell: false,
                stdio: ['pipe', 'pipe', 'pipe'],
              });
            } catch {
              reject(new Error('NATIVE_OPUS_SPAWN_FAILED'));
              return;
            }
            let settled = false;
            let closed = false;
            let outputBytes = 0;
            let stderrBytes = 0;
            const chunks: Buffer[] = [];
            const timer = setTimeout(() => fail('NATIVE_OPUS_TIMEOUT'), TIMEOUT_MS);
            timer.unref();
            const cleanup = () => {
              clearTimeout(timer);
              cancelEncode = undefined;
              chunks.length = 0;
              child.stdin.destroy();
              child.stdout.destroy();
              child.stderr.destroy();
            };
            const fail = (code: string) => {
              if (settled) return;
              settled = true;
              if (!closed) {
                try {
                  child.kill('SIGKILL');
                } catch {
                  // Still close our pipes and reject with a fixed, non-provider error.
                }
              }
              cleanup();
              reject(new Error(code));
            };
            // Keep error handlers attached while destroyed pipes finish closing (e.g. late EPIPE).
            child.on('error', () => fail('NATIVE_OPUS_PROCESS_FAILED'));
            child.stdin.on('error', () => fail('NATIVE_OPUS_INPUT_FAILED'));
            child.stdout.on('error', () => fail('NATIVE_OPUS_OUTPUT_FAILED'));
            child.stderr.on('error', () => fail('NATIVE_OPUS_STDERR_FAILED'));
            child.stdout.on('data', (chunk: Buffer) => {
              if (settled) return;
              outputBytes += chunk.length;
              if (outputBytes > MAX_OUTPUT_BYTES) {
                fail('NATIVE_OPUS_OUTPUT_LIMIT');
                return;
              }
              chunks.push(chunk);
            });
            child.stderr.on('data', (chunk: Buffer) => {
              if (settled) return;
              // Count and discard: never retain or expose FFmpeg stderr plaintext.
              stderrBytes += chunk.length;
              if (stderrBytes > MAX_STDERR_BYTES) fail('NATIVE_OPUS_STDERR_LIMIT');
            });
            child.once('close', (code, signal) => {
              closed = true;
              if (settled) return;
              if (code !== 0 || signal !== null) {
                fail('NATIVE_OPUS_EXIT_FAILED');
                return;
              }
              const output = Buffer.concat(chunks, outputBytes);
              // A sanity check, NOT full Ogg/Opus validation or proof of decodability.
              // FFmpeg handles Ogg CRC/pre-skip; offline integration must actually decode it.
              if (
                !output.subarray(0, 4).equals(Buffer.from('OggS', 'ascii')) ||
                !output.subarray(0, 128).includes(Buffer.from('OpusHead', 'ascii'))
              ) {
                fail('NATIVE_OPUS_INVALID_OUTPUT');
                return;
              }
              settled = true;
              cleanup();
              resolve(new Uint8Array(output));
            });
            cancelEncode = () => fail('NATIVE_OPUS_LEASE_RELEASED');
            try {
              // PCM16LE, 24 kHz, mono. Original duration is pcm.length / 48 milliseconds.
              child.stdin.end(pcm);
            } catch {
              fail('NATIVE_OPUS_INPUT_FAILED');
            }
          });
        } finally {
          encoding = false;
          cancelEncode = undefined;
        }
      },
      release() {
        if (released) return;
        released = true;
        cancelEncode?.();
        activeLeases--;
      },
    },
  };
}
