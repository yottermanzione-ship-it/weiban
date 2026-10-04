/**
 * 结构化日志（pino，JSON 一行一条），内置脱敏（security-and-privacy.md 第 4 节）。
 *
 * 用法：
 *   constructor(@Inject(LOGGER) logger: Logger) { this.log = logger.child({ module: 'chat' }); }
 *   this.log.info({ conversationId }, '会话已创建');
 *
 * 脱敏分两层，都在这里自动完成：
 * 1. 写入前：每个参数（对象、字符串、Error）按字段名和内容打码（sanitize.ts）；
 * 2. 输出前：整行 JSON 再按内容打码一次（防止漏网，例如第三方库自己拼进消息里的令牌）。
 */
import { pino, type DestinationStream, type Logger as PinoLogger, type LoggerOptions } from 'pino';
import { currentLogContext } from './log-context.js';
import { redactString, sanitize } from './sanitize.js';

export type Logger = PinoLogger;

export const LOGGER = Symbol('weiban.platform.logger');

export interface CreateLoggerOptions {
  level?: LoggerOptions['level'];
  /** 输出目标，默认标准输出。测试可以传入收集器检查输出内容。 */
  destination?: DestinationStream;
}

/** 输出前对整行再打码一次。 */
export function redactingStream(target: DestinationStream): DestinationStream {
  return {
    write(line: string) {
      target.write(redactString(line));
    },
  };
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const destination = redactingStream(options.destination ?? pino.destination(1));
  return pino(
    {
      level: options.level ?? 'info',
      base: { service: 'weiban-server' },
      timestamp: pino.stdTimeFunctions.isoTime,
      messageKey: 'msg',
      errorKey: 'err',
      formatters: {
        level: (label) => ({ level: label }),
        bindings: (bindings) => sanitize(bindings) as Record<string, unknown>,
      },
      // 每条日志自动带上当前请求 / 事件 / 任务的 ID
      mixin: () => ({ ...currentLogContext() }),
      hooks: {
        logMethod(args, method) {
          const cleaned = args.map((arg) => sanitize(arg)) as Parameters<typeof method>;
          method.apply(this, cleaned);
        },
      },
    },
    destination,
  );
}
