/**
 * 把 NestJS 框架自己的日志（启动、路由注册、未捕获异常）也接到平台日志器上，同样经过脱敏。
 */
import type { LoggerService } from '@nestjs/common';
import type { Logger } from './logger.js';

export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...rest: unknown[]): void {
    this.write('info', message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.write('warn', message, rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('trace', message, rest);
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    this.write('fatal', message, rest);
  }

  private write(
    level: 'info' | 'error' | 'warn' | 'debug' | 'trace' | 'fatal',
    message: unknown,
    rest: unknown[],
  ): void {
    // Nest 的约定：最后一个字符串参数是上下文名（例如 'RoutesResolver'）
    const context = typeof rest[rest.length - 1] === 'string' ? rest.pop() : undefined;
    const fields: Record<string, unknown> = { nest: context };
    if (rest.length > 0) fields.details = rest;
    if (message instanceof Error) {
      this.logger[level]({ ...fields, err: message }, message.message);
    } else if (typeof message === 'string') {
      this.logger[level](fields, message);
    } else {
      this.logger[level]({ ...fields, data: message }, 'nest');
    }
  }
}
