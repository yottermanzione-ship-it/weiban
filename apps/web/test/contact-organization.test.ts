import { expect, it, vi } from 'vitest';
import { ApiFailure } from '@weiban/client-core';
import type {
  ContactOrganizationSnapshot,
  SaveContactOrganizationRequest,
} from '@weiban/contracts';
import {
  ContactOrganizationController,
  applyOrganizationOperation,
  legacyStarCandidates,
} from '../src/data/contact-organization.js';
const A = '11111111-1111-4111-8111-111111111111',
  B = '22222222-2222-4222-8222-222222222222',
  T = '33333333-3333-4333-8333-333333333333';
const empty = (): ContactOrganizationSnapshot => ({
  revision: 0,
  starredCharacterIds: [],
  tags: [],
  updatedAt: null,
});
function fixture() {
  let cloud = empty(),
    owner = 'owner:session',
    count = 0;
  const calls: SaveContactOrganizationRequest[] = [];
  const get = vi.fn(async () => structuredClone(cloud));
  const save = vi.fn(async (body: SaveContactOrganizationRequest) => {
    calls.push(structuredClone(body));
    cloud = {
      revision: cloud.revision + 1,
      starredCharacterIds: body.starredCharacterIds,
      tags: body.tags,
      updatedAt: '2026-11-09T00:00:00Z',
    };
    return { snapshot: structuredClone(cloud), replayed: false };
  });
  const controller = new ContactOrganizationController(
    owner,
    () => owner,
    { get, save },
    () => `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`,
  );
  return {
    controller,
    get,
    save,
    calls,
    cloud: () => cloud,
    setCloud: (next: ContactOrganizationSnapshot) => (cloud = next),
    switchOwner: () => (owner = 'different:session'),
  };
}
it('initial revision zero is read without a write, and a star operation preserves latest tags and their order', async () => {
  const f = fixture();
  await f.controller.refresh();
  expect(f.save).not.toHaveBeenCalled();
  f.setCloud({
    ...empty(),
    revision: 1,
    tags: [{ tagId: T, name: '新设备标签', characterIds: [B] }],
  });
  expect(await f.controller.change({ type: 'set-star', characterId: A, selected: true })).toBe(
    true,
  );
  expect(f.calls[0]?.expectedRevision).toBe(1);
  expect(f.calls[0]?.tags).toEqual([{ tagId: T, name: '新设备标签', characterIds: [B] }]);
});
it('editing an older snapshot keeps the operation, refreshes and requires confirmation before saving', async () => {
  const f = fixture();
  await f.controller.refresh();
  f.setCloud({ ...empty(), revision: 2, tags: [{ tagId: T, name: '别处新增', characterIds: [] }] });
  expect(await f.controller.change({ type: 'replace-stars', characterIds: [A] }, 0)).toBe(false);
  expect(f.save).not.toHaveBeenCalled();
  expect(f.controller.snapshot().problem).toBe('conflict');
  expect(f.controller.snapshot().pendingOperation).not.toBeNull();
  expect(await f.controller.retry()).toBe(true);
  expect(f.calls[0]?.expectedRevision).toBe(2);
  expect(f.calls[0]?.tags).toHaveLength(1);
});
it('a lost acknowledgement retries identical full body and command even if replay returns a later cloud snapshot', async () => {
  const f = fixture();
  await f.controller.refresh();
  const bodies: SaveContactOrganizationRequest[] = [];
  f.save.mockImplementation(async (body) => {
    bodies.push(structuredClone(body));
    if (bodies.length === 1) throw new Error('lost acknowledgement');
    return { snapshot: { ...empty(), revision: 9, starredCharacterIds: [B] }, replayed: true };
  });
  expect(await f.controller.change({ type: 'set-star', characterId: A, selected: true })).toBe(
    false,
  );
  expect(await f.controller.retry()).toBe(true);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(f.controller.snapshot().snapshot?.starredCharacterIds).toEqual([B]);
});
it('server 409 retains edits but discards old command, and never automatically merges stars', async () => {
  const f = fixture();
  await f.controller.refresh();
  f.save.mockRejectedValueOnce(new ApiFailure('conflict', 'private', 409));
  expect(await f.controller.change({ type: 'replace-stars', characterIds: [A] })).toBe(false);
  expect(f.controller.snapshot().problem).toBe('conflict');
  expect(f.save).toHaveBeenCalledTimes(1);
  f.setCloud({ ...empty(), revision: 1, starredCharacterIds: [B] });
  await f.controller.refresh();
  await f.controller.retry();
  expect(f.calls.at(-1)?.starredCharacterIds).toEqual([A]);
});
it('owner switch/dispose refuses late data and destroys uncertain commands', async () => {
  const f = fixture();
  let release!: () => void;
  f.get.mockImplementation(async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return { ...empty(), starredCharacterIds: [A] };
  });
  const read = f.controller.refresh();
  f.switchOwner();
  f.controller.dispose();
  release();
  await read;
  expect(f.controller.snapshot().snapshot).toBeNull();
  expect(await f.controller.change({ type: 'set-star', characterId: A, selected: true })).toBe(
    false,
  );
  expect(f.save).not.toHaveBeenCalled();
});
it('StrictMode disposal followed by activation starts a fresh read and rejects the old result', async () => {
  const f = fixture();
  let release!: () => void;
  f.get.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return { ...empty(), revision: 4, starredCharacterIds: [A] };
  });
  const old = f.controller.refresh();
  f.controller.dispose();
  f.controller.activate();
  await f.controller.refresh();
  release();
  await old;
  expect(f.controller.snapshot().snapshot?.starredCharacterIds).toEqual([]);
  expect(f.controller.snapshot().error).toBe('');
});
it('a deleted tag cannot be implicitly resurrected, and unrelated tags survive rename/member edits', () => {
  expect(() =>
    applyOrganizationOperation(empty(), {
      type: 'update-tag',
      tag: { tagId: T, name: '旧标签', characterIds: [A] },
    }),
  ).toThrow();
  const source = {
    ...empty(),
    tags: [
      { tagId: A, name: '第一组', characterIds: [A] },
      { tagId: T, name: '第二组', characterIds: [B] },
    ],
  };
  const next = applyOrganizationOperation(source, {
    type: 'update-tag',
    tag: { tagId: A, name: '改名', characterIds: [B] },
  });
  expect(next.tags[1]).toEqual(source.tags[1]);
  expect(next.tags[0]?.name).toBe('改名');
  expect(source.tags[0]?.name).toBe('第一组');
});
it('unowned local stars remain unchanged and only active exact IDs are eligible after user confirmation', () => {
  const raw = JSON.stringify([A, B, 'not-a-contact', A]);
  expect(legacyStarCandidates(raw, [B])).toEqual({
    present: true,
    characterIds: [B],
    unavailable: 2,
  });
  expect(raw).toBe(JSON.stringify([A, B, 'not-a-contact', A]));
  expect(legacyStarCandidates(null, [A]).present).toBe(false);
});
