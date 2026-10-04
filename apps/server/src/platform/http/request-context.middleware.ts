/**
 * 每个 HTTP 请求的入口：分配请求 ID（客户端带了合法的 X-Request-Id 就沿用），
 * 放进日志上下文（之后这个请求里的所有日志自动带 requestId），写回响应头，结束时记一条访问日志。
 *
 * 访问日志只记方法、路径（不含查询参数）、状态码、耗时，不记请求头和请求体。
 */
import type { NextFunction, Request, Response } from 'express';
import type { Clock } from '../clock/clock.js';
import { newId } from '../db/ids.js';
import { runWithLogContext } from '../logging/log-context.js';
import type { Logger } from '../logging/logger.js';

export const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export function requestContextMiddleware(logger: Logger, clock: Clock) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : newId();
    res.setHeader(REQUEST_ID_HEADER, requestId);
    const startedAt = clock.nowMs();
    runWithLogContext({ requestId }, () => {
      res.on('finish', () => {
        logger.info(
          {
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: clock.nowMs() - startedAt,
          },
          'http',
        );
      });
      next();
    });
  };
}
