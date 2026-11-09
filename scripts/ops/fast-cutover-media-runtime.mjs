/** Existing media runtime/normalizers only. Bundle with the target maintenance runner, as prior importers do. */
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { createImportMediaService } from '../../apps/server/src/modules/media/application/import-runtime.ts';
import { sniffAudioMime } from '../../apps/server/src/modules/media/application/media.ts';
import { normalizeDashscopeWav } from '../../apps/server/src/modules/model-access/infra/media-adapter.ts';

const MAX_BYTES = 10 * 1024 * 1024;
function transcode(bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-map_metadata',
        '-1',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '24000',
        '-c:a',
        'libopus',
        '-b:a',
        '48k',
        '-f',
        'ogg',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
    );
    const chunks = [];
    let size = 0,
      finished = false;
    const end = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const output = error ? null : Buffer.concat(chunks);
      for (const chunk of chunks) chunk.fill(0);
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      end(new Error('FAST_MEDIA_AUDIO_TIMEOUT'));
    }, 45000);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        chunk.fill(0);
        child.kill('SIGKILL');
        end(new Error('FAST_MEDIA_AUDIO_TOO_LARGE'));
      } else if (!finished) chunks.push(chunk);
      else chunk.fill(0);
    });
    child.on('error', () => end(new Error('FAST_MEDIA_FFMPEG_UNAVAILABLE')));
    child.on('close', (code) =>
      end(code === 0 && size > 0 ? null : new Error('FAST_MEDIA_AUDIO_TRANSCODE_FAILED')),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}

/** Mirrors the existing legacy-content-media normalization, using its exact audio helpers. */
export async function normalizeFastCutoverMedia(object, source) {
  let bytes = Buffer.from(source);
  try {
    if (['chat_voice', 'generated_voice'].includes(object.purpose)) {
      let mimeType = sniffAudioMime(bytes);
      if (!mimeType) throw new Error('FAST_MEDIA_AUDIO_HEADER_INVALID');
      const durationMs = object.durationMs == null ? undefined : Number(object.durationMs);
      if (
        durationMs !== undefined &&
        (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 300000)
      )
        throw new Error('FAST_MEDIA_AUDIO_DURATION_INVALID');
      if (mimeType === 'audio/wav') {
        const fixed = normalizeDashscopeWav(bytes);
        const replacement = fixed ? Buffer.from(fixed) : await transcode(bytes);
        bytes.fill(0);
        bytes = replacement;
        mimeType = sniffAudioMime(bytes);
      }
      if (bytes.length > MAX_BYTES) {
        const replacement = await transcode(bytes);
        bytes.fill(0);
        bytes = replacement;
        mimeType = sniffAudioMime(bytes);
      }
      if (!mimeType) throw new Error('FAST_MEDIA_AUDIO_HEADER_INVALID');
      return { bytes, mimeType, ...(durationMs === undefined ? {} : { durationMs }) };
    }
    const metadata = await sharp(bytes, { animated: true, limitInputPixels: 40000000 }).metadata();
    let mimeType = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[
      metadata.format
    ];
    if (metadata.format === 'svg') {
      if (
        bytes.length > 1024 * 1024 ||
        /<!ENTITY|<!DOCTYPE|<script\b|(?:href|url\()\s*['" ]*(?:https?:|file:|\/\/)/i.test(
          bytes.toString('utf8'),
        )
      )
        throw new Error('FAST_MEDIA_SVG_EXTERNAL_REJECTED');
      const replacement = await sharp(bytes, { density: 144, limitInputPixels: 40000000 })
        .png()
        .toBuffer();
      bytes.fill(0);
      bytes = replacement;
      mimeType = 'image/png';
    }
    if (!mimeType) throw new Error('FAST_MEDIA_IMAGE_FORMAT_UNSUPPORTED');
    return { bytes, mimeType };
  } catch (error) {
    bytes.fill(0);
    throw new Error(
      /^FAST_MEDIA_[A-Z_]+$/.test(String(error?.message))
        ? error.message
        : 'FAST_MEDIA_NORMALIZATION_FAILED',
      { cause: error },
    );
  }
}

/** Caller supplies existing secret-bearing runtime objects; this function never loads credentials/config. */
export function createFastCutoverMediaRuntime({
  database,
  config,
  clock,
  crypto,
  audit,
  apply = false,
}) {
  const media = createImportMediaService({
    database,
    config,
    clock,
    crypto,
    audit,
    apply,
    accountStatus: {
      getAccountStatus: async (id, tx) => {
        const result = await (tx ?? database).query(
          'SELECT status FROM identity.users WHERE id=$1 FOR KEY SHARE',
          [id],
        );
        return result.rows[0]?.status ?? 'deleted';
      },
    },
  });
  return { media, normalize: normalizeFastCutoverMedia };
}
