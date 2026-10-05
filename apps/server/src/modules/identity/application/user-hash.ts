import { createHash } from 'node:crypto';

/** 审计记录里用用户 ID 的哈希代替原 ID（注销后不能再关联到人，security-and-privacy.md 第 5.1 节）。 */
export function hashUserId(userId: string): string {
  return createHash('sha256').update(`user:${userId}`, 'utf8').digest('hex');
}
