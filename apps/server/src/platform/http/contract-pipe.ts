/**
 * 契约校验管道：用契约里的 Zod schema 校验请求参数 / 查询 / 请求体（engineering-standards.md 第 1 节第 5 条）。
 *
 *   @Post()
 *   create(@Body(new ContractPipe(CreateThingRequest)) body: CreateThingRequest) { ... }
 *
 * 校验失败返回 400 bad_request，details.issues 列出出错的字段路径和原因（不回显字段的值）。
 * 也可以在非 HTTP 场景直接用 parseContract(schema, value)。
 */
import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from './app-error.js';

export function parseContract<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError('bad_request', '请求参数不正确', {
    details: {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    },
  });
}

export class ContractPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    return parseContract(this.schema, value);
  }
}
