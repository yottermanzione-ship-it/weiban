/**
 * 主键生成：统一 UUIDv7（按时间递增的全局唯一 ID，engineering-standards.md 第 5 节第 2 条）。
 */
import { createHash } from 'node:crypto';
import { stringify, v7 as uuidv7 } from 'uuid';

export function newId(): string {
  return uuidv7();
}

/** 同一用户和同一业务来源重试时生成相同 UUID，来源文本不出现在库中。 */
export function modelTaskKey(userId: string, sourceKey: string): string {
  const digest = createHash('sha256')
    .update('weiban:model-task:v1:' + userId + ':' + sourceKey)
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x80;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  return stringify(digest);
}
