import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EnvelopeCrypto } from './envelope.js';
import type { Database } from '../db/database.js';

function setup() {
  const keys = new Map<string, { wrapped_dek: Buffer; kek_version: number }>();
  const query = vi.fn(async (sql: string, args: unknown[]) => {
    if (sql.startsWith('SELECT wrapped_dek')) {
      const key = keys.get(args[0] as string);
      return { rows: key ? [key] : [], rowCount: key ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO platform.user_data_keys')) {
      keys.set(args[0] as string, {
        wrapped_dek: args[1] as Buffer,
        kek_version: args[2] as number,
      });
      return { rows: [{ owner: args[0] }], rowCount: 1 };
    }
    throw new Error('Unexpected database operation');
  });
  const crypto = new EnvelopeCrypto(
    { query } as unknown as Database,
    { now: () => new Date(), nowMs: () => Date.now() },
    {
      currentVersion: 1,
      keys: new Map([[1, randomBytes(32)]]),
    },
  );
  return { crypto, query };
}

describe('owner-bound migration encryption batches', () => {
  const owner = '00000000-0000-4000-8000-000000000001';
  it('keeps each row AAD and nonce distinct while loading one DEK per batch', async () => {
    const { crypto, query } = setup();
    const sealed = await crypto.sealMany(owner, [
      { aad: 'chat:message:a', plaintext: 'hello' },
      { aad: 'chat:message:b', plaintext: 'hello' },
    ]);
    expect(query).toHaveBeenCalledTimes(2); // load missing + insert once, not per record
    expect(sealed[0]).not.toEqual(sealed[1]);
    expect((await crypto.open(owner, 'chat:message:a', sealed[0]!)).toString()).toBe('hello');
    await expect(crypto.open(owner, 'chat:message:b', sealed[0]!)).rejects.toThrow();
    await expect(
      crypto.open('00000000-0000-4000-8000-000000000002', 'chat:message:a', sealed[0]!),
    ).rejects.toThrow();
  });
  it('does not create a DEK or access storage for an empty batch', async () => {
    const { crypto, query } = setup();
    expect(await crypto.sealMany(owner, [])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
