/**
 * 加密/解密 health 模块的 payload 的辅助函数。
 * 所有经期记录整行 AES-256-GCM 加密，AAD 绑定到具体行（health-data.md 第 3 节）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { ENVELOPE_CRYPTO, type DbTx, type EnvelopeCrypto } from '../../../platform/index.js';

export interface CyclePayload {
  startDate: string;
  endDate: string | null;
}

export interface DayLogPayload {
  date: string;
  flow: 'light' | 'medium' | 'heavy' | null;
  pain: 'none' | 'mild' | 'moderate' | 'severe' | null;
  symptoms: string[];
  notes: string | null;
}

export interface SettingsPayload {
  cycleLength: number;
  periodDays: number;
}

@Injectable()
export class HealthCrypto {
  constructor(@Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto) {}

  async sealCycle(userId: string, entryId: string, data: CyclePayload, tx: DbTx): Promise<Buffer> {
    return this.crypto.seal(userId, `health:${entryId}:${userId}`, JSON.stringify(data), tx);
  }

  async openCycle(
    userId: string,
    entryId: string,
    ciphertext: Buffer,
    tx: DbTx,
  ): Promise<CyclePayload> {
    const buf = await this.crypto.open(userId, `health:${entryId}:${userId}`, ciphertext, tx);
    try {
      return JSON.parse(buf.toString('utf8')) as CyclePayload;
    } finally {
      buf.fill(0);
    }
  }

  async sealDayLog(
    userId: string,
    entryId: string,
    data: DayLogPayload,
    tx: DbTx,
  ): Promise<Buffer> {
    return this.crypto.seal(userId, `health:${entryId}:${userId}`, JSON.stringify(data), tx);
  }

  async openDayLog(
    userId: string,
    entryId: string,
    ciphertext: Buffer,
    tx: DbTx,
  ): Promise<DayLogPayload> {
    const buf = await this.crypto.open(userId, `health:${entryId}:${userId}`, ciphertext, tx);
    try {
      return JSON.parse(buf.toString('utf8')) as DayLogPayload;
    } finally {
      buf.fill(0);
    }
  }

  async sealSettings(userId: string, data: SettingsPayload, tx: DbTx): Promise<Buffer> {
    return this.crypto.seal(
      userId,
      `health:settings:${userId}`,
      JSON.stringify(data),
      tx,
    );
  }
}
