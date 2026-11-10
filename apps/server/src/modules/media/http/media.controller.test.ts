import 'reflect-metadata';
import type { Response } from 'express';
import { beforeEach, expect, it, vi } from 'vitest';
const audio = vi.hoisted(() => ({ compatibleBrowserAudio: vi.fn() }));
vi.mock('../infra/browser-audio.js', () => audio);
import type { MediaService } from '../application/media.js';
import { MediaController } from './media.controller.js';

beforeEach(() => vi.resetAllMocks());

it('先验证签名及归属，再转码；响应格式、长度和缓存头使用实际输出', async () => {
  const original = { body: Buffer.from('original'), mimeType: 'audio/ogg' };
  const converted = { body: Buffer.from('converted-audio'), mimeType: 'audio/mpeg' };
  const download = vi.fn().mockResolvedValue(original);
  audio.compatibleBrowserAudio.mockResolvedValue(converted);
  const res = { setHeader: vi.fn(), end: vi.fn() };
  const controller = new MediaController({ download } as unknown as MediaService);
  await controller.content(
    { mediaId: 'synthetic-media-id' },
    { token: 'synthetic-link-token' },
    '*/*',
    'iPhone',
    res as unknown as Response,
  );
  expect(download).toHaveBeenCalledWith('synthetic-media-id', 'synthetic-link-token', '*/*');
  expect(audio.compatibleBrowserAudio).toHaveBeenCalledWith(original, 'iPhone');
  expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'audio/mpeg');
  expect(res.setHeader).toHaveBeenCalledWith('Content-Length', converted.body.length);
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Accept, User-Agent');
  expect(res.end).toHaveBeenCalledWith(converted.body);
});

it('权限或过期检查失败不触发转码、不发送音频', async () => {
  const download = vi.fn().mockRejectedValue(new Error('denied'));
  const res = { setHeader: vi.fn(), end: vi.fn() };
  const controller = new MediaController({ download } as unknown as MediaService);
  await expect(
    controller.content(
      { mediaId: 'synthetic-media-id' },
      { token: 'expired' },
      '*/*',
      'iPhone',
      res as unknown as Response,
    ),
  ).rejects.toThrow('denied');
  expect(audio.compatibleBrowserAudio).not.toHaveBeenCalled();
  expect(res.end).not.toHaveBeenCalled();
});
