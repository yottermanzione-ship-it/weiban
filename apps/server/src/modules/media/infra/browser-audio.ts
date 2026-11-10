/** 播放时兼容 Apple WebKit；原文件仍加密保存，不调用模型、不写临时音频。 */
import { spawn } from 'node:child_process';
import { AppError } from '../../../platform/http/app-error.js';

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 6 * 1024 * 1024;
const MAX_ACTIVE = 2;
let active = 0;

/** iOS 的各浏览器和主屏幕网页共用 WebKit；桌面 Safari 也用兼容音频。 */
export function needsCompatibleAudio(mimeType: string, userAgent = ''): boolean {
  if (mimeType !== 'audio/ogg') return false;
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return (
    /AppleWebKit/i.test(userAgent) &&
    /Safari/i.test(userAgent) &&
    !/Chrome|Chromium|Android|Edg\/|OPR\//i.test(userAgent)
  );
}

const ARGS = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-nostdin',
  '-threads',
  '1',
  '-protocol_whitelist',
  'pipe',
  '-f',
  'ogg',
  '-i',
  'pipe:0',
  '-map',
  '0:a:0',
  '-vn',
  '-map_metadata',
  '-1',
  '-ac',
  '1',
  '-ar',
  '24000',
  '-c:a',
  'libmp3lame',
  '-b:a',
  '96k',
  '-f',
  'mp3',
  'pipe:1',
];

function transcode(input: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('/usr/bin/ffmpeg', ARGS, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      resolve(null);
      return;
    }
    let done = false;
    let size = 0;
    let diagnosticBytes = 0;
    const chunks: Buffer[] = [];
    const finish = (body: Buffer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!body) child.kill('SIGKILL');
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(body);
    };
    const timer = setTimeout(() => finish(null), 12_000);
    timer.unref();
    child.once('error', () => finish(null));
    child.stdin!.on('error', () => finish(null));
    child.stdout!.on('error', () => finish(null));
    child.stderr!.on('error', () => finish(null));
    child.stdout!.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) finish(null);
      else chunks.push(chunk);
    });
    // 诊断可能含音频标签：只计数，不保存或打印。
    child.stderr!.on('data', (chunk: Buffer) => {
      diagnosticBytes += chunk.length;
      if (diagnosticBytes > 64 * 1024) finish(null);
    });
    child.once('close', (code, signal) => {
      if (code !== 0 || signal !== null || size < 128) {
        finish(null);
        return;
      }
      const body = Buffer.concat(chunks, size);
      const mp3 =
        body.subarray(0, 3).toString('ascii') === 'ID3' ||
        (body[0] === 0xff && (body[1]! & 0xe0) === 0xe0);
      finish(mp3 ? body : null);
    });
    child.stdin!.end(input);
  });
}

/** 必须先通过既有签名、到期和归属检查，再传入已授权的音频。 */
export async function compatibleBrowserAudio(
  media: { body: Buffer; mimeType: string },
  userAgent?: string,
): Promise<{ body: Buffer; mimeType: string }> {
  if (!needsCompatibleAudio(media.mimeType, userAgent)) return media;
  if (!media.body.length || media.body.length > MAX_INPUT_BYTES)
    throw new AppError('bad_request', '语音文件无法播放');
  if (active >= MAX_ACTIVE) throw new AppError('rate_limited', '语音播放繁忙，请稍后重试');
  active++;
  try {
    const body = await transcode(media.body);
    if (!body) throw new AppError('service_unavailable', '语音暂时无法播放，请稍后重试');
    return { body, mimeType: 'audio/mpeg' };
  } finally {
    active--;
  }
}
