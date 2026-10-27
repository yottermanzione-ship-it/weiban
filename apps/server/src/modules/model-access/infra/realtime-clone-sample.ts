/**
 * V2（2026-10-28）：把角色的声音样本转成复刻接口要求的格式（官方：WAV 16bit / MP3 / M4A，≥ 24 kHz 单声道，
 * 推荐 10～20 秒，< 10 MB，至少 3 秒连续清晰朗读）。生产镜像自带 `/usr/bin/ffmpeg`（deploy/prod/Dockerfile，
 * 语音合成 Ogg/Opus 编码已在用），这里同样只经管道调用：不走 shell、不落临时文件、只允许 pipe 协议。
 *
 * 与旧版 `realtimeSampleUrl` 一致：截前 15 秒、单声道；Realtime Plus 另做去静音 + 响度归一（旧版 compactSpeech）。
 * 与旧版不同：采样率按官方要求改为 24 kHz（旧版 16 kHz），输出 MP3 64 kbps。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import type { CloneSampleFile } from './dashscope-voice-clone.js';

const FFMPEG = '/usr/bin/ffmpeg';
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
/** 64 kbps × 3 秒 ≈ 24 KB：更短说明样本几乎没有人声，复刻必然失败，不必发给供应商。 */
const MIN_OUTPUT_BYTES = 16 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const TIMEOUT_MS = 30_000;
const MAX_ACTIVE = 2;
export const CLONE_SAMPLE_SECONDS = 15;
let active = 0;

/** ffmpeg 参数（纯函数，便于测试）。compactSpeech = 旧版给 Realtime Plus 用的去静音 + 响度归一。 */
export function cloneSampleArgs(compactSpeech: boolean): string[] {
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-protocol_whitelist',
    'pipe',
    '-i',
    'pipe:0',
    '-vn',
    '-map_metadata',
    '-1',
    ...(compactSpeech
      ? [
          '-af',
          [
            'silenceremove=start_periods=1:start_duration=0.1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.25:stop_threshold=-45dB',
            'loudnorm=I=-20:TP=-2:LRA=11',
          ].join(','),
        ]
      : []),
    '-t',
    String(CLONE_SAMPLE_SECONDS),
    '-ac',
    '1',
    '-ar',
    '24000',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '64k',
    '-f',
    'mp3',
    'pipe:1',
  ];
}

/** MP3 粗检：ID3 头或 MPEG 帧同步字。只防明显的错误输出，不等于完整校验。 */
export function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}

export type CloneSampleResult =
  { ok: true; sample: CloneSampleFile } | { ok: false; reason: 'unavailable' | 'busy' | 'invalid' };

/** 转码裁剪。ffmpeg 不存在（本机开发）返回 unavailable，调用方按复刻失败处理（退回默认音色）。 */
export async function prepareCloneSample(
  input: CloneSampleFile,
  compactSpeech: boolean,
): Promise<CloneSampleResult> {
  if (!input.bytes.length || input.bytes.length > MAX_INPUT_BYTES)
    return { ok: false, reason: 'invalid' };
  if (active >= MAX_ACTIVE) return { ok: false, reason: 'busy' };
  active++;
  try {
    try {
      await access(FFMPEG, constants.X_OK);
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    const output = await new Promise<Uint8Array | null>((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(FFMPEG, cloneSampleArgs(compactSpeech), {
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        resolve(null);
        return;
      }
      let settled = false;
      let size = 0;
      let stderrBytes = 0;
      const chunks: Buffer[] = [];
      const finish = (value: Uint8Array | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (value === null) {
          try {
            child.kill('SIGKILL');
          } catch {
            // 进程已退出。
          }
        }
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), TIMEOUT_MS);
      timer.unref();
      child.on('error', () => finish(null));
      child.stdin.on('error', () => finish(null));
      child.stdout.on('error', () => finish(null));
      child.stderr.on('error', () => finish(null));
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_OUTPUT_BYTES) finish(null);
        else chunks.push(chunk);
      });
      // 只计数、不保留 ffmpeg 的诊断输出。
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_STDERR_BYTES) finish(null);
      });
      child.once('close', (code, signal) => {
        if (code !== 0 || signal !== null) finish(null);
        else finish(new Uint8Array(Buffer.concat(chunks, size)));
      });
      try {
        child.stdin.end(Buffer.from(input.bytes));
      } catch {
        finish(null);
      }
    });
    if (!output || output.length < MIN_OUTPUT_BYTES || !looksLikeMp3(output))
      return { ok: false, reason: 'invalid' };
    return { ok: true, sample: { bytes: output, mimeType: 'audio/mpeg' } };
  } finally {
    active--;
  }
}
