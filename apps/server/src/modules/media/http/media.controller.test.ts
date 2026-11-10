import 'reflect-metadata';
import type { Request, Response } from 'express';
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
    { headers: {} } as Request,
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
      { headers: {} } as Request,
      res as unknown as Response,
    ),
  ).rejects.toThrow('denied');
  expect(audio.compatibleBrowserAudio).not.toHaveBeenCalled();
  expect(res.end).not.toHaveBeenCalled();
});

it('Apple分段读取基于转换后的字节与长度，不使用原Ogg长度', async () => {
  const download = vi.fn().mockResolvedValue({ body: Buffer.alloc(500), mimeType: 'audio/ogg' });
  const body = Buffer.from('ID3-converted-audio');
  audio.compatibleBrowserAudio.mockResolvedValue({ body, mimeType: 'audio/mpeg' });
  const range = vi.fn().mockReturnValue(Object.assign([{ start: 0, end: 1 }], { type: 'bytes' }));
  const request = { headers: { range: 'bytes=0-1' }, range } as unknown as Request;
  const res = { status: vi.fn(), setHeader: vi.fn(), end: vi.fn() };
  const controller = new MediaController({ download } as unknown as MediaService);
  await controller.content(
    { mediaId: 'synthetic' },
    { token: 'synthetic' },
    '*/*',
    'iPhone',
    request,
    res as unknown as Response,
  );
  expect(range).toHaveBeenCalledWith(body.length, { combine: true });
  expect(res.status).toHaveBeenCalledWith(206);
  expect(res.setHeader).toHaveBeenCalledWith('Content-Range', `bytes 0-1/${body.length}`);
  expect(res.setHeader).toHaveBeenCalledWith('Content-Length', 2);
  expect(res.end).toHaveBeenCalledWith(Buffer.from('ID'));
});
