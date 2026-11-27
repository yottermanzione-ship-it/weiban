import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.js';
import type { Clock } from '../clock/clock.js';

const SLOT_LEASE_MS = 15_000;

/** Four shared slots across all processes and reply queues. Keep connections free during model calls. */
export async function withReplySlot(
  db: Database,
  clock: Clock,
  userId: string,
  key: string,
  run: () => Promise<void>,
  postpone: (when: Date) => Promise<unknown>,
) {
  const lease = randomUUID();
  const now = clock.nowMs();
  const acquired = await db.transaction(async (tx) => {
    const { rows } = await tx.query<{
      slot: number;
      user_id: string | null;
      expires_at: Date | null;
      started_at: Date | null;
    }>(
      'SELECT slot,user_id,expires_at,started_at FROM platform.reply_worker_slots ORDER BY slot FOR UPDATE',
    );
    const active = rows.filter((row) => (row.expires_at?.getTime() ?? 0) > now);
    const free = rows.find((row) => !active.includes(row));
    const last = Math.max(0, ...rows.map((row) => row.started_at?.getTime() ?? 0));
    if (!free || active.filter((row) => row.user_id === userId).length >= 2 || now - last < 125)
      return false;
    await tx.query(
      'UPDATE platform.reply_worker_slots SET user_id=$1,lease_id=$2,expires_at=$3,started_at=$4 WHERE slot=$5',
      [userId, lease, new Date(now + SLOT_LEASE_MS), new Date(now), free.slot],
    );
    return true;
  });
  if (!acquired) {
    const spread = parseInt(key.replaceAll('-', '').slice(-4), 16) % 300;
    await postpone(new Date(now + 250 + spread));
    return;
  }
  let renewal: Promise<unknown> | undefined;
  const timer = setInterval(() => {
    if (renewal) return;
    renewal = db
      .query('UPDATE platform.reply_worker_slots SET expires_at=$1 WHERE lease_id=$2', [
        new Date(clock.nowMs() + SLOT_LEASE_MS),
        lease,
      ])
      .catch(() => undefined)
      .finally(() => {
        renewal = undefined;
      });
  }, SLOT_LEASE_MS / 3);
  timer.unref();
  try {
    await run();
  } finally {
    clearInterval(timer);
    await renewal;
    await db.query(
      'UPDATE platform.reply_worker_slots SET user_id=NULL,lease_id=NULL,expires_at=NULL WHERE lease_id=$1',
      [lease],
    );
  }
}
