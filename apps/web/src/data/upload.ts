import { z } from 'zod';
import { ApiFailure } from '@weiban/client-core';
import {
  API_PREFIX,
  ApiError,
  AuthResponse,
  MediaObject,
  ImportJob,
  type UserMediaPurpose,
} from '@weiban/contracts';
import { api, localStore } from './client.js';

/*
 * 聊天图片 / 语音上传。ApiClient 的上传不支持进度和额外表单字段（语音要带 durationMs），
 * 这里用 XMLHttpRequest 直接调 POST /media（契约 MediaEndpoints.upload），响应仍按契约解析。
 */

type UploadOwner = { userId: string; sessionId: string; token: string };
const cancelledUpload = () => new ApiFailure('request_cancelled', '请求已取消', 0);
async function token(owner?: UploadOwner): Promise<string> {
  const parsed = AuthResponse.safeParse(await localStore.get('session'));
  if (!parsed.success) throw new ApiFailure('unauthenticated', '请先登录', 401);
  if (
    owner &&
    (parsed.data.user.userId !== owner.userId ||
      parsed.data.session.sessionId !== owner.sessionId ||
      parsed.data.session.token !== owner.token ||
      !api.owns(owner))
  )
    throw cancelledUpload();
  return owner?.token ?? parsed.data.session.token;
}

export async function uploadMedia(
  purpose: z.infer<typeof UserMediaPurpose>,
  file: Blob,
  options: {
    durationMs?: number;
    onProgress?(percent: number): void;
    signal?: AbortSignal;
    owner?: UploadOwner;
  } = {},
): Promise<MediaObject> {
  const owner = options.owner ? { ...options.owner } : undefined;
  if (options.signal?.aborted) throw cancelledUpload();
  const bearer = await token(owner);
  if (options.signal?.aborted || (owner && !api.owns(owner))) throw cancelledUpload();
  const form = new FormData();
  form.set('file', file, purpose);
  if (options.durationMs !== undefined)
    form.set('durationMs', String(Math.round(options.durationMs)));
  return new Promise<MediaObject>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const abort = () => xhr.abort();
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      reject(error);
    };
    const succeed = (media: MediaObject) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      resolve(media);
    };
    xhr.open('POST', `${API_PREFIX}/media?purpose=${encodeURIComponent(purpose)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${bearer}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 60_000;
    xhr.upload.onprogress = (event) => {
      if (options.signal?.aborted || (owner && !api.owns(owner))) return;
      if (event.lengthComputable && options.onProgress)
        options.onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      if (options.signal?.aborted || (owner && !api.owns(owner))) {
        fail(cancelledUpload());
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(xhr.responseText);
      } catch {
        raw = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = MediaObject.safeParse(raw);
        if (parsed.success) {
          options.onProgress?.(100);
          succeed(parsed.data);
        } else fail(new ApiFailure('unsupported', '上传结果无法识别', xhr.status));
        return;
      }
      const error = ApiError.safeParse(raw);
      fail(
        new ApiFailure(
          error.success ? error.data.error.code : 'unsupported',
          error.success ? error.data.error.message : '上传失败，请稍后重试',
          xhr.status,
        ),
      );
    };
    xhr.onerror = () => fail(new ApiFailure('network_error', '网络暂不可用，请稍后重试', 0));
    xhr.ontimeout = xhr.onerror;
    options.signal?.addEventListener('abort', abort, { once: true });
    xhr.onabort = () => fail(cancelledUpload());
    if (options.signal?.aborted || (owner && !api.owns(owner))) {
      fail(cancelledUpload());
      return;
    }
    try {
      xhr.send(form);
    } catch {
      fail(new ApiFailure('network_error', '网络暂不可用，请稍后重试', 0));
    }
  });
}

/** 长边超过 2048 时先压缩为 JPEG（GIF 保留动图不压缩）。返回文件与宽高。 */
export async function prepareImage(
  file: File,
): Promise<{ blob: Blob; width: number | null; height: number | null }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { blob: file, width: null, height: null };
  }
  const { width, height } = bitmap;
  const longest = Math.max(width, height);
  if (longest <= 2048 || file.type === 'image/gif') {
    bitmap.close();
    return { blob: file, width, height };
  }
  const scale = 2048 / longest;
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.86),
  );
  return { blob: blob ?? file, width: w, height: h };
}

/** 导入任务上传一份 .txt / .csv 或一张截图（契约 ImporterEndpoints.uploadFile，multipart 字段 file，保留原文件名）。 */
export async function uploadImportFile(jobId: string, file: File): Promise<ImportJob> {
  const bearer = await token();
  const form = new FormData();
  form.set('file', file, file.name || 'upload');
  const response = await fetch(`${API_PREFIX}/imports/${encodeURIComponent(jobId)}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
    body: form,
  }).catch(() => {
    throw new ApiFailure('network_error', '网络暂不可用，请稍后重试', 0);
  });
  const raw: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = ImportJob.safeParse(raw);
    if (parsed.success) return parsed.data;
    throw new ApiFailure('unsupported', '上传结果无法识别', response.status);
  }
  if (response.status === 401) window.dispatchEvent(new Event('weiban:unauthenticated'));
  const error = ApiError.safeParse(raw);
  throw new ApiFailure(
    error.success ? error.data.error.code : 'unsupported',
    error.success ? error.data.error.message : '上传失败，请稍后重试',
    response.status,
  );
}
