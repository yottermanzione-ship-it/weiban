import { describe, expect, it, vi } from 'vitest';
import type { MediaObject, MediaSystemPort } from '@weiban/contracts';
import {
  MOMENT_IMAGE_RATIO,
  MomentSceneryService,
  sceneryUrl,
  wantsSceneryImage,
  type SceneryFetcher,
} from './moment-scenery.js';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function setup(fetcher?: SceneryFetcher) {
  const putObject = vi.fn(async () => ({ mediaId: 'scenic-media' }) as unknown as MediaObject);
  const call = vi.fn(fetcher ?? (async () => ({ bytes: JPEG, mimeType: 'image/jpeg' })));
  const service = new MomentSceneryService(
    { putObject } as unknown as MediaSystemPort,
    call as SceneryFetcher,
  );
  return { service, putObject, call };
}

describe('moment scenery rules', () => {
  it('decides by content hash, so the same text always gets the same answer', () => {
    const seeds = Array.from({ length: 200 }, (_, i) => `character-1:moment-${i}`);
    const picked = seeds.filter((seed) => wantsSceneryImage(seed));
    expect(picked.every((seed) => wantsSceneryImage(seed))).toBe(true);
    // 约 22%，允许抽样误差；不能变成全部带图或全部不带。
    expect(picked.length).toBeGreaterThan(25);
    expect(picked.length).toBeLessThan(70);
  });

  it('never exceeds the 30% ceiling even if asked for more', () => {
    const seeds = Array.from({ length: 300 }, (_, i) => `s-${i}`);
    const many = seeds.filter((seed) => wantsSceneryImage(seed, 0.9));
    expect(many.length / seeds.length).toBeLessThan(0.31);
  });

  it('builds a stable picsum url per seed', () => {
    expect(sceneryUrl('abc')).toBe(sceneryUrl('abc'));
    expect(sceneryUrl('abc')).toMatch(/^https:\/\/picsum\.photos\/seed\/[a-z0-9]+\/1080\/1080$/);
    expect(sceneryUrl('abc')).not.toBe(sceneryUrl('abd'));
  });

  it('stores the downloaded photo as the user chat image', async () => {
    const { service, putObject, call } = setup(async () => ({
      bytes: JPEG,
      mimeType: 'image/jpeg',
    }));
    const seed = Array.from({ length: 50 }, (_, i) => `x-${i}`).find((s) => wantsSceneryImage(s))!;
    const result = await service.pick({ userId: 'user-1', seed });
    expect(result?.mediaId).toBe('scenic-media');
    expect(putObject).toHaveBeenCalledWith({
      ownerUserId: 'user-1',
      purpose: 'chat_image',
      bytes: JPEG,
      mimeType: 'image/jpeg',
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(String(call.mock.calls[0]![0])).toContain('picsum.photos');
  });

  it('skips the download entirely when this moment should not carry a photo', async () => {
    const { service, call, putObject } = setup();
    const seed = Array.from({ length: 50 }, (_, i) => `n-${i}`).find((s) => !wantsSceneryImage(s))!;
    expect(await service.pick({ userId: 'user-1', seed })).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('drops the photo when the bytes are not the declared image type', async () => {
    const { service, putObject } = setup(async () => ({
      bytes: Uint8Array.from([1, 2, 3, 4]),
      mimeType: 'image/jpeg',
    }));
    const seed = Array.from({ length: 50 }, (_, i) => `y-${i}`).find((s) => wantsSceneryImage(s))!;
    expect(await service.pick({ userId: 'user-1', seed })).toBeNull();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('falls back to text only when the download fails', async () => {
    const { service } = setup(async () => null);
    const seed = Array.from({ length: 50 }, (_, i) => `z-${i}`).find((s) => wantsSceneryImage(s))!;
    expect(await service.pick({ userId: 'user-1', seed })).toBeNull();
  });

  it('keeps the default ratio at the old version value', () => {
    expect(MOMENT_IMAGE_RATIO).toBe(0.22);
  });
});
