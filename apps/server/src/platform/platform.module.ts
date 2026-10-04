/**
 * 平台内核的 NestJS 模块（全局）：把配置、时钟、日志、数据库、事件、任务队列、加密、审计、鉴权守卫、
 * 统一错误、健康检查装配起来。业务模块不需要 import 它，直接 @Inject(令牌) 使用即可（令牌见 platform/index.ts）。
 *
 * 后台工作按进程角色启动（overview.md 第 6 节）：
 * - web：开 HTTP；任务队列只投递不消费；不跑事件分发器。
 * - worker：不开 HTTP（main.ts 决定）；消费任务、跑事件分发器。
 * - all：全部。
 */
import {
  Global,
  Inject,
  Module,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, ModuleRef, Reflector } from '@nestjs/core';
import { AUDIT_LOG, AuditLog } from './audit/audit-log.js';
import { AuthGuard, SESSION_VERIFIER, type SessionVerifier } from './auth/auth.js';
import { CLOCK, SystemClock, type Clock } from './clock/clock.js';
import { APP_CONFIG, readKekFile, type AppConfig } from './config/config.js';
import { ENVELOPE_CRYPTO, EnvelopeCrypto, type KekRing } from './crypto/envelope.js';
import { DATABASE, Database } from './db/database.js';
import { USER_DATA_REGISTRY, UserDataRegistry } from './deletion/user-data-registry.js';
import { EVENT_DISPATCHER, EventDispatcher } from './events/dispatcher.js';
import { EVENT_BUS, EventBus } from './events/event-bus.js';
import { EVENT_INBOX, EventInbox } from './events/inbox.js';
import { OUTBOX, Outbox } from './events/outbox.js';
import { ApiErrorFilter } from './http/error-filter.js';
import { HealthController } from './http/health.controller.js';
import { requestContextMiddleware } from './http/request-context.middleware.js';
import { JOB_QUEUE, JobQueue } from './jobs/job-queue.js';
import { createLogger, LOGGER, type Logger } from './logging/logger.js';

export interface PlatformOptions {
  config: AppConfig;
  /** 测试传 TestClock；默认系统时钟。 */
  clock?: Clock;
  /** 测试传入带收集器的日志器；默认按配置输出到标准输出。 */
  logger?: Logger;
  /** 主密钥集合；默认按配置读 PLATFORM_KEK_FILE（未配置则加密不可用）。 */
  kekRing?: KekRing | null;
  /** 是否在启动时开启后台工作（任务队列、事件分发器）。默认按进程角色；HTTP 测试可以关掉。 */
  background?: boolean;
}

const PLATFORM_OPTIONS = Symbol('weiban.platform.options');

class PlatformLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    private readonly options: PlatformOptions,
    private readonly jobs: JobQueue,
    private readonly dispatcher: EventDispatcher,
    private readonly outbox: Outbox,
    private readonly database: Database,
    private readonly logger: Logger,
  ) {}

  private retryTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  async onApplicationBootstrap(): Promise<void> {
    if (this.options.background === false) return;
    // 数据库暂时连不上时不让进程退出：HTTP 照常启动（/health 报 503），后台工作按退避重试启动
    await this.startBackground(1);
  }

  private async startBackground(attempt: number): Promise<void> {
    if (this.shuttingDown) return;
    const role = this.options.config.role;
    try {
      await this.jobs.start();
    } catch (error) {
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 60_000);
      this.logger.error({ err: error, attempt, retryInMs: delayMs }, '后台工作启动失败，稍后重试');
      this.retryTimer = setTimeout(() => void this.startBackground(attempt + 1), delayMs);
      return;
    }
    if (role !== 'web') {
      this.outbox.setOnCommitted(() => this.dispatcher.wake());
      this.dispatcher.start();
    }
    this.logger.info({ role }, '平台内核后台工作已启动');
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    await this.dispatcher.stop();
    await this.jobs.stop();
    await this.database.close();
  }
}

function loadKekRing(config: AppConfig): KekRing | null {
  if (!config.crypto.kekFile) return null;
  const version = config.crypto.kekVersion;
  return {
    currentVersion: version,
    keys: new Map([[version, readKekFile(config.crypto.kekFile)]]),
  };
}

@Global()
@Module({})
export class PlatformModule implements NestModule {
  constructor(
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestContextMiddleware(this.logger, this.clock)).forRoutes('*path');
  }

  static forRoot(options: PlatformOptions): DynamicModule {
    const { config } = options;
    return {
      module: PlatformModule,
      controllers: [HealthController],
      providers: [
        { provide: PLATFORM_OPTIONS, useValue: options },
        { provide: APP_CONFIG, useValue: config },
        { provide: CLOCK, useValue: options.clock ?? new SystemClock() },
        {
          provide: LOGGER,
          useValue: options.logger ?? createLogger({ level: config.logLevel }),
        },
        {
          provide: DATABASE,
          useFactory: (logger: Logger) =>
            new Database({
              url: config.database.url,
              poolMax: config.database.poolMax,
              onError: (error) => logger.error({ err: error }, '数据库连接池出错'),
            }),
          inject: [LOGGER],
        },
        { provide: EVENT_BUS, useValue: new EventBus() },
        { provide: USER_DATA_REGISTRY, useValue: new UserDataRegistry() },
        {
          provide: EVENT_INBOX,
          useFactory: (db: Database, clock: Clock) => new EventInbox(db, clock),
          inject: [DATABASE, CLOCK],
        },
        { provide: OUTBOX, useFactory: (clock: Clock) => new Outbox(clock), inject: [CLOCK] },
        {
          provide: EVENT_DISPATCHER,
          useFactory: (db: Database, bus: EventBus, inbox: EventInbox, clock: Clock, log: Logger) =>
            new EventDispatcher(db, bus, inbox, clock, log, config.events.pollIntervalMs),
          inject: [DATABASE, EVENT_BUS, EVENT_INBOX, CLOCK, LOGGER],
        },
        {
          provide: JOB_QUEUE,
          useFactory: (clock: Clock, logger: Logger) =>
            new JobQueue({
              databaseUrl: config.database.url,
              clock,
              logger,
              consume: config.role !== 'web',
            }),
          inject: [CLOCK, LOGGER],
        },
        {
          provide: ENVELOPE_CRYPTO,
          useFactory: (db: Database, clock: Clock) =>
            new EnvelopeCrypto(
              db,
              clock,
              options.kekRing !== undefined ? options.kekRing : loadKekRing(config),
            ),
          inject: [DATABASE, CLOCK],
        },
        {
          provide: AUDIT_LOG,
          useFactory: (db: Database, clock: Clock) => new AuditLog(db, clock),
          inject: [DATABASE, CLOCK],
        },
        {
          provide: APP_GUARD,
          // identity 模块在自己的 providers 里提供 SESSION_VERIFIER；这里在请求时按令牌全局查找，
          // 平台内核因此不需要 import identity（R2）。找不到（identity 尚未接入）时一律 401。
          useFactory: (reflector: Reflector, moduleRef: ModuleRef) =>
            new AuthGuard(reflector, () => {
              try {
                return moduleRef.get<SessionVerifier>(SESSION_VERIFIER, { strict: false });
              } catch {
                return null;
              }
            }),
          inject: [Reflector, ModuleRef],
        },
        {
          provide: APP_FILTER,
          useFactory: (logger: Logger) => new ApiErrorFilter(logger),
          inject: [LOGGER],
        },
        {
          provide: PlatformLifecycle,
          useFactory: (
            jobs: JobQueue,
            dispatcher: EventDispatcher,
            outbox: Outbox,
            db: Database,
            logger: Logger,
          ) => new PlatformLifecycle(options, jobs, dispatcher, outbox, db, logger),
          inject: [JOB_QUEUE, EVENT_DISPATCHER, OUTBOX, DATABASE, LOGGER],
        },
      ],
      exports: [
        APP_CONFIG,
        CLOCK,
        LOGGER,
        DATABASE,
        EVENT_BUS,
        USER_DATA_REGISTRY,
        EVENT_INBOX,
        OUTBOX,
        EVENT_DISPATCHER,
        JOB_QUEUE,
        ENVELOPE_CRYPTO,
        AUDIT_LOG,
      ],
    };
  }
}
