import { MEDIA_LIMITS, type AuthResponse, type LegacyFavoriteImportItem } from '@weiban/contracts';
import { LegacyFavoritesFailure, LegacyFavoritesNative } from './legacy-favorites-native.js';
import { uploadMedia } from './upload.js';
import { ApiFailure } from '@weiban/client-core';

const CHUNK_BYTES = 128 * 1024;
const MAX_BYTES = 16 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const unavailable = new Set(['remote_reference', 'file_missing', 'media_unavailable']);
export type LegacyMediaResult =
  | { status: 'unavailable'; issue: 'remote_reference' | 'file_missing' | 'media_unavailable' }
  | { status: 'ready'; blob: Blob; mimeType: string; bytes: number; sha256: string };

export async function readLegacyFavoriteMedia(options: {
  auth: AuthResponse;
  native: LegacyFavoritesNative;
  snapshotDigest: string;
  item: { accountKey: string; itemKey: string };
  signal: AbortSignal;
  current(): boolean;
}): Promise<LegacyMediaResult> {
  const { auth, native, item, signal, snapshotDigest } = options;
  const owner = `${auth.user.userId}:${auth.session.sessionId}`;
  const live = () => {
    if (signal.aborted || !options.current())
      throw new DOMException('Legacy media transfer cancelled', 'AbortError');
  };
  let offset = 0,
    sha256: string | null = null,
    mimeType: string | null = null;
  let buffer: Uint8Array<ArrayBuffer> | null = null;
  try {
    for (;;) {
      live();
      let chunk: Record<string, unknown>;
      try {
        chunk = await native.request(
          'media',
          owner,
          {
            snapshotDigest,
            accountKey: item.accountKey,
            itemKey: item.itemKey,
            offset,
            limit: CHUNK_BYTES,
            sha256,
          },
          signal,
        );
      } catch (error) {
        live();
        if (error instanceof LegacyFavoritesFailure && unavailable.has(error.code) && offset === 0)
          return {
            status: 'unavailable',
            issue: error.code as 'remote_reference' | 'file_missing' | 'media_unavailable',
          };
        throw error;
      }
      live();
      if (
        chunk.userId !== auth.user.userId ||
        chunk.snapshotDigest !== snapshotDigest ||
        chunk.accountKey !== item.accountKey ||
        chunk.itemKey !== item.itemKey ||
        chunk.offset !== offset ||
        !Number.isSafeInteger(chunk.bytes) ||
        (chunk.bytes as number) <= 0 ||
        (chunk.bytes as number) > MAX_BYTES ||
        typeof chunk.sha256 !== 'string' ||
        !HASH.test(chunk.sha256) ||
        typeof chunk.mimeType !== 'string' ||
        typeof chunk.base64 !== 'string' ||
        chunk.base64.length > Math.ceil(CHUNK_BYTES / 3) * 4 ||
        !BASE64.test(chunk.base64)
      )
        throw new LegacyFavoritesFailure('invalid_reply');
      if (!buffer) {
        sha256 = chunk.sha256;
        mimeType = chunk.mimeType;
        buffer = new Uint8Array(chunk.bytes as number);
      } else if (
        sha256 !== chunk.sha256 ||
        mimeType !== chunk.mimeType ||
        buffer.length !== chunk.bytes
      )
        throw new LegacyFavoritesFailure('file_changed');
      let decoded: string;
      try {
        decoded = atob(chunk.base64);
      } catch {
        throw new LegacyFavoritesFailure('invalid_reply');
      }
      const next = offset + decoded.length;
      if (
        decoded.length < 1 ||
        decoded.length > CHUNK_BYTES ||
        next > buffer.length ||
        (next < buffer.length && chunk.nextOffset !== next) ||
        (next === buffer.length && chunk.nextOffset !== null)
      )
        throw new LegacyFavoritesFailure('invalid_reply');
      for (let index = 0; index < decoded.length; index++)
        buffer[offset + index] = decoded.charCodeAt(index);
      offset = next;
      if (chunk.nextOffset === null) break;
    }
    live();
    const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer!))]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    live();
    if (actual !== sha256) throw new LegacyFavoritesFailure('file_changed');
    return {
      status: 'ready',
      blob: new Blob([buffer!], { type: mimeType! }),
      mimeType: mimeType!,
      bytes: buffer!.length,
      sha256: actual,
    };
  } finally {
    buffer?.fill(0);
  }
}

export async function attachLegacyFavoriteMedia(options: {
  auth: AuthResponse;
  native: LegacyFavoritesNative;
  snapshotDigest: string;
  item: LegacyFavoriteImportItem;
  signal: AbortSignal;
  current(): boolean;
}): Promise<{ item: LegacyFavoriteImportItem; unavailable: boolean }> {
  const message = options.item.favorite.message;
  if (!['image', 'voice'].includes(message.type ?? '') && !message.imageUrl && !message.audioPath)
    return { item: options.item, unavailable: false };
  const live = () => {
    if (options.signal.aborted || !options.current())
      throw new DOMException('Legacy media transfer cancelled', 'AbortError');
  };
  const pending = (issue: NonNullable<LegacyFavoriteImportItem['mediaIssue']>) => ({
    item: { ...options.item, mediaIssue: issue },
    unavailable: true,
  });
  try {
    const asset = await readLegacyFavoriteMedia(options);
    if (asset.status === 'unavailable') return pending(asset.issue);
    live();
    const image = (MEDIA_LIMITS.imageMimeTypes as readonly string[]).includes(asset.mimeType);
    const voice = (MEDIA_LIMITS.voiceMimeTypes as readonly string[]).includes(asset.mimeType);
    if (!image && !voice) return pending('unsupported_media');
    const durationMs =
      typeof message.duration === 'number' ? Math.round(message.duration * 1000) : undefined;
    if (
      asset.bytes > (image ? MEDIA_LIMITS.imageMaxBytes : MEDIA_LIMITS.voiceMaxBytes) ||
      (voice && durationMs !== undefined && durationMs > MEDIA_LIMITS.voiceMaxDurationMs)
    )
      return pending('upload_limit_exceeded');
    const uploaded = await uploadMedia(image ? 'chat_image' : 'chat_voice', asset.blob, {
      signal: options.signal,
      owner: {
        userId: options.auth.user.userId,
        sessionId: options.auth.session.sessionId,
        token: options.auth.session.token,
      },
      ...(voice && durationMs !== undefined ? { durationMs } : {}),
    });
    live();
    // The existing media service validates then normalizes images to WebP. The source
    // hash protects native transfer; the returned MediaObject describes normalized bytes.
    if (
      uploaded.purpose !== (image ? 'chat_image' : 'chat_voice') ||
      !(
        image
          ? (MEDIA_LIMITS.imageMimeTypes as readonly string[])
          : (MEDIA_LIMITS.voiceMimeTypes as readonly string[])
      ).includes(uploaded.mimeType)
    )
      return pending('media_unavailable');
    return { item: { ...options.item, mediaId: uploaded.mediaId }, unavailable: false };
  } catch (error) {
    live();
    if (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof ApiFailure && error.code === 'request_cancelled')
    )
      throw new DOMException('Legacy media transfer cancelled', 'AbortError');
    if (error instanceof LegacyFavoritesFailure) {
      if (
        ['snapshot_changed', 'source_changed', 'invalid_reply', 'native_failed'].includes(
          error.code,
        )
      )
        throw error;
      if (
        error.code === 'path_rejected' ||
        error.code === 'unsupported_media' ||
        error.code === 'media_too_large' ||
        error.code === 'item_ambiguous'
      )
        return pending(error.code);
    }
    return pending('media_unavailable');
  }
}
