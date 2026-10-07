import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, readKekFile } from './config.js';

const DB = 'postgres://u:p@127.0.0.1:5432/db';

describe('配置加载 loadConfig', () => {
  it('只给 DATABASE_URL 时其余取默认值', () => {
    const config = loadConfig({ DATABASE_URL: DB });
    expect(config.role).toBe('all');
    expect(config.http).toEqual({ host: '127.0.0.1', port: 3000, trustProxy: false });
    expect(config.crypto.kekFile).toBeNull();
  });

  it('HTTP_TRUST_PROXY：层数、true、地址列表', () => {
    expect(loadConfig({ DATABASE_URL: DB, HTTP_TRUST_PROXY: '1' }).http.trustProxy).toBe(1);
    expect(loadConfig({ DATABASE_URL: DB, HTTP_TRUST_PROXY: 'true' }).http.trustProxy).toBe(true);
    expect(loadConfig({ DATABASE_URL: DB, HTTP_TRUST_PROXY: '0' }).http.trustProxy).toBe(false);
    expect(loadConfig({ DATABASE_URL: DB, HTTP_TRUST_PROXY: 'loopback' }).http.trustProxy).toBe(
      'loopback',
    );
  });

  it('不合法时列出变量名，但不回显变量的值', () => {
    try {
      loadConfig({ DATABASE_URL: 'mysql://secret-password@host', PORT: 'abc' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('PORT');
      expect(message).not.toContain('secret-password');
    }
  });

  it('生产环境必须配置主密钥文件', () => {
    expect(() => loadConfig({ DATABASE_URL: DB, NODE_ENV: 'production' })).toThrow(
      /PLATFORM_KEK_FILE/,
    );
  });

  it('计费配置：开发默认值；生产必须配置平台每日上限（T-023）', () => {
    expect(loadConfig({ DATABASE_URL: DB }).billing).toEqual({
      platformDailyCapMicros: 20_000_000,
      safetyOverdraftLimitMicros: null,
      upstreamDiffRatio: 0.03,
    });
    expect(
      loadConfig({
        DATABASE_URL: DB,
        BILLING_PLATFORM_DAILY_CAP_MICROS: '5000000',
        BILLING_SAFETY_OVERDRAFT_LIMIT_MICROS: '1000000',
      }).billing,
    ).toMatchObject({ platformDailyCapMicros: 5_000_000, safetyOverdraftLimitMicros: 1_000_000 });
    expect(() =>
      loadConfig({ DATABASE_URL: DB, NODE_ENV: 'production', PLATFORM_KEK_FILE: '/run/secrets/k' }),
    ).toThrow(/BILLING_PLATFORM_DAILY_CAP_MICROS/);
  });

  it('生产环境强制关闭 DEBUG_LLM_PAYLOAD', () => {
    const prod = loadConfig({
      DATABASE_URL: DB,
      NODE_ENV: 'production',
      PLATFORM_KEK_FILE: '/run/secrets/kek',
      BILLING_PLATFORM_DAILY_CAP_MICROS: '100000000',
      DEBUG_LLM_PAYLOAD: '1',
    });
    expect(prod.debugLlmPayload).toBe(false);
    expect(loadConfig({ DATABASE_URL: DB, DEBUG_LLM_PAYLOAD: '1' }).debugLlmPayload).toBe(true);
  });

  it('主密钥文件支持 base64 与十六进制，长度不对报错', () => {
    const dir = mkdtempSync(join(tmpdir(), 'weiban-kek-'));
    const key = Buffer.alloc(32, 7);
    writeFileSync(join(dir, 'b64'), `${key.toString('base64')}\n`);
    writeFileSync(join(dir, 'hex'), key.toString('hex'));
    writeFileSync(join(dir, 'bad'), 'c2hvcnQ=');
    expect(readKekFile(join(dir, 'b64')).equals(key)).toBe(true);
    expect(readKekFile(join(dir, 'hex')).equals(key)).toBe(true);
    expect(() => readKekFile(join(dir, 'bad'))).toThrow(ConfigError);
  });
});

describe('数据库秘密文件', () => {
  it('读取秘密文件且读取失败不回显路径内容；显式DATABASE_URL优先', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-db-secret-'));
    const path = join(dir, 'database-url');
    writeFileSync(path, DB + '\n');
    expect(loadConfig({ DATABASE_URL_FILE: path }).database.url).toBe(DB);
    expect(loadConfig({ DATABASE_URL: DB, DATABASE_URL_FILE: '/missing' }).database.url).toBe(DB);
    expect(() => loadConfig({ DATABASE_URL_FILE: join(dir, 'missing') })).toThrow(
      /DATABASE_URL_FILE/,
    );
  });
});
