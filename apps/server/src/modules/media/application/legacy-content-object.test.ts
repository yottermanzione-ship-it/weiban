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
function service(row: object) {
  const result = Object.create(MediaService.prototype) as MediaService;
  const where = vi.fn().mockResolvedValue([row]);
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
