/** 所有价目表发布入口共用同一事务锁，空 active 版本时也串行复制/切换。 */
export const PRICE_PUBLISH_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(hashtextextended('billing:price-publish', 0))";
