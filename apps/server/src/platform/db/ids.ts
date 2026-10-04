/**
 * 主键生成：统一 UUIDv7（按时间递增的全局唯一 ID，engineering-standards.md 第 5 节第 2 条）。
 */
import { v7 as uuidv7 } from 'uuid';

export function newId(): string {
  return uuidv7();
}
