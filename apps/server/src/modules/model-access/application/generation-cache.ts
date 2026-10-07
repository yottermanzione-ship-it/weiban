/** 持久幂等占位先于冻结；结果先于结算保存，进程重启可重放结算而不再次调用上游。 */
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type {
  GenerateTextInput,
  GenerateTextOutput,
  GenerateError,
  PortResult,
} from '@weiban/contracts';
import {
  DATABASE,
  CLOCK,
  ENVELOPE_CRYPTO,
  newId,
  type Database,
  type Clock,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { generationResults } from '../infra/db/schema.js';
export type GenerationRow = typeof generationResults.$inferSelect;
export type CachedResult = PortResult<GenerateTextOutput, GenerateError>;
export function requestHash(input: GenerateTextInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
@Injectable()
export class GenerationCache {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
  ) {}
  async claim(input: GenerateTextInput): Promise<{ row: GenerationRow; created: boolean }> {
    const keyHash = createHash('sha256')
      .update(`${input.userId}\0${input.idempotencyKey}`)
      .digest('hex');
    const [inserted] = await this.database.db
      .insert(generationResults)
      .values({
        id: newId(),
        userId: input.userId,
        keyHash,
        requestHash: requestHash(input),
        phase: 'pending',
        createdAt: this.clock.now(),
        expiresAt: new Date(this.clock.nowMs() + 86_400_000),
      })
      .onConflictDoNothing({ target: generationResults.keyHash })
      .returning();
    if (inserted) return { row: inserted, created: true };
    const [row] = await this.database.db
      .select()
      .from(generationResults)
      .where(eq(generationResults.keyHash, keyHash));
    if (!row) throw new Error('网关幂等占位冲突后记录不存在');
    return { row, created: false };
  }
  async get(id: string): Promise<GenerationRow | null> {
    const [row] = await this.database.db
      .select()
      .from(generationResults)
      .where(eq(generationResults.id, id));
    return row ?? null;
  }
  async attach(
    id: string,
    usageRecordId: string,
    holdId: string,
    upstreamId: string,
  ): Promise<void> {
    await this.database.db
      .update(generationResults)
      .set({ usageRecordId, holdId, upstreamId })
      .where(eq(generationResults.id, id));
  }
  async save(
    row: GenerationRow,
    result: CachedResult,
    phase: 'result' | 'complete',
  ): Promise<void> {
    const ciphertext = await this.crypto.seal(
      row.userId,
      `generation:${row.id}`,
      JSON.stringify(result),
    );
    await this.database.db
      .update(generationResults)
      .set({ ciphertext, phase })
      .where(eq(generationResults.id, row.id));
  }
  async open(row: GenerationRow): Promise<CachedResult> {
    if (!row.ciphertext) throw new Error('网关结果尚未写入');
    const buffer = await this.crypto.open(row.userId, `generation:${row.id}`, row.ciphertext);
    try {
      return JSON.parse(buffer.toString('utf8')) as CachedResult;
    } finally {
      buffer.fill(0);
    }
  }
}
