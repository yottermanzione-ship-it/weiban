/**
 * 启动入口。按 APP_ROLE 决定启动什么（overview.md 第 6 节）：
 * - web / all：开 HTTP（all 同时跑任务与事件分发）；
 * - worker：不开 HTTP，只跑任务与事件分发。
 *
 * 开发：pnpm --filter @weiban/server dev     生产：先构建，再 node dist/main.js（见 docs/backend/kernel.md）
 * 数据库迁移不在启动时自动执行，部署时先执行迁移命令。
 */
import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadLocalEnv } from './platform/config/local-env.js';
import { NestPinoLogger } from './platform/logging/nest-logger.js';
import {
  ConfigError,
  createLogger,
  loadConfig,
  type AppConfig,
  type PlatformOptions,
} from './platform/index.js';

/** 创建 HTTP 应用（不监听端口）。集成测试也用它。 */
export async function createApp(options: PlatformOptions): Promise<INestApplication> {
  const logger = options.logger ?? createLogger({ level: options.config.logLevel });
  const app = await NestFactory.create(AppModule.forRoot({ ...options, logger }), {
    logger: new NestPinoLogger(logger),
    bufferLogs: false,
  });
  app.enableShutdownHooks();
  configureHttpApp(app, options.config);
  return app;
}

/** HTTP 应用的 Express 设置（createApp 与集成测试共用）。 */
export function configureHttpApp(app: INestApplication, config: AppConfig): void {
  const express = app.getHttpAdapter().getInstance() as {
    disable(name: string): void;
    set(name: string, value: unknown): void;
  };
  // 不暴露 X-Powered-By: Express
  express.disable('x-powered-by');
  // 反向代理后面取真实客户端 IP（登录失败按 IP 锁定要用），见 HTTP_TRUST_PROXY
  express.set('trust proxy', config.http.trustProxy);
}

/** 创建无 HTTP 的应用上下文（APP_ROLE = worker）。 */
export async function createWorker(options: PlatformOptions): Promise<INestApplicationContext> {
  const logger = options.logger ?? createLogger({ level: options.config.logLevel });
  const context = await NestFactory.createApplicationContext(
    AppModule.forRoot({ ...options, logger }),
    { logger: new NestPinoLogger(logger) },
  );
  context.enableShutdownHooks();
  return context;
}

export async function bootstrap(): Promise<void> {
  loadLocalEnv();
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  if (config.role === 'worker') {
    await createWorker({ config, logger });
    logger.info({ role: config.role }, '服务器已启动（只跑后台任务）');
    return;
  }
  const app = await createApp({ config, logger });
  await app.listen(config.http.port, config.http.host);
  logger.info({ role: config.role, port: config.http.port }, '服务器已启动');
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  bootstrap().catch((error: unknown) => {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      createLogger().fatal({ err: error }, '服务器启动失败');
    }
    process.exitCode = 1;
  });
}
