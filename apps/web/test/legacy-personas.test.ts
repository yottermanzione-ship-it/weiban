import { expect, it, vi } from 'vitest';
import { ApiFailure } from '@weiban/client-core';
import {
  LegacyPersonaSession,
  legacyPersonaConflict,
  legacyPersonaError,
  legacyPersonaBlockedNotice,
} from '../src/data/legacy-personas.js';

const owner = 'synthetic-owner:synthetic-session';
const character = '11111111-1111-4111-8111-111111111111';
it('ambiguous reset failures retry the same command and version without persisting private content', async () => {
  const uuid = vi.fn(() => '22222222-2222-4222-8222-222222222222');
  const session = new LegacyPersonaSession(owner, () => owner, uuid);
  const calls: unknown[] = [];
  const work = vi.fn(async (body) => {
    calls.push(body);
    if (calls.length === 1) throw new Error('lost response');
    return { state: 'reset' };
  });
  await expect(session.reset(character, 3, work)).rejects.toThrow('lost response');
  expect(session.resetPending).toBe(true);
  await expect(session.reset(character, 99, work)).resolves.toEqual({ state: 'reset' });
  expect(calls[1]).toEqual(calls[0]);
  expect(uuid).toHaveBeenCalledTimes(1);
  expect(session.resetPending).toBe(false);
});
it('409 ends the old command; only a new confirmation creates a command for the reread version', async () => {
  let index = 0;
  const session = new LegacyPersonaSession(
    owner,
    () => owner,
    () => `command-${++index}`,
  );
  const conflict = new ApiFailure('conflict', 'private server detail', 409);
  await expect(
    session.reset(character, 3, async () => {
      throw conflict;
    }),
  ).rejects.toBe(conflict);
  expect(session.resetPending).toBe(false);
  const send = vi.fn(async (body) => body);
  const next = await session.reset(character, 4, send);
  expect(next).toEqual({ clientCommandId: 'command-2', expectedVersion: 4 });
});
it('owner changes reject both new requests and already-resolved late private responses', async () => {
  let current = owner;
  const session = new LegacyPersonaSession(owner, () => current);
  const read = session.request(async () => {
    current = 'another:session';
    return { private: 'old-owner-text' };
  });
  await expect(read).rejects.toMatchObject({ code: 'session_changed' });
  const work = vi.fn();
  await expect(session.request(work)).rejects.toMatchObject({ code: 'session_changed' });
  expect(work).not.toHaveBeenCalled();
});
it('dispose aborts in-flight work and deletes the pending reset command', async () => {
  const session = new LegacyPersonaSession(owner, () => owner);
  let complete!: () => void, signal!: AbortSignal;
  const request = session.reset(character, 1, async (_body, current) => {
    signal = current;
    await new Promise<void>((resolve) => (complete = resolve));
    return 'private';
  });
  expect(session.resetPending).toBe(true);
  session.dispose();
  expect(signal.aborted).toBe(true);
  expect(session.resetPending).toBe(false);
  complete();
  await expect(request).rejects.toMatchObject({ code: 'session_changed' });
});
it('403/404/old-server failures never claim a record was lost or expose server detail', () => {
  for (const status of [403, 404, 503]) {
    const failure = new ApiFailure('unknown', 'secret-path-should-not-display', status);
    expect(legacyPersonaError(failure, 'read')).not.toMatch(/丢失|删除|secret-path/);
    expect(legacyPersonaError(failure, 'reset')).not.toContain('secret-path');
  }
  expect(legacyPersonaConflict(new ApiFailure('conflict', '', 409))).toBe(true);
  expect(legacyPersonaBlockedNotice('target_personal_changes')).toContain('保留这些修改');
  expect(legacyPersonaBlockedNotice('unsupported_structure')).not.toContain(
    'unsupported_structure',
  );
});
