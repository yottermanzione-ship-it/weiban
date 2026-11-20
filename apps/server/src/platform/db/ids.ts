/**
 * 主键生成：统一 UUIDv7（按时间递增的全局唯一 ID，engineering-standards.md 第 5 节第 2 条）。
 */
import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';

export function newId(): string {
  return uuidv7();
}

/** 同一用户和同一业务来源重试时生成相同 UUID，来源文本不出现在库中。 */
export function modelTaskKey(userId: string, sourceKey: string): string {
  return uuidv5(JSON.stringify([userId, sourceKey]), 'ea07595b-8760-4a4b-943b-4f9965fb06ba');
}
