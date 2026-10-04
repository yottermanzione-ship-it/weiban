/**
 * 健康检查：GET /health（不需要登录）。给 Docker 健康检查、Caddy、运维监控用，不属于客户端接口契约。
 *
 * 数据库能连通 → 200 {"status":"ok", ...}；连不上 → 503 {"status":"degraded", ...}。
 * 只报告「是否正常」，不返回错误详情、连接串等内部信息（详情写在服务器日志里）。
 */
import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import { CONTRACT_VERSION } from '@weiban/contracts';
import type { Response } from 'express';
import { RequireAuth } from '../auth/auth.js';
import { CLOCK, type Clock } from '../clock/clock.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { ENVELOPE_CRYPTO, type EnvelopeCrypto } from '../crypto/envelope.js';
import { DATABASE, type Database } from '../db/database.js';
import { LOGGER, type Logger } from '../logging/logger.js';

export interface HealthReport {
  status: 'ok' | 'degraded';
  role: AppConfig['role'];
  contractVersion: string;
  time: string;
  checks: {
    database: { ok: boolean; latencyMs: number };
    crypto: { configured: boolean };
  };
}

@Controller()
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @Get('health')
  @RequireAuth('none')
  @HttpCode(200)
  async health(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const started = this.clock.nowMs();
    const ping = await this.database.ping();
    const latencyMs = this.clock.nowMs() - started;
    if (!ping.ok) {
      this.logger.warn({ error: ping.error }, '健康检查：数据库连接失败');
      res.status(503);
    }
    return {
      status: ping.ok ? 'ok' : 'degraded',
      role: this.config.role,
      contractVersion: CONTRACT_VERSION,
      time: this.clock.now().toISOString(),
      checks: {
        database: { ok: ping.ok, latencyMs },
        crypto: { configured: this.crypto.isAvailable() },
      },
    };
  }
}
