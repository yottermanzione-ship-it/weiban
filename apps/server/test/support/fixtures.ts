/**
 * 测试用的配置、日志收集器、金丝雀值。
 */
import { randomBytes } from 'node:crypto';
import type { DestinationStream } from 'pino';
import { loadConfig, type AppConfig } from '../../src/platform/config/config.js';
import type { KekRing } from '../../src/platform/crypto/envelope.js';
import { createLogger, type Logger } from '../../src/platform/logging/logger.js';
import { TEST_DATABASE_URL } from './db.js';

export function testConfig(env: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL ?? 'postgres://unused@127.0.0.1:1/unused',
    LOG_LEVEL: 'debug',
    ...env,
  });
}

/** 把日志收集到内存里，便于搜索。 */
export class LogCapture implements DestinationStream {
  readonly lines: string[] = [];

  write(line: string): void {
    this.lines.push(line);
  }

  get text(): string {
    return this.lines.join('');
  }

  records(): Array<Record<string, unknown>> {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

export function captureLogger(level = 'debug'): { logger: Logger; capture: LogCapture } {
  const capture = new LogCapture();
  return { logger: createLogger({ level, destination: capture }), capture };
}

/** 金丝雀密钥：形如 sk-weiban-canary-<随机串>（engineering-standards.md 第 7 节）。 */
export function canaryKey(): string {
  return `sk-weiban-canary-${randomBytes(12).toString('hex')}`;
}

export function testKekRing(): { ring: KekRing; kek: Buffer } {
  const kek = randomBytes(32);
  return { ring: { currentVersion: 1, keys: new Map([[1, kek]]) }, kek };
}
