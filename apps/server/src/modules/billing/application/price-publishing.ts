/** 所有价目表发布入口共用同一事务锁，空 active 版本时也串行复制/切换。 */
export const PRICE_PUBLISH_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(hashtextextended('billing:price-publish', 0))";

import { costPlusPriceMicros } from '@weiban/contracts';
import { AppError } from '../../../platform/index.js';

/** 仅在新价目写入时应用；历史价目和已冻结报价仍按原值结算。 */
export function costPlusPrice(costMicros: number): number {
  try {
    return costPlusPriceMicros(costMicros);
  } catch {
    throw new AppError('bad_request', '成本必须为有效的非负金额，且加三成后不能超出金额范围');
  }
}
