import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, ConfigError } from '../config/config.js';
import { loadKekRing } from './kek-ring.js';
describe('密钥文件集合配置', () => {
  it('轮换集合覆盖旧单文件配置，生产允许集合文件，新旧版本均可读取', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-ring-'));
    try {
      writeFileSync(join(dir, 'one'), Buffer.alloc(32, 1).toString('base64'));
      writeFileSync(join(dir, 'two'), Buffer.alloc(32, 2).toString('hex'));
      writeFileSync(
        join(dir, 'ring'),
        JSON.stringify({ currentVersion: 2, files: { 1: join(dir, 'one'), 2: join(dir, 'two') } }),
      );
      const config = loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://example/db',
        BILLING_PLATFORM_DAILY_CAP_MICROS: '1000000',
        PLATFORM_KEK_RING_FILE: join(dir, 'ring'),
        PLATFORM_KEK_FILE: '/not-used',
      });
      const ring = loadKekRing(config)!;
      expect(ring.currentVersion).toBe(2);
      expect(ring.keys.get(1)?.equals(Buffer.alloc(32, 1))).toBe(true);
      expect(ring.keys.get(2)?.equals(Buffer.alloc(32, 2))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('未知字段、缺失当前版本、重复密钥与倒退版本文件均拒绝，不回显文件内容', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-ring-'));
    try {
      writeFileSync(join(dir, 'key'), Buffer.alloc(32, 3).toString('base64'));
      const config = loadConfig({
        DATABASE_URL: 'postgres://example/db',
        PLATFORM_KEK_RING_FILE: join(dir, 'ring'),
      });
      for (const value of [
        { currentVersion: 2, files: { 1: join(dir, 'key') } },
        { currentVersion: 2, files: { 1: join(dir, 'key'), 2: join(dir, 'key') } },
        { currentVersion: 1, files: { 2: join(dir, 'key') } },
        { currentVersion: 2, files: {}, canarySecret: 'never-print-this-secret' },
      ]) {
        writeFileSync(join(dir, 'ring'), JSON.stringify(value));
        expect(() => loadKekRing(config)).toThrow(ConfigError);
        try {
          loadKekRing(config);
        } catch (error) {
          expect((error as Error).message).not.toContain('never-print-this-secret');
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
