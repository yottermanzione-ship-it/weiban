/**
 * health 数据读写：整行用用户 DEK 加密（AES-256-GCM，AAD = `health:{entryId}:{userId}`，
 * docs/architecture/health-data.md 第 3 节）。日期也在密文里，计算一律「全部取出 → 解密 → 内存里算」。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { DayLog } from '@weiban/contracts';
import {
  CLOCK,
  ENVELOPE_CRYPTO,
  newId,
  type Clock,
  type DbTx,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { periodEntries } from '../infra/db/schema.js';

export interface CyclePayload {
  startDate: string;
  endDate: string | null;
}

export interface DayLogPayload extends DayLog {
  cycleId: string;
}

export interface LoadedDayLog extends DayLogPayload {
  entryId: string;
}

export interface LoadedCycle extends CyclePayload {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  dayLogs: LoadedDayLog[];
}

function aad(entryId: string, userId: string): string {
  return `health:${entryId}:${userId}`;
}

@Injectable()
export class HealthStore {
  constructor(
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async open<T>(userId: string, entryId: string, sealed: Buffer, tx: DbTx): Promise<T> {
    const buf = await this.crypto.open(userId, aad(entryId, userId), sealed, tx);
    try {
      return JSON.parse(buf.toString('utf8')) as T;
    } finally {
      buf.fill(0);
    }
  }

  private seal(userId: string, entryId: string, data: unknown, tx: DbTx): Promise<Buffer> {
    return this.crypto.seal(userId, aad(entryId, userId), JSON.stringify(data), tx);
  }

  /** 取出并解密该用户的全部经期与日记，按开始日倒序。 */
  async loadAll(tx: DbTx, userId: string): Promise<LoadedCycle[]> {
    const rows = await tx.db.select().from(periodEntries).where(eq(periodEntries.userId, userId));
    const cycles = new Map<string, LoadedCycle>();
    const logs: LoadedDayLog[] = [];
    for (const row of rows) {
      if (row.kind === 'cycle') {
        const data = await this.open<CyclePayload>(userId, row.id, row.payload, tx);
        cycles.set(row.id, {
          id: row.id,
          startDate: data.startDate,
          endDate: data.endDate,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          dayLogs: [],
        });
      } else {
        const data = await this.open<DayLogPayload>(userId, row.id, row.payload, tx);
        logs.push({ ...data, entryId: row.id });
      }
    }
    for (const log of logs) cycles.get(log.cycleId)?.dayLogs.push(log);
    const list = [...cycles.values()];
    for (const c of list) c.dayLogs.sort((a, b) => a.date.localeCompare(b.date));
    return list.sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id.localeCompare(a.id));
  }

  async insertCycle(tx: DbTx, userId: string, data: CyclePayload): Promise<string> {
    const id = newId();
    const at = this.clock.now();
    await tx.db.insert(periodEntries).values({
      id,
      userId,
      kind: 'cycle',
      payload: await this.seal(userId, id, data, tx),
      createdAt: at,
      updatedAt: at,
    });
    return id;
  }

  async updateCycle(tx: DbTx, userId: string, id: string, data: CyclePayload): Promise<void> {
    await tx.db
      .update(periodEntries)
      .set({ payload: await this.seal(userId, id, data, tx), updatedAt: this.clock.now() })
      .where(and(eq(periodEntries.id, id), eq(periodEntries.userId, userId)));
  }

  /** 只刷新经期行的更新时间（改了它名下的日记时用）。 */
  async touch(tx: DbTx, userId: string, id: string): Promise<void> {
    await tx.db
      .update(periodEntries)
      .set({ updatedAt: this.clock.now() })
      .where(and(eq(periodEntries.id, id), eq(periodEntries.userId, userId)));
  }

  async upsertDayLog(
    tx: DbTx,
    userId: string,
    existingId: string | null,
    data: DayLogPayload,
  ): Promise<void> {
    const at = this.clock.now();
    if (existingId) {
      await tx.db
        .update(periodEntries)
        .set({ payload: await this.seal(userId, existingId, data, tx), updatedAt: at })
        .where(and(eq(periodEntries.id, existingId), eq(periodEntries.userId, userId)));
      return;
    }
    const id = newId();
    await tx.db.insert(periodEntries).values({
      id,
      userId,
      kind: 'day_log',
      payload: await this.seal(userId, id, data, tx),
      createdAt: at,
      updatedAt: at,
    });
  }

  async deleteEntries(tx: DbTx, userId: string, ids: string[]): Promise<void> {
    for (const id of ids)
      await tx.db
        .delete(periodEntries)
        .where(and(eq(periodEntries.id, id), eq(periodEntries.userId, userId)));
  }
}
