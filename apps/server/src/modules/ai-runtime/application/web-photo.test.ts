import { describe, expect, it, vi } from 'vitest';
import type { MediaObject, MediaSystemPort } from '@weiban/contracts';
import { WebPhotoService, type PublicPhotoSource } from './web-photo.js';
import {
  buildPhotoQuery,
  normalizeCandidate,
  pickPhoto,
  type PhotoCandidate,
} from '../domain/web-photo.js';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const candidate = (over: Partial<PhotoCandidate> = {}): PhotoCandidate => ({
  title: 'Autumn leaves in the park',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Leaves.jpg',
  imageUrl: 'https://upload.wikimedia.org/leaves-640.jpg',
  mime: 'image/jpeg',
  width: 1280,
  height: 853,
  bytes: 180_000,
  author: 'Jane Doe',
  licence: 'CC BY-SA 4.0',
  takenAt: '2021-10-02',
  ...over,
});

function service(options: { enabled?: boolean; source?: Partial<PublicPhotoSource> } = {}) {
  const source: PublicPhotoSource = {
    search: vi.fn(async () => [candidate()]),
    download: vi.fn(async () => ({ bytes: JPEG, mimeType: 'image/jpeg' })),
    ...options.source,
  };
  const putObject = vi.fn(async () => ({ mediaId: 'media-1' }) as unknown as MediaObject);
  const instance = new WebPhotoService(
    { characterPublicPictureSearchEnabled: options.enabled ?? true } as never,
    source,
    { putObject } as unknown as MediaSystemPort,
  );
  return { instance, source, putObject };
}

describe('web photo domain rules', () => {
  it('quotes a short scene and refuses empty or one-character input', () => {
    expect(buildPhotoQuery('  秋天的\n落叶 "很好"  ')).toBe('秋天的 落叶 很好');
    expect(buildPhotoQuery('a')).toBeNull();
    expect(buildPhotoQuery('""')).toBeNull();
  });

  it('drops candidates without author, licence, page or a usable image', () => {
    expect(normalizeCandidate({ ...candidate(), author: null })).toBeNull();
    expect(normalizeCandidate({ ...candidate(), licence: '<span></span>' })).toBeNull();
    expect(normalizeCandidate({ ...candidate(), pageUrl: 'http://example.com/x' })).toBeNull();
    expect(normalizeCandidate({ ...candidate(), mime: 'image/svg+xml' })).toBeNull();
    expect(normalizeCandidate({ ...candidate(), width: 200 })).toBeNull();
    expect(normalizeCandidate({ ...candidate(), bytes: 9 * 1024 * 1024 })).toBeNull();
  });

  it('strips html from the author and keeps the licence text', () => {
    const normalized = normalizeCandidate({
      ...candidate(),
      author: '<a href="//x" title="User">Basile&nbsp;Morin</a>',
    });
    expect(normalized?.author).toBe('Basile Morin');
    expect(normalized?.licence).toBe('CC BY-SA 4.0');
  });

  it('prefers a sharp-enough image and keeps a readable credit line', () => {
    const picked = pickPhoto([
      candidate({ width: 640, height: 480, bytes: 50_000 }),
      candidate({ width: 2000, height: 1400, bytes: 900_000 }),
    ]);
    expect(picked?.width).toBe(2000);
    expect(picked?.credit).toBe('来源：维基共享资源 · Jane Doe · CC BY-SA 4.0');
  });
});

describe('web photo service', () => {
  it('stores the verified photo as the requesting user chat image', async () => {
    const { instance, putObject, source } = service();
    const result = await instance.fetch({ userId: 'user-1', scene: '秋天的落叶' });
    expect(result?.credit).toContain('CC BY-SA 4.0');
    expect(result?.pageUrl).toContain('commons.wikimedia.org');
    expect(source.search).toHaveBeenCalledWith('秋天的落叶');
    expect(putObject).toHaveBeenCalledWith({
      ownerUserId: 'user-1',
      purpose: 'chat_image',
      bytes: JPEG,
      mimeType: 'image/jpeg',
    });
  });

  it('does nothing while the feature flag is off', async () => {
    const { instance, source, putObject } = service({ enabled: false });
    expect(await instance.fetch({ userId: 'user-1', scene: '秋天的落叶' })).toBeNull();
    expect(source.search).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('sends nothing when every candidate lacks provenance', async () => {
    const { instance, putObject } = service({
      source: { search: vi.fn(async () => [candidate({ author: null })]) },
    });
    expect(await instance.fetch({ userId: 'user-1', scene: '秋天的落叶' })).toBeNull();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rejects bytes that are not the declared image type', async () => {
    const { instance, putObject } = service({
      source: {
        download: vi.fn(async () => ({
          bytes: Uint8Array.from([1, 2, 3, 4]),
          mimeType: 'image/jpeg',
        })),
      },
    });
    expect(await instance.fetch({ userId: 'user-1', scene: '秋天的落叶' })).toBeNull();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('does not import an image that grew well past the declared size', async () => {
    const { instance, putObject } = service({
      source: {
        download: vi.fn(async () => ({
          bytes: new Uint8Array(400_000).fill(0xff),
          mimeType: 'image/jpeg',
        })),
      },
    });
    expect(await instance.fetch({ userId: 'user-1', scene: '秋天的落叶' })).toBeNull();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('survives a failing source without throwing', async () => {
    const { instance } = service({
      source: {
        search: vi.fn(async () => {
          throw new Error('network');
        }),
      },
    });
    expect(await instance.fetch({ userId: 'user-1', scene: '秋天的落叶' })).toBeNull();
  });
});
