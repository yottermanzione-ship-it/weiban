/**
 * 平台内核的公开出口。业务模块统一从这里 import（相对路径，例如 '../../platform/index.js'）。
 * 各部分怎么用见 docs/backend/kernel.md。
 */
export { PlatformModule, type PlatformOptions } from './platform.module.js';

export { APP_CONFIG, loadConfig, ConfigError, type AppConfig } from './config/config.js';
export * from './config/product-params.js';

export { CLOCK, SystemClock, TestClock, type Clock } from './clock/clock.js';

export { DATABASE, Database, asDbTx, type Db, type DbTx } from './db/database.js';
export { newId } from './db/ids.js';

export { EVENT_BUS, EventBus, type EventSubscription, type EventOf } from './events/event-bus.js';
export { OUTBOX, Outbox } from './events/outbox.js';
export { EVENT_INBOX, EventInbox, type InboxResult } from './events/inbox.js';
export { EVENT_DISPATCHER, EventDispatcher } from './events/dispatcher.js';

export { USER_DATA_REGISTRY, UserDataRegistry } from './deletion/user-data-registry.js';

export { JOB_QUEUE, JobQueue, type JobContext, type JobSendOptions } from './jobs/job-queue.js';

export { LOGGER, createLogger, type Logger } from './logging/logger.js';
export { runWithLogContext, currentLogContext } from './logging/log-context.js';

export {
  ENVELOPE_CRYPTO,
  EnvelopeCrypto,
  PLATFORM_KEY_OWNER,
  CryptoUnavailableError,
  DecryptionError,
} from './crypto/envelope.js';

export { AUDIT_LOG, AuditLog, type AuditEntry } from './audit/audit-log.js';

export {
  RequireAuth,
  CurrentPrincipal,
  SESSION_VERIFIER,
  type AuthPrincipal,
  type SessionVerifier,
} from './auth/auth.js';

export { AppError, DEFAULT_ERROR_STATUS } from './http/app-error.js';
export { ContractPipe, parseContract } from './http/contract-pipe.js';
