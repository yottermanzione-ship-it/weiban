import { describe, expect, it, vi } from 'vitest';
import { MediaService } from './media.js';

const input = {
  id: '00000000-0000-4000-8000-000000000001',
  adminId: '00000000-0000-4000-8000-000000000002',
  ownerUserId: '00000000-0000-4000-8000-000000000003',
  purpose: 'chat_image' as const,
  bytes: new Uint8Array(),
  mimeType: 'image/png',
};
function service(row: object | null) {
  const result = Object.create(MediaService.prototype) as MediaService;
  const where = vi.fn().mockResolvedValue(row ? [row] : []);
  Object.assign(result, { database: { db: { select: () => ({ from: () => ({ where }) }) } } });
  return result;
}
describe('maintenance-only legacy media identity', () => {
  it('reuses a ready object only for the exact same owner and purpose', async () => {
    expect(
      await service({
        id: input.id,
        state: 'ready',
        ownerId: input.ownerUserId,
        purpose: input.purpose,
      }).importLegacyObject(input),
    ).toEqual({ mediaId: input.id, created: false });
  });
  it('preserves verified legacy MP4 bytes and stores a decoded poster without enabling normal video uploads', async () => {
    const media = service(null);
    const bytes = Buffer.from('000000186674797069736f6d000000000069736f6d6d703431', 'hex');
    let saved: Buffer | undefined;
    const store = vi.fn(async (value: { processed: { body: Buffer; mimeType: string } }) => {
      saved = Buffer.from(value.processed.body);
      expect(value.processed.mimeType).toBe('video/mp4');
      return { id: input.id };
    });
    Object.assign(media, {
      store,
      processImage: async () => ({ body: Buffer.from([1, 2]), thumb: null }),
    });
    await media.importLegacyObject({
      ...input,
      bytes,
      mimeType: 'video/mp4',
      legacyVideo: {
        width: 720,
        height: 1294,
        durationMs: 64506,
        posterPng: new Uint8Array([1, 2]),
      },
    });
    expect(saved).toEqual(bytes);
    expect(store).toHaveBeenCalledOnce();
  });
  it('returns the video poster thumbnail instead of sending MP4 bytes to an image element', async () => {
    const media = service(null);
    Object.assign(media, {
      clock: { nowMs: () => 0 },
      linkFor: async (_row: unknown, _owner: string, variant: string) =>
        `https://media.example/${variant}`,
    });
    const row = {
      id: input.id,
      mimeType: 'video/mp4',
      purpose: 'chat_image',
      sizeBytes: 100,
      width: 720,
      height: 1294,
      durationMs: 64506,
      thumbStorageKey: 'poster',
      createdAt: new Date(0),
    } as Parameters<MediaService['toMedia']>[0];
    const result = await media.toMedia(row, input.ownerUserId);
    expect(result.thumbnailUrl).toBe('https://media.example/t');
    expect(result.url).toBe('https://media.example/o');
  });
  it('rejects the special video path for non-chat purposes or invalid duration', async () => {
    await expect(
      service(null).importLegacyObject({
        ...input,
        purpose: 'user_avatar',
        mimeType: 'video/mp4',
        bytes: new Uint8Array(20),
        legacyVideo: { width: 10, height: 10, durationMs: 0, posterPng: new Uint8Array() },
      }),
    ).rejects.toThrow('旧视频格式或尺寸不符合要求');
  });
  it.each([
    { ownerId: input.adminId, purpose: input.purpose, state: 'ready' },
    { ownerId: input.ownerUserId, purpose: 'user_avatar', state: 'ready' },
    { ownerId: input.ownerUserId, purpose: input.purpose, state: 'pending' },
  ])('refuses another owner/purpose or an interrupted object', async (row) => {
    await expect(service(row).importLegacyObject(input)).rejects.toThrow(
      '旧媒体导入ID与现有记录不符',
    );
  });
});
